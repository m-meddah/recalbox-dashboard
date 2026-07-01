# Serverless deployment (Vercel + Turso + Blob + on-box agent)

This is the **serverless edition** runbook (Phase G of the SaaS pivot). It replaces the
self-hosted / Tailscale model in [deployment.md](deployment.md) and
[saas-deployment.md](saas-deployment.md).

## Architecture

```
Browser ─► Vercel (Next.js: UI + agent ingest API)
              │            ▲
              ▼            │ outbound HTTPS (NAT-friendly)
           Turso (libSQL)  │
              ▲            │
        Vercel Blob ◄──────┤  on-Recalbox Python agent
        (artwork)          │   • MQTT → sessions / now-playing
                           └── • snapshots, collection, commands, artwork
```

- **No always-on host at home, no scrobbler daemon, no inbound SSH.** The only
  always-on node is the Recalbox itself (on whenever there's anything to record).
- The **agent** ([agent/agent.py](../agent/agent.py)) pushes everything outbound:
  sessions, system snapshots, collection (gamelist), now-playing, and artwork; it
  polls a command queue for power/conf control.
- The cloud never reaches the box: no live MQTT, no SSH media proxy, no SSH control.

## Prerequisites

1. **Turso database** — already provisioned (`recalbox-dashboard`, account `fradz`).
   Schema is migrated automatically on boot (`instrumentation.ts`).
2. **Vercel account** + the Vercel CLI (`npm i -g vercel`) or the dashboard.
3. **A Vercel Blob store** (Storage → Blob → Create) → gives `BLOB_READ_WRITE_TOKEN`.

## Vercel project settings

- **Root Directory**: `apps/dashboard` (monorepo — set this in Project Settings → General).
- **Framework preset**: Next.js (auto-detected).
- **Install command**: leave default; Vercel runs pnpm at the repo root via the
  workspace. If install fails, set `pnpm install --filter @recalbox/dashboard...`.
- **Build command**: default (`next build`). See the **build caveat** below.
- `next.config.ts` already sets `output: 'standalone'` (harmless on Vercel) and
  externalizes `better-sqlite3`/`node-ssh` (test/SSH-only; not used at runtime in
  serverless).

## Environment variables (Vercel → Settings → Environment Variables)

| Variable | Value / notes |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://recalbox-dashboard-fradz.aws-eu-west-1.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso token (rotate with `turso db tokens create recalbox-dashboard`) |
| `TURSO_DISABLE_REPLICA` | Do **not** set this in Vercel's dashboard env vars — it's baked into the `build` script instead (see caveat). Setting it here would also disable the replica at runtime and slow down every DB read. |
| `BLOB_READ_WRITE_TOKEN` | from the Vercel Blob store. When set, artwork goes to Blob; absent → local-fs dev adapter. |
| `AGENT_ONLY_MEDIA` | `1` — `/api/media` serves only stored artwork (no SSH); a miss marks the file "wanted" for the agent to upload. |
| `BETTER_AUTH_SECRET` | 32+ chars (`openssl rand -base64 32`). **Must match** the secret used to encrypt creds at rest — never regenerate after first deploy. |
| `BETTER_AUTH_URL` | the public app URL, e.g. `https://<app>.vercel.app` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | CSV of accepted origins (the public URL + any custom domain); defaults to `BETTER_AUTH_URL` |
| `CREDENTIALS_SECRET` | optional; defaults to deriving from `BETTER_AUTH_SECRET`. Set only to rotate independently. |
| `NEXT_PUBLIC_APP_NAME` | optional display name |

The old self-hosted vars (`RECALBOX_HOST`, `MQTT_*`, `GAMELIST_BASE_PATH`,
`DATABASE_PATH`) are **not used** in serverless mode (Recalbox instances live in the
`recalboxes` table; connectivity is push-only).

## ⚠️ Build caveat — disable the embedded replica at build

`next build` collects page data by importing every route, including the agent
routes that import `@/lib/db`. With `TURSO_DATABASE_URL` set, the db singleton
opens the **embedded replica file**, and parallel build workers opening the same
file fail with `SQLite failure: database is locked` (observed locally, build
aborts on `/api/agent/now-playing`).

**Fix:** the `build` script in `package.json` sets `TURSO_DISABLE_REPLICA=1`
itself (`TURSO_DISABLE_REPLICA=1 next build`), so the build uses a direct-remote
libSQL client with no local file — no Vercel env var needed for this.

**Do not also set `TURSO_DISABLE_REPLICA` as a Vercel env var** — that applies at
runtime too, and the embedded replica is exactly what makes read-heavy endpoints
fast there. A warm Vercel function instance reuses the same libSQL client (and
its synced local file) across requests, so the replica does help despite the
function being "ephemeral" — only a cold start pays the initial sync cost.
Without it, every DB read becomes a Turso network round-trip; the recommender
alone (`/api/play-tonight/recommend`) fires a dozen+ queries per call and was
measured at ~1 minute with the replica disabled at runtime.

## First deploy

1. `vercel link` (or import the repo in the dashboard), set Root Directory =
   `apps/dashboard`, add the env vars above.
2. `vercel --prod` (or push to the production branch).
3. **Bootstrap the admin user** — Better Auth is invitation-only. Run the
   create-user script locally against Turso (it talks to the same DB):
   ```bash
   cd apps/dashboard
   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… TURSO_DISABLE_REPLICA=1 BETTER_AUTH_SECRET=… \
     pnpm exec tsx scripts/create-user.ts <email> <password>
   ```
   Then log in at the public URL and invite the rest of the family from `/admin`.

## Enroll each Recalbox agent

1. In the app, open the Recalbox's **edit page → Agent tokens → Generate**. Copy
   the one-time `config.json` snippet (it embeds the token + ingest URL).
2. On the box, drop the snippet into `/recalbox/share/system/sr-agent/config.json`
   and point `cloud_url` at `https://<app>/api/agent/ingest`. Tune intervals as
   needed (`snapshot_interval_sec`, `command_poll_interval_sec`,
   `collection_interval_sec`; set the last to `0` to disable the gamelist sweep).
3. Copy `agent/agent.py` to the box and autostart it via
   `/recalbox/share/system/custom.sh` (run with `python3`, see Phase 0 notes).
4. Verify in the app: a system snapshot appears, the collection imports, and
   now-playing shows the running game.

## Retire the old path

- **Scrobbler daemon**: not deployed — the agent records sessions. Remove it from
  any process manager.
- **SSH media proxy**: off via `AGENT_ONLY_MEDIA=1`. Covers populate lazily as the
  agent fulfills "wanted" uploads (first view of a cover queues it).
- **Live SSH control** (power / recalbox.conf): superseded by the **command queue**
  (edit page → Remote control), and the legacy SSH `PowerControls` + `/configuration`
  UI are **automatically hidden** when `AGENT_ONLY_MEDIA=1`.

## Resolved follow-ups (already in the build)

- **Connection / "LIVE" status** now derives from agent liveness (the token's
  `lastUsedAt`, touched on every agent request) when the cloud→box MQTT is down. *(70a5091)*
- **SSE on Vercel**: `/api/events` sets `maxDuration` and **self-closes ~10 s before
  it**, so the EventSource reconnects on a clean EOF instead of an abrupt platform
  kill; reconnect re-emits initial state. *(d5fabe1)*
- **SSH-only UI** (`PowerControls`, `/configuration`) is **hidden** when
  `AGENT_ONLY_MEDIA=1` (`isServerlessMode()`); the config pages also 404. *(4ab210e)*
- **Large gamelists (> ~4.5 MB)** are split into `<gameList>` chunks under
  `collection_max_xml_bytes` (server upserts per romPath, so chunks accumulate). *(441cc49)*

## Known limitations

- **now-playing staleness**: if a game crashes without an `endgame` MQTT event the
  row stays "playing" until the next start/stop (no in-game heartbeat).
- **Bulk artwork**: covers populate **lazily** (request-driven) — the whole
  collection's art isn't pre-uploaded; the first view of each cover queues it for
  the agent to upload.

## Post-deploy smoke checks

1. Log in at the public URL (invitation/admin works).
2. Agent box: `agent.log` shows `POST … -> 201` for snapshots/sessions.
3. A played game appears in now-playing; its cover loads (Blob URL) after the
   first request queues + the agent uploads it.
4. Queue a `conf`/`reboot` from the edit page → the box executes it (command queue).
