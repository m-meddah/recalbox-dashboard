# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## First-time setup

```bash
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env.local
# Edit .env.local: set RECALBOX_HOST, RECALBOX_SSH_USER, RECALBOX_SSH_PASSWORD
pnpm dev
```

## Commands

```bash
pnpm dev:all          # Next.js + scrobbler daemon together (recommended for dev)
pnpm dev:all:mobile   # Same + accessible sur le réseau local (0.0.0.0)
pnpm dev              # Next.js dev server only (Turbopack) — http://localhost:3000
pnpm build            # Build all packages
pnpm start            # Production server (after build)
pnpm lint             # Biome lint + check
pnpm format           # Biome format (write)
pnpm test             # Run all tests (Vitest)
pnpm scrobbler:dev    # Scrobbler daemon with auto-reload (separate process)
pnpm seed:dev         # Generate 200 fake sessions over 90 days
pnpm seed:dev -- --clear  # Delete seeded data
```

Encrypt plaintext SSH/IGDB secrets at rest (idempotent; safe to re-run):
```bash
pnpm --filter @recalbox/dashboard exec tsx scripts/encrypt-credentials.ts            # Encrypt now
pnpm --filter @recalbox/dashboard exec tsx scripts/encrypt-credentials.ts --dry-run  # Preview without writing
```

The standalone `tsx` script does **not** auto-load `.env.local` (unlike the Next.js app), so `CREDENTIALS_SECRET`/`BETTER_AUTH_SECRET` must already be in the environment or the script refuses to run. The encryption key must match the one the running app uses, otherwise decryption fails. Pass it inline (strip any surrounding quotes the way dotenv does):
```bash
RAW=$(grep -E '^BETTER_AUTH_SECRET=' apps/dashboard/.env.local | head -1 | cut -d= -f2-)
RAW="${RAW%\"}"; RAW="${RAW#\"}"
BETTER_AUTH_SECRET="$RAW" pnpm --filter @recalbox/dashboard exec tsx scripts/encrypt-credentials.ts
```

Tests run in the `apps/dashboard` workspace; run a single test file (use `pnpm exec`, there is no `vitest`/`drizzle-kit` package script):
```bash
cd apps/dashboard && pnpm exec vitest run lib/recalbox/__tests__/events.test.ts
```

Database migrations via Drizzle Kit (env-aware: targets Turso when `TURSO_DATABASE_URL` is set, else local SQLite):
```bash
cd apps/dashboard && pnpm exec drizzle-kit generate
cd apps/dashboard && pnpm exec drizzle-kit migrate
```

Build the scrobbler as a standalone bundle (for Docker/production):

```bash
pnpm --filter @recalbox/dashboard build:scrobbler
```

Test the Docker build:

```bash
docker build -t recalbox-dashboard:dev .
docker run --rm -p 3000:3000 \
  -e RECALBOX_HOST=recalbox.local \
  -e RECALBOX_SSH_USER=root \
  -e RECALBOX_SSH_PASSWORD=recalboxroot \
  recalbox-dashboard:dev
```

## Architecture

### Monorepo

```
apps/dashboard/  # @recalbox/dashboard — Next.js 16 App Router web app
agent/           # sr-agent — dependency-free Python agent that runs ON each Recalbox (serverless edition)
docker/          # s6-overlay service definitions (single-container self-hosted deploy)
docs/            # deployment, mesh-VPN, serverless & multi-user guides
```

### Two deployment models

1. **Self-hosted (default)** — runs on a machine on your LAN (or reachable across homes via a mesh VPN); **pulls** from the Recalbox over SSH/MQTT and persists to **local SQLite**. This is the original model and the two-process setup below.
2. **Serverless** — the Next.js app runs on Vercel against a **Turso/libSQL** cloud DB, and a **Python agent on each Recalbox pushes** data out over HTTPS (outbound → NAT-friendly, no always-on device at home). Enabled by env (`TURSO_DATABASE_URL`, `AGENT_ONLY_MEDIA=1`, …) — see `docs/serverless-deploy.md`. `lib/serverless.ts` `isServerlessMode()` turns SSH-only features off (media proxy → object storage; power/recalbox.conf editing → the agent command queue), so their UI is hidden.

### Two separate processes (self-hosted)

The dashboard runs as two independent processes that share the same SQLite database (WAL mode, concurrent access safe):

1. **Next.js app** (`pnpm dev`) — serves the UI and API routes
2. **Scrobbler daemon** (`pnpm scrobbler:dev`) — listens to MQTT events and writes sessions to SQLite even when no browser is open

In serverless mode the scrobbler is **not** needed — the on-box agent does the scrobbling and pushes outbound.

### Key directories in `apps/dashboard/`

- `app/` — Next.js App Router pages and API routes; pages live under `app/[locale]/`
- `app/recalbox-events-provider.tsx` — app-level wrapper that opens the SSE connection and broadcasts MQTT events to all children via context
- `lib/db/` — Drizzle ORM schema (`schema.ts`), queries (`queries.ts`), and db singleton (`index.ts`)
- `lib/recalbox/` — All Recalbox integration: MQTT client, SSH client, gamelist XML parser, userdata `.ini` parser, system stats
- `lib/scrobbler/` — Session manager for the scrobbler daemon
- `lib/stats/` — Playtime calculators and formatters
- `lib/settings/` — App settings schemas (`schemas.ts`) and defaults (`defaults.ts`); persisted in DB via `lib/config-store.ts`
- `lib/retroachievements/` — RetroAchievements.org API integration: auth, game matching, achievement sync, cache
- `lib/notifications/` — Web Push notification service, VAPID key management, push subscriptions; cross-process delivery uses a 5-second DB poll in the SSE endpoint (scrobbler writes, Next.js reads) with an atomic `pushedInApp` flag to prevent duplicate delivery
- `lib/super-retrogamers/` — Super Retrogamers community site integration (game page lookup, slug matching)
- `lib/wrapped/` — Annual recap generator (playtime heatmap, top games, shareable images via Remotion)
- `lib/collection-health.ts` — standalone scrape diagnostic (missing cover/description per system)
- `lib/config.ts` — Typed config façade; reads from DB via `config-store.ts` (env vars used as fallback at first run)
- `components/` — React components; `components/ui/` is shadcn/ui
- `messages/` — i18n translation files (`en.json`, `fr.json`)
- `i18n/` — next-intl routing config (`routing.ts`) and middleware helpers

### Real-time event pipeline

```
Recalbox MQTT broker
  → lib/recalbox/mqtt-client.ts       (singleton EventEmitter, auto-reconnect)
  → lib/recalbox/events.ts            (parseRecalboxMessage — stateless, never throws)
  → app/api/events/route.ts           (SSE endpoint, Node.js runtime)
  → app/recalbox-events-provider.tsx  (app-level EventSource, context broadcast)
  → components/now-playing.tsx        (consumes context, no direct polling)
```

In serverless mode there is no SSE stream at all: `app/api/events/route.ts` returns `204` immediately, before auth and before any DB access. Live state is instead computed once per page render, server-side, in `app/[locale]/layout.tsx` via `lib/sse/build-seed-state.ts`, and handed to `RecalboxEventsProvider` as an `initialState` seed with `live={false}`; the user picks up fresh state via `router.refresh()`. Self-hosted mode is unchanged: the SSE route sets `maxDuration` and self-closes before it so the EventSource reconnects cleanly on Vercel-style platforms.

### Media proxy

`GET /api/media?path=/recalbox/share/...` proxies game cover images from the Recalbox filesystem over SSH (`base64 -w 0`). Paths are whitelisted to `/recalbox/share/` and shell-quoted before execution. A `test -f` check runs first to return a clean 404 for missing files.

In serverless mode (`AGENT_ONLY_MEDIA=1`), `/api/media` instead redirects to artwork mirrored to object storage (`lib/storage`: Vercel Blob, or a local-fs dev adapter served by `/api/blob`); a miss marks the path "wanted" and the agent uploads it on its next poll (request-driven, no bulk sweep).

### On-box agent (serverless edition)

`agent/agent.py` is a dependency-free Python agent that runs on each Recalbox (RecalboxOS ships Python 3 + paho-mqtt; Node is absent). Enrolled with a per-box token (minted from the Recalbox **edit page** or `scripts/create-agent-token.ts`), it pushes outbound over HTTPS — every agent route authenticates with a `Bearer` token resolved to a `recalbox_id` (the body's recalbox id is ignored):

- `POST /api/agent/ingest` — play sessions (pairs MQTT game:start/stop locally; buffers + retries offline)
- `POST /api/agent/snapshots` — CPU/RAM/temp/uptime read from `/proc` + `/sys`
- `POST /api/agent/collection` — raw `gamelist.xml` (+ userdata), parsed/upserted server-side; large lists are chunked under the cloud body limit
- `POST /api/agent/now-playing` — live game state
- `GET/POST /api/agent/artwork` — poll "wanted" images / upload them
- `GET /api/agent/commands` + `POST /api/agent/commands/result` — poll the command queue, report results

Token management: `/api/recalboxes/[id]/agent-tokens`. Enqueue control commands: `/api/recalboxes/[id]/commands` (owner-only). See `agent/README.md` and `docs/serverless-deploy.md`.

### i18n

All UI routes live under `app/[locale]/` (locales: `en`, `fr`; default: `en`). The middleware in `proxy.ts` handles both i18n routing (via `next-intl`) and the setup wizard redirect: if the `setup_done` cookie is absent, every request is redirected to `/{locale}/welcome`.

### Multi-Recalbox support

Each Recalbox instance is a row in the `recalboxes` table (host, SSH creds, MQTT port, color, emoji). The `host` may be a LAN hostname/IP or a mesh-VPN (tailnet) address — see `docs/mesh-vpn-setup.md` for connecting machines across homes. All data tables (`sessions`, `games`, `system_snapshots`, `ra_game_mapping`, `notifications`) carry a `recalbox_id` foreign key.

The active instance is selected via an `active_recalbox_id` cookie so each browser session can point to a different Recalbox independently. `SshPool` and `MqttPool` (`lib/recalbox/`) maintain one client per Recalbox on demand, reconnecting automatically. The scrobbler subscribes to all non-archived instances at startup and reacts to add/remove events in real-time.

In Docker, both the Next.js app and the scrobbler run inside a **single container** managed by [s6-overlay](https://github.com/just-containers/s6-overlay); service definitions live in `docker/s6-rc.d/`.

### Database schema (Drizzle; local SQLite or Turso/libSQL)

The DB driver is env-driven (`lib/db/index.ts`): local **SQLite** by default, or **Turso/libSQL** when `TURSO_DATABASE_URL` is set. In serverless the web process uses a libSQL **embedded replica** (local reads, write-through to Turso); the scrobbler and one-shot scripts use direct-remote. Kill switch: `TURSO_DISABLE_REPLICA=1`.

- `recalboxes` — registered Recalbox instances (connection params, color, emoji, archived flag)
- `sessions` — game play sessions (start/end timestamps, romPath, system, duration, recalbox_id; `source` can be `agent`)
- `games` — collection imported from `gamelist.xml` (over SSH self-hosted, or pushed by the agent)
- `system_snapshots` — periodic CPU/RAM/temp snapshots (SSH, or agent push)
- `settings` — flat key-value store for all app config (format: `scope.key`)
- `notifications` / `push_subscriptions` — in-app and Web Push notification state
- `ra_achievements` / `ra_game_progress` / `ra_game_mapping` / `ra_cache` — RetroAchievements sync data
- `sr_cache` — Super Retrogamers page lookup cache
- `wrapped_cache` — pre-generated annual recap data keyed by `(year, locale)`
- `agent_tokens` — per-Recalbox machine tokens for the on-box agent (sha256-hashed at rest)
- `agent_commands` — remote-control command queue (power/conf/launch), agent-polled
- `now_playing` — live game state pushed by the agent (relayed to browsers via the SSE DB poll)
- `artwork` — game artwork mirrored to object storage (box path → stored URL; null = "wanted")

### Configuration

On first run the setup wizard (`/welcome`) collects connection details and stores them in the `settings` table. Subsequent reads go through `lib/config-store.ts` (singleton, EventEmitter-based). The `.env.local` file is only needed to bootstrap before the wizard runs or to override DB-stored values.

The `@` path alias resolves to `apps/dashboard/` (configured in `tsconfig.json` and `vitest.config.ts`).

## Code style

Biome enforces: tabs for indentation, single quotes, no semicolons, trailing commas. Tests live in `__tests__/` subdirectories next to the code they test.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(area): description`, `fix(area): description`, `docs(area): description`.
