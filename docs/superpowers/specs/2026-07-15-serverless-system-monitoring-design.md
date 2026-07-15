# Serverless system monitoring (agent-fed) — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan

## Context

The dashboard homepage renders `MonitoringPanel`, which polls `GET /api/monitoring`
every 5 s while the box is online. That endpoint reads **per-core CPU over SSH**
(`getSshClient` → `getPerCoreUsage`) and **storage over the box's Web Manager HTTP API
on port 81** (`fetchStorageInfo`). Both channels require a direct link to the Recalbox.

In **serverless mode** (Vercel, `isServerlessMode()` = `AGENT_ONLY_MEDIA=1`) the box is
NAT'd and unreachable, so every `/api/monitoring` call fails — yet the panel keeps firing
one **serverless invocation every 5 s** (SSH/HTTP timeout) whenever the agent is "online",
burning Fluid Active CPU for a panel that renders nothing. `/api/monitoring` is **not**
gated by `isServerlessMode()`.

This is the same class of serverless waste addressed earlier this session (embedded-replica
Fluid CPU, SSE poll backoff). The fix: stop the SSH/HTTP polling in serverless and instead
show what the **on-box agent** already (or can cheaply) push in its periodic snapshot.

Related prior work this session: `should-use-replica.ts` (Vercel replica guardrail), SSE
poll batching/backoff (`app/api/events/route.ts`), resilient boot (`instrumentation.ts`),
deploy-time migrations (`build` runs `drizzle-kit migrate`).

## Decisions (from brainstorming)

- **Serverless panel content:** rethought for the agent's slow cadence (snapshot every
  60–300 s). Per-core CPU is a live metric that would look frozen at that cadence, so it is
  **dropped** in serverless. The serverless panel shows **Storage + RAM + Uptime** — the
  data that is meaningful at snapshot cadence and is **not already on the homepage**
  (`SystemStatsChart` already charts avg CPU + temp; RAM/uptime/storage are shown nowhere).
- **Transport:** enrich the existing SSE `system:info` event (already emitted from the
  latest snapshot by the SSE route's `pollSystemInfo`). **Zero extra client requests** — the
  most aligned with the session's cost-reduction goal.
- **Self-hosted:** unchanged. `MonitoringPanel` (per-core via SSH + storage via port 81)
  stays exactly as-is.

## Architecture & data flow (serverless)

```
agent.py gather_snapshot()      # + storage[] from /proc/mounts + statvfs
  → POST /api/agent/snapshots   # accepts + validates + stores storage (JSON)
  → system_snapshots.storage    # new JSON column
  → snapshotToSystemInfo(row)   # includes storage + uptimeSeconds in SystemInfoEvent
  → SSE /api/events pollSystemInfo  # already emits system:info (now enriched)
  → recalbox-events-provider    # already stores activity.lastSystemInfo
  → <ServerlessSystemPanel />   # reads storage + RAM + uptime from context
```

Self-hosted keeps its own path: `MonitoringPanel` → `/api/monitoring` (SSH per-core +
port-81 storage). The homepage picks the component by mode.

## Components / changes

### 1. Data model — `lib/db/schema.ts`
Add a nullable JSON column to `system_snapshots`:
- `storage: text('storage', { mode: 'json' }).$type<StorageMount[]>()` (nullable; null for
  self-hosted MQTT snapshots and pre-migration rows).

Generate a Drizzle migration (`drizzle-kit generate`). It applies automatically at deploy
(the `build` script runs `drizzle-kit migrate`) and at boot for self-hosted.

`StorageMount` (existing, `lib/recalbox/storage.ts`): `{ label, mount, usedBytes, sizeBytes, percent }`.

### 2. Agent — `agent/agent.py`
`gather_snapshot()` adds `storage`:
- Read `/proc/mounts`; skip pseudo/internal filesystems (tmpfs, overlay, squashfs, proc,
  sysfs, devtmpfs, devpts, cgroup*, and similar) — mirror the intent of `fetchStorageInfo`'s
  filter.
- For each remaining mount, `os.statvfs(mount)` → `sizeBytes = f_blocks*f_frsize`,
  `freeBytes = f_bavail*f_frsize`, `usedBytes = sizeBytes - freeBytes`,
  `percent = round(usedBytes/sizeBytes*100)`; `label` = last path segment (fallback to the
  device/mount). Skip zero-size mounts. Sort by `percent` desc.
- Best-effort: any read error → omit `storage` (do not fail the snapshot). CPU-avg/RAM/temp/
  uptime are already pushed unchanged.

### 3. Ingest — `app/api/agent/snapshots/route.ts`
Accept an optional `storage` array; validate each item's shape/number ranges; persist into
`system_snapshots.storage`. Unknown/invalid → store `null` (don't reject the whole snapshot).
Existing snapshot fields unchanged. Auth/token resolution unchanged.

### 4. SSE event — `lib/recalbox/events.ts` + `lib/db/system-info.ts`
- `SystemInfoEvent` gains `storage?: StorageMount[]` and `uptimeSeconds?: number` (both
  optional).
- `snapshotToSystemInfo(row)` populates them from the row (`storage: row.storage ?? undefined`,
  `uptimeSeconds: row.uptimeSeconds ?? undefined`).
- MQTT self-hosted parser (`parseSystemInfo`) leaves both undefined — no change needed there.
- `recalbox-events-provider.tsx` already stores the whole event in `activity.lastSystemInfo`;
  no change to the provider.

### 5. UI — homepage + new panel
- `app/[locale]/page.tsx` (server component): branch on `isServerlessMode()`:
  - serverless → `<ServerlessSystemPanel />`
  - self-hosted → `<MonitoringPanel />` (existing)
- `components/serverless-system-panel.tsx` (new, client): reads `activity.lastSystemInfo`
  from `useRecalboxEvents()`. Renders:
  - **Storage** rows — reuse `MonitoringPanel`'s storage row markup (extract a shared
    `StorageRows` piece or duplicate minimally; prefer extracting to avoid drift).
  - **RAM** — `memUsedMb / memTotalMb` as a labeled bar (same visual language).
  - **Uptime** — `uptimeSeconds` formatted (e.g. "3 j 4 h").
  - Renders nothing until `lastSystemInfo` exists / when offline (mirror `MonitoringPanel`'s
    null-states).
- `app/api/monitoring/route.ts`: short-circuit in serverless — `if (isServerlessMode())
  return 503/empty` — so the SSH/HTTP path is never attempted on Vercel (defense in depth;
  the panel isn't rendered there anyway).

### 6. i18n
Add strings for RAM and Uptime labels under `dashboard.system` in `messages/en.json` +
`messages/fr.json` (reuse existing `storage`/`cores` keys where possible).

## Error handling
- Agent: storage read failures are swallowed (snapshot still sent without `storage`).
- Ingest: invalid `storage` → stored as `null`, snapshot still accepted.
- UI: missing `storage`/`uptime`/RAM → that sub-section is hidden; panel shows only what it has.
- No new failure mode can crash the SSE stream (event fields are optional; consumers guard).

## Testing
- **Agent** (`agent/` test pattern): `gather_snapshot` storage reader with a mocked
  `/proc/mounts` + `os.statvfs` — asserts filtering of pseudo-fs, byte math, percent, sort.
- **Ingest** (`app/api/agent/snapshots/__tests__`): posting `storage` persists it; invalid
  `storage` → row stored with `storage = null`, snapshot still created.
- **Mapping** (`lib/db/__tests__`): `snapshotToSystemInfo` includes `storage` + `uptimeSeconds`
  when present, omits them when null.
- **Component**: `ServerlessSystemPanel` renders storage/RAM/uptime from a fake
  `lastSystemInfo`; renders nothing when it's null/offline.
- Full suite + typecheck + Biome green.

## Out of scope
- Per-core CPU in serverless (dropped by decision — not meaningful at snapshot cadence).
- Faster agent push cadence for "live" metrics (would add cloud traffic / Turso writes,
  against the session's cost goals).
- super-retrogamers (separate repo).
