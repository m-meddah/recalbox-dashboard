# Serverless System Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a useful system panel (Storage + RAM + Uptime) on the dashboard homepage in serverless mode, fed by the on-box agent's periodic snapshot via the existing SSE `system:info` event, and stop the wasteful SSH `/api/monitoring` polling on Vercel.

**Architecture:** The agent already pushes CPU/RAM/temp/uptime snapshots. Add **storage** to that snapshot; store it in a new `system_snapshots.storage` JSON column; enrich the `system:info` SSE event (already emitted from the latest snapshot) with `storage` + `uptimeSeconds`; render a new serverless-only `ServerlessSystemPanel` from the SSE context. Self-hosted keeps its existing SSH-based `MonitoringPanel` unchanged; the homepage picks by `isServerlessMode()`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (libSQL/SQLite), Zod, next-intl, Vitest (node env), dependency-free Python 3 agent.

## Global Constraints

- Biome style: **tabs** for indentation, **single quotes**, **no semicolons**, **trailing commas**. Verify with `pnpm exec biome check <files>`.
- Tests live in `__tests__/` next to the code. Vitest env is **node** (no jsdom/RTL — do not add component-render tests; test pure helpers instead).
- The agent (`agent/agent.py`) is **dependency-free Python 3 stdlib only** (no pip installs).
- `StorageMount` shape (existing, `apps/dashboard/lib/recalbox/storage.ts`): `{ label: string, mount: string, usedBytes: number, sizeBytes: number, percent: number }`.
- Run all `pnpm`/`drizzle-kit`/`vitest`/`biome` commands from `apps/dashboard/`.
- Migrations apply automatically at deploy (the `build` script runs `drizzle-kit migrate`) and at boot for self-hosted — do NOT add runtime migration calls.
- Serverless is gated by `isServerlessMode()` (`apps/dashboard/lib/serverless.ts` → `AGENT_ONLY_MEDIA === '1'`).

---

### Task 1: Add `storage` JSON column to `system_snapshots`

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts` (the `systemSnapshots` table, ~line 173-187)
- Create: `apps/dashboard/drizzle/migrations/NNNN_*.sql` (generated)

**Interfaces:**
- Produces: `systemSnapshots.storage` column, typed `StorageMount[] | null` on `typeof systemSnapshots.$inferSelect` (i.e. `SnapshotRow.storage`).

- [ ] **Step 1: Add the column to the schema**

At the top of `schema.ts`, add a type-only import (place with the other imports):

```ts
import type { StorageMount } from '@/lib/recalbox/storage'
```

Inside the `systemSnapshots` table definition, add `storage` after `uptimeSeconds`:

```ts
		tempCelsius: real('temp_celsius'),
		uptimeSeconds: int('uptime_seconds'),
		storage: text('storage', { mode: 'json' }).$type<StorageMount[]>(),
```

(`text` and `int`/`real` are already imported in `schema.ts`.)

- [ ] **Step 2: Generate the migration**

Run: `cd apps/dashboard && pnpm exec drizzle-kit generate`
Expected: a new file `drizzle/migrations/NNNN_<name>.sql` containing
`ALTER TABLE \`system_snapshots\` ADD \`storage\` text;` and an updated `drizzle/migrations/meta/` snapshot.

- [ ] **Step 3: Verify the migration applies (via the existing in-memory test)**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/ingest-snapshot.test.ts`
Expected: PASS. (`makeDb()` runs `migrate()` from the migrations folder, so a broken migration fails here.)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/drizzle/migrations
git commit -m "feat(db): add storage column to system_snapshots"
```

---

### Task 2: Persist agent-pushed `storage`

**Files:**
- Modify: `apps/dashboard/lib/agent/ingest-snapshot.ts`
- Modify: `apps/dashboard/app/api/agent/snapshots/route.ts`
- Test: `apps/dashboard/lib/agent/__tests__/ingest-snapshot.test.ts`

**Interfaces:**
- Consumes: `SnapshotRow.storage` (Task 1).
- Produces: `AgentSnapshotInput.storage?: StorageMount[] | null`; `ingestSnapshot` stores it. The snapshots route accepts an optional `storage` array in the JSON body.

- [ ] **Step 1: Write the failing tests**

Append to `lib/agent/__tests__/ingest-snapshot.test.ts` inside the `describe('ingestSnapshot', …)` block:

```ts
	it('stores the storage array', async () => {
		const storage = [
			{ label: 'share', mount: '/recalbox/share', usedBytes: 500, sizeBytes: 1000, percent: 50 },
		]
		await ingestSnapshot(db as unknown as DB, 'rb1', {
			capturedAt: new Date('2026-06-20T20:00:00.000Z'),
			storage,
		})
		const row = db.select().from(schema.systemSnapshots).all()[0]
		expect(row?.storage).toEqual(storage)
	})

	it('stores null storage when omitted', async () => {
		await ingestSnapshot(db as unknown as DB, 'rb1', { capturedAt: new Date() })
		const row = db.select().from(schema.systemSnapshots).all()[0]
		expect(row?.storage).toBeNull()
	})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/ingest-snapshot.test.ts`
Expected: FAIL — `storage` is not on `AgentSnapshotInput` (type error) / not inserted.

- [ ] **Step 3: Add `storage` to `ingest-snapshot.ts`**

Add the import and field. Full updated file:

```ts
import type { DB } from '@/lib/db'
import { systemSnapshots } from '@/lib/db/schema'
import type { StorageMount } from '@/lib/recalbox/storage'

export type AgentSnapshotInput = {
	capturedAt: Date
	cpuPercent?: number | null
	memUsedMb?: number | null
	memTotalMb?: number | null
	tempCelsius?: number | null
	uptimeSeconds?: number | null
	storage?: StorageMount[] | null
}

/**
 * Persist one system snapshot pushed by the on-device agent. Mirrors what the
 * SSH stats collector used to write into system_snapshots — just sourced from
 * the agent's local /proc + /sys reads instead of remote commands.
 */
export async function ingestSnapshot(
	db: DB,
	recalboxId: string,
	input: AgentSnapshotInput,
): Promise<{ id: number }> {
	const rows = await db
		.insert(systemSnapshots)
		.values({
			recalboxId,
			capturedAt: input.capturedAt,
			cpuPercent: input.cpuPercent ?? null,
			memUsedMb: input.memUsedMb ?? null,
			memTotalMb: input.memTotalMb ?? null,
			tempCelsius: input.tempCelsius ?? null,
			uptimeSeconds: input.uptimeSeconds ?? null,
			storage: input.storage ?? null,
		})
		.returning({ id: systemSnapshots.id })
	const row = rows[0]
	if (!row) throw new Error('Failed to insert snapshot')
	return { id: row.id }
}
```

- [ ] **Step 4: Add `storage` validation to the route**

In `app/api/agent/snapshots/route.ts`, add a storage item schema and extend `Payload`; pass `storage` to `ingestSnapshot`. Add above `const Payload`:

```ts
const StorageItem = z.object({
	label: z.string(),
	mount: z.string(),
	usedBytes: z.number(),
	sizeBytes: z.number(),
	percent: z.number(),
})
```

Add this field inside `const Payload = z.object({ … })` (after `uptime_seconds`):

```ts
	// Lenient: a malformed storage array must not drop the whole snapshot.
	storage: z.array(StorageItem).nullish().catch(null),
```

In the `ingestSnapshot(db, resolved.recalboxId, { … })` call, add:

```ts
			storage: p.storage ?? null,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/ingest-snapshot.test.ts`
Expected: PASS (all, including the two new cases).

- [ ] **Step 6: Lint + typecheck**

Run: `cd apps/dashboard && pnpm exec biome check lib/agent/ingest-snapshot.ts app/api/agent/snapshots/route.ts && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/lib/agent/ingest-snapshot.ts apps/dashboard/app/api/agent/snapshots/route.ts apps/dashboard/lib/agent/__tests__/ingest-snapshot.test.ts
git commit -m "feat(agent): accept and persist storage in snapshot ingest"
```

---

### Task 3: Enrich the `system:info` SSE event with `storage` + `uptimeSeconds`

**Files:**
- Modify: `apps/dashboard/lib/recalbox/events.ts` (the `SystemInfoEvent` type, ~line 48-56)
- Modify: `apps/dashboard/lib/db/system-info.ts` (`snapshotToSystemInfo`)
- Test: `apps/dashboard/lib/db/__tests__/system-info-map.test.ts` (create)

**Interfaces:**
- Consumes: `SnapshotRow.storage`, `SnapshotRow.uptimeSeconds` (Task 1).
- Produces: `SystemInfoEvent` gains `uptimeSeconds?: number` and `storage?: StorageMount[]`. `snapshotToSystemInfo(row)` populates them (undefined when the row value is null). The events provider already stores the whole event in `activity.lastSystemInfo` — no provider change.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/db/__tests__/system-info-map.test.ts`:

```ts
import { snapshotToSystemInfo, type SnapshotRow } from '@/lib/db/system-info'
import { describe, expect, it } from 'vitest'

const baseRow: SnapshotRow = {
	id: 1,
	recalboxId: 'rb1',
	capturedAt: new Date('2026-06-20T20:00:00.000Z'),
	cpuPercent: 10,
	memUsedMb: 800,
	memTotalMb: 4096,
	tempCelsius: 45,
	uptimeSeconds: 3600,
	storage: [{ label: 'share', mount: '/recalbox/share', usedBytes: 5, sizeBytes: 10, percent: 50 }],
}

describe('snapshotToSystemInfo', () => {
	it('includes storage and uptimeSeconds when present', () => {
		const e = snapshotToSystemInfo(baseRow)
		expect(e.uptimeSeconds).toBe(3600)
		expect(e.storage).toEqual(baseRow.storage)
	})

	it('omits storage and uptimeSeconds when null', () => {
		const e = snapshotToSystemInfo({ ...baseRow, storage: null, uptimeSeconds: null })
		expect(e.uptimeSeconds).toBeUndefined()
		expect(e.storage).toBeUndefined()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm exec vitest run lib/db/__tests__/system-info-map.test.ts`
Expected: FAIL — `storage`/`uptimeSeconds` not on the event / type error.

- [ ] **Step 3: Extend `SystemInfoEvent`**

In `lib/recalbox/events.ts`, add a type-only import near the top:

```ts
import type { StorageMount } from '@/lib/recalbox/storage'
```

Update the `SystemInfoEvent` type:

```ts
export type SystemInfoEvent = {
	type: 'system:info'
	timestamp: string
	/** Average CPU usage across all cores, 0–100 */
	cpuPercent: number
	memUsedMb: number
	memTotalMb: number
	tempCelsius: number
	/** Seconds since boot (agent snapshots only; undefined over MQTT). */
	uptimeSeconds?: number
	/** Per-mount disk usage (agent snapshots only; undefined over MQTT). */
	storage?: StorageMount[]
}
```

- [ ] **Step 4: Map the fields in `snapshotToSystemInfo`**

In `lib/db/system-info.ts`, update the returned object:

```ts
	return {
		type: 'system:info',
		timestamp: row.capturedAt.toISOString(),
		cpuPercent: row.cpuPercent ?? 0,
		memUsedMb: row.memUsedMb ?? 0,
		memTotalMb: row.memTotalMb ?? 0,
		tempCelsius: row.tempCelsius ?? 0,
		uptimeSeconds: row.uptimeSeconds ?? undefined,
		storage: row.storage ?? undefined,
	}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm exec vitest run lib/db/__tests__/system-info-map.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint + typecheck**

Run: `cd apps/dashboard && pnpm exec biome check lib/recalbox/events.ts lib/db/system-info.ts lib/db/__tests__/system-info-map.test.ts && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/lib/recalbox/events.ts apps/dashboard/lib/db/system-info.ts apps/dashboard/lib/db/__tests__/system-info-map.test.ts
git commit -m "feat(sse): carry storage + uptime in system:info event"
```

---

### Task 4: Agent reads storage into the snapshot

**Files:**
- Modify: `agent/agent.py` (add `read_storage`, extend `gather_snapshot`)

**Interfaces:**
- Produces: the snapshot dict gains `"storage"` — a list of `{label, mount, usedBytes, sizeBytes, percent}`, matching the ingest route's `StorageItem` (Task 2). `os` is already imported in `agent.py`.

- [ ] **Step 1: Add `read_storage()` and a skip-set**

In `agent/agent.py`, in the "System snapshots" section (near `read_mem_mb`), add:

```python
# Pseudo/virtual filesystems we never report as storage (mirrors the dashboard's
# fetchStorageInfo filter, which drops overlay/tmpfs/squashfs/dev/etc.).
_STORAGE_SKIP_FSTYPES = {
    "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "overlay", "squashfs",
    "cgroup", "cgroup2", "mqueue", "debugfs", "tracefs", "securityfs",
    "pstore", "bpf", "configfs", "fusectl", "ramfs", "autofs", "hugetlbfs",
}


def read_storage():
    """List of {label, mount, usedBytes, sizeBytes, percent} for real mounts.

    Best-effort: returns [] on any failure so a storage read never drops a snapshot.
    """
    try:
        out = []
        seen = set()
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                device, mount, fstype = parts[0], parts[1], parts[2]
                if fstype in _STORAGE_SKIP_FSTYPES or mount in seen:
                    continue
                seen.add(mount)
                try:
                    st = os.statvfs(mount)
                except OSError:
                    continue
                size = st.f_blocks * st.f_frsize
                if size <= 0:
                    continue
                free = st.f_bavail * st.f_frsize
                used = size - free
                label = mount.rstrip("/").split("/")[-1] or device.split("/")[-1] or mount
                out.append({
                    "label": label,
                    "mount": mount,
                    "usedBytes": used,
                    "sizeBytes": size,
                    "percent": round(used / size * 100),
                })
        out.sort(key=lambda m: m["percent"], reverse=True)
        return out
    except Exception:
        return []
```

- [ ] **Step 2: Add `storage` to `gather_snapshot()`**

Update the returned dict in `gather_snapshot()`:

```python
def gather_snapshot():
    total_mb, used_mb = read_mem_mb()
    uptime = read_uptime()
    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "cpu_percent": read_cpu_usage(),
        "mem_used_mb": used_mb,
        "mem_total_mb": total_mb,
        "temp_celsius": read_cpu_temp(),
        "uptime_seconds": int(uptime) if uptime is not None else None,
        "storage": read_storage(),
    }
```

- [ ] **Step 3: Smoke-test the reader on this Linux box**

Run: `cd agent && python3 -c "import agent; import json; print(json.dumps(agent.read_storage(), indent=1))"`
Expected: a non-empty JSON list; each item has `label`, `mount`, `usedBytes`, `sizeBytes`, `percent` (integers, `0 ≤ percent ≤ 100`), sorted by `percent` desc. (If importing `agent` triggers side effects, run the same via `python3 - <<'PY'` after copying the function; agent.py guards its main loop under `if __name__ == "__main__":`.)

- [ ] **Step 4: Byte-compile check**

Run: `python3 -m py_compile agent/agent.py`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add agent/agent.py
git commit -m "feat(agent): report per-mount storage usage in snapshots"
```

---

### Task 5: Extract a shared `StorageUsage` component

**Files:**
- Create: `apps/dashboard/components/storage-usage.tsx`
- Modify: `apps/dashboard/components/monitoring-panel.tsx` (use the shared component)

**Interfaces:**
- Produces: `StorageUsage({ storage: StorageMount[] })` (renders the storage `<Card>`, returns `null` when `storage` is empty) and `formatBytes(bytes: number): string`, both from `@/components/storage-usage`.
- Consumes: `MonitoringPanel` now imports `StorageUsage` instead of rendering the storage card inline.

- [ ] **Step 1: Create the shared component (move markup out of monitoring-panel)**

Create `apps/dashboard/components/storage-usage.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StorageMount } from '@/lib/recalbox/storage'
import { HardDrive } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Go`
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} Mo`
	return `${Math.round(bytes / 1024)} Ko`
}

// Translucent fill for the storage rows so the overlaid text stays readable in
// both light and dark themes. Literal class names for Tailwind's scanner.
function fillColor(pct: number): string {
	if (pct >= 90) return 'bg-red-500/25'
	if (pct >= 70) return 'bg-warning/30'
	return 'bg-accent/35'
}

export function StorageUsage({ storage }: { storage: StorageMount[] }) {
	const t = useTranslations('dashboard.system')
	if (storage.length === 0) return null
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{t('storage')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2.5">
				{storage.map((s) => (
					<div
						key={s.mount}
						className="relative h-14 overflow-hidden rounded-md border bg-muted/40"
					>
						<div
							className={`absolute inset-y-0 left-0 transition-all ${fillColor(s.percent)}`}
							style={{ width: `${Math.min(100, Math.max(0, s.percent))}%` }}
						/>
						<div className="relative flex h-full items-center gap-3 px-2.5">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground shadow-sm">
								<HardDrive className="size-5" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2 text-sm">
									<span className="truncate font-medium">{s.label}</span>
									<span className="shrink-0 font-semibold tabular-nums">{s.percent}%</span>
								</div>
								<div className="text-xs text-muted-foreground tabular-nums">
									{formatBytes(s.usedBytes)} / {formatBytes(s.sizeBytes)}
								</div>
							</div>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	)
}
```

- [ ] **Step 2: Use it in `MonitoringPanel`**

In `components/monitoring-panel.tsx`:
1. Delete the local `formatBytes` and `fillColor` functions.
2. Delete the entire `{data.storage.length > 0 && ( <Card> … storage … </Card> )}` block.
3. Add the import: `import { StorageUsage } from '@/components/storage-usage'`.
4. Remove the now-unused `HardDrive` import if it is no longer referenced elsewhere in the file (it is only used by the storage card).
5. Replace the removed storage block with:

```tsx
			<StorageUsage storage={data.storage} />
```

(Keep the per-core CPU `<Card>` exactly as-is. The `barColor` helper stays in `monitoring-panel.tsx`.)

- [ ] **Step 3: Typecheck + lint**

Run: `cd apps/dashboard && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec biome check components/storage-usage.tsx components/monitoring-panel.tsx`
Expected: no errors, no unused imports.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/components/storage-usage.tsx apps/dashboard/components/monitoring-panel.tsx
git commit -m "refactor(ui): extract StorageUsage from MonitoringPanel"
```

---

### Task 6: `formatUptime` helper + `ServerlessSystemPanel`

**Files:**
- Create: `apps/dashboard/lib/stats/format-uptime.ts`
- Test: `apps/dashboard/lib/stats/__tests__/format-uptime.test.ts`
- Create: `apps/dashboard/components/serverless-system-panel.tsx`

**Interfaces:**
- Consumes: `useRecalboxEvents()` → `{ mqttOnline, activity }` with `activity.lastSystemInfo: SystemInfoEvent | null` (now carrying `storage`/`uptimeSeconds`, Task 3); `StorageUsage`, `formatBytes` (Task 5).
- Produces: `formatUptime(seconds: number): string`; `ServerlessSystemPanel()` component.

- [ ] **Step 1: Write the failing test for `formatUptime`**

Create `apps/dashboard/lib/stats/__tests__/format-uptime.test.ts`:

```ts
import { formatUptime } from '@/lib/stats/format-uptime'
import { describe, expect, it } from 'vitest'

describe('formatUptime', () => {
	it('formats days + hours', () => {
		expect(formatUptime(3 * 86400 + 4 * 3600)).toBe('3 j 4 h')
	})
	it('formats hours + minutes under a day', () => {
		expect(formatUptime(5 * 3600 + 30 * 60)).toBe('5 h 30 min')
	})
	it('formats minutes under an hour', () => {
		expect(formatUptime(42 * 60)).toBe('42 min')
	})
	it('returns a dash for invalid input', () => {
		expect(formatUptime(-1)).toBe('—')
		expect(formatUptime(Number.NaN)).toBe('—')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && pnpm exec vitest run lib/stats/__tests__/format-uptime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `formatUptime`**

Create `apps/dashboard/lib/stats/format-uptime.ts`:

```ts
/** Human-readable uptime from seconds, e.g. "3 j 4 h", "5 h 30 min", "42 min". */
export function formatUptime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '—'
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	if (days > 0) return `${days} j ${hours} h`
	if (hours > 0) return `${hours} h ${minutes} min`
	return `${minutes} min`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && pnpm exec vitest run lib/stats/__tests__/format-uptime.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `ServerlessSystemPanel`**

Create `apps/dashboard/components/serverless-system-panel.tsx`:

```tsx
'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { StorageUsage, formatBytes } from '@/components/storage-usage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatUptime } from '@/lib/stats/format-uptime'
import { Clock, MemoryStick } from 'lucide-react'
import { useTranslations } from 'next-intl'

// Serverless system panel: fed by the on-box agent's periodic snapshot via the
// SSE system:info event (no SSH). Shows what is meaningful at snapshot cadence —
// storage, RAM, uptime. CPU/temp live in SystemStatsChart above.
export function ServerlessSystemPanel() {
	const t = useTranslations('dashboard.system')
	const { mqttOnline, activity } = useRecalboxEvents()
	const info = activity.lastSystemInfo

	if (mqttOnline === false) return null
	if (!info) return null

	const storage = info.storage ?? []
	const hasRam = info.memTotalMb > 0
	const ramPercent = hasRam ? Math.round((info.memUsedMb / info.memTotalMb) * 100) : 0

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<StorageUsage storage={storage} />
			{(hasRam || info.uptimeSeconds !== undefined) && (
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">{t('title')}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{hasRam && (
							<div className="space-y-1.5">
								<div className="flex items-center gap-2 text-sm">
									<MemoryStick className="size-4 text-muted-foreground" />
									<span className="font-medium">{t('ram')}</span>
									<span className="ml-auto font-semibold tabular-nums">{ramPercent}%</span>
								</div>
								<div className="h-2 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-accent transition-all"
										style={{ width: `${Math.min(100, Math.max(0, ramPercent))}%` }}
									/>
								</div>
								<div className="text-xs text-muted-foreground tabular-nums">
									{formatBytes(info.memUsedMb * 1024 ** 2)} / {formatBytes(info.memTotalMb * 1024 ** 2)}
								</div>
							</div>
						)}
						{info.uptimeSeconds !== undefined && (
							<div className="flex items-center gap-2 text-sm">
								<Clock className="size-4 text-muted-foreground" />
								<span className="font-medium">{t('uptime')}</span>
								<span className="ml-auto tabular-nums">{formatUptime(info.uptimeSeconds)}</span>
							</div>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `cd apps/dashboard && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec biome check components/serverless-system-panel.tsx lib/stats/format-uptime.ts lib/stats/__tests__/format-uptime.test.ts`
Expected: no errors. (`memUsedMb`/`memTotalMb` are in MB; multiply by `1024**2` for `formatBytes`.)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/lib/stats/format-uptime.ts apps/dashboard/lib/stats/__tests__/format-uptime.test.ts apps/dashboard/components/serverless-system-panel.tsx
git commit -m "feat(ui): add ServerlessSystemPanel (storage + RAM + uptime)"
```

---

### Task 7: Wire the homepage, guard `/api/monitoring`, add i18n

**Files:**
- Modify: `apps/dashboard/app/[locale]/page.tsx`
- Modify: `apps/dashboard/app/api/monitoring/route.ts`
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/fr.json`

**Interfaces:**
- Consumes: `ServerlessSystemPanel` (Task 6), `isServerlessMode()` (`@/lib/serverless`).

- [ ] **Step 1: Add i18n keys**

In `messages/en.json`, under `dashboard.system`, add:

```json
			"ram": "RAM",
			"uptime": "Uptime",
```

In `messages/fr.json`, under `dashboard.system`, add:

```json
			"ram": "RAM",
			"uptime": "Disponibilité",
```

(Keep JSON valid — add commas as needed; `ramUsed` already exists and is unchanged.)

- [ ] **Step 2: Branch the homepage on serverless mode**

In `app/[locale]/page.tsx`, add imports:

```ts
import { ServerlessSystemPanel } from '@/components/serverless-system-panel'
import { isServerlessMode } from '@/lib/serverless'
```

Replace `<MonitoringPanel />` (in the system `<section>`) with:

```tsx
					{isServerlessMode() ? <ServerlessSystemPanel /> : <MonitoringPanel />}
```

- [ ] **Step 3: Short-circuit `/api/monitoring` in serverless**

In `app/api/monitoring/route.ts`, add the import:

```ts
import { isServerlessMode } from '@/lib/serverless'
```

Immediately after the `getUser()` auth check inside `GET`, add:

```ts
	// Serverless: no SSH/HTTP link to the NAT'd box — the ServerlessSystemPanel is
	// fed by the agent via SSE instead. Never attempt SSH here.
	if (isServerlessMode()) return NextResponse.json({ perCore: [], storage: [] })
```

- [ ] **Step 4: Typecheck, lint, full test suite**

Run: `cd apps/dashboard && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec biome check app/\[locale\]/page.tsx app/api/monitoring/route.ts messages/en.json messages/fr.json && pnpm exec vitest run`
Expected: no errors; all tests pass.

- [ ] **Step 5: Build**

Run: `cd apps/dashboard && pnpm build`
Expected: exit 0 (`drizzle-kit migrate` runs against local SQLite, then `next build` succeeds).

- [ ] **Step 6: Runtime smoke (serverless mode, local SQLite)**

Start the app against a throwaway local DB in serverless mode and confirm the homepage renders without errors:

```bash
cd apps/dashboard
DEVDB="$(mktemp -u).db"
AGENT_ONLY_MEDIA=1 TURSO_DISABLE_REPLICA=1 TURSO_DATABASE_URL="file:$DEVDB" pnpm exec next dev -p 3942 &
# wait for readiness, then:
curl -sS -o /dev/null -w "%{http_code}\n" --retry-connrefused --retry 40 --retry-delay 1 http://localhost:3942/api/events   # expect 401 (route loads)
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3942/api/monitoring   # expect 401 (unauth) — with a session it returns {perCore:[],storage:[]}
# stop: pkill -f "next dev -p 3942"; rm -f "$DEVDB"*
```
Expected: server boots ("Ready"), no errors in the dev log. (Full visual verification of the panel needs a seeded session + an agent snapshot with `storage`; optional.)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/app/\[locale\]/page.tsx apps/dashboard/app/api/monitoring/route.ts apps/dashboard/messages/en.json apps/dashboard/messages/fr.json
git commit -m "feat(ui): show ServerlessSystemPanel on homepage; guard /api/monitoring in serverless"
```

---

## Self-Review

**Spec coverage:**
- Serverless panel = Storage + RAM + Uptime → Task 6 (`ServerlessSystemPanel`), Task 7 (wiring). ✓
- Transport via SSE `system:info` → Task 3 (event) + provider already stores it. ✓
- `storage` in schema/agent/ingest → Tasks 1, 2, 4. ✓
- Self-hosted unchanged; homepage branches by `isServerlessMode()` → Task 7. ✓
- `/api/monitoring` short-circuit in serverless → Task 7 Step 3. ✓
- i18n → Task 7 Step 1. ✓
- RAM already in the event (no pipeline change) → used directly in Task 6. ✓
- Testing: agent smoke (Task 4), ingest (Task 2), mapping (Task 3), uptime helper (Task 6). Component render not unit-tested (no jsdom/RTL — per Global Constraints); covered by typecheck + build + smoke (Task 7). ✓

**Placeholder scan:** none — every code/test step has concrete content.

**Type consistency:** `StorageMount` `{label, mount, usedBytes, sizeBytes, percent}` is used identically across schema (`.$type<StorageMount[]>()`), ingest (`AgentSnapshotInput.storage`), route (`StorageItem` zod), agent (dict keys), event (`SystemInfoEvent.storage`), and UI (`StorageUsage`). `formatUptime`, `formatBytes`, `StorageUsage`, `ServerlessSystemPanel`, `isServerlessMode` names match across tasks. `snapshotToSystemInfo`/`ingestSnapshot`/`SnapshotRow` match existing signatures.
