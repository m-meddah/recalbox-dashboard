# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Next.js dev server (Turbopack) — http://localhost:3000
pnpm build            # Build all packages
pnpm start            # Production server (after build)
pnpm lint             # Biome lint + check
pnpm format           # Biome format (write)
pnpm test             # Run all tests (Vitest)
pnpm scrobbler:dev    # Scrobbler daemon with auto-reload (separate process)
pnpm seed:dev         # Generate 200 fake sessions over 90 days
pnpm seed:dev -- --clear  # Delete seeded data
```

Tests run in the `apps/dashboard` workspace; run a single test file:
```bash
pnpm --filter @recalbox/dashboard vitest run lib/recalbox/__tests__/events.test.ts
```

Database migrations via Drizzle Kit:
```bash
pnpm --filter @recalbox/dashboard drizzle-kit generate
pnpm --filter @recalbox/dashboard drizzle-kit migrate
```

Build the scrobbler as a standalone bundle (for Docker/production):

```bash
pnpm --filter @recalbox/dashboard build:scrobbler
```

## Architecture

### Monorepo

```
apps/dashboard/        # @recalbox/dashboard — Next.js 16 App Router web app
packages/scraper-core/ # @recalbox/scraper-core — shared scraping lib (stub)
```

### Two separate processes

The dashboard runs as two independent processes that share the same SQLite database (WAL mode, concurrent access safe):

1. **Next.js app** (`pnpm dev`) — serves the UI and API routes
2. **Scrobbler daemon** (`pnpm scrobbler:dev`) — listens to MQTT events and writes sessions to SQLite even when no browser is open

### Key directories in `apps/dashboard/`

- `app/` — Next.js App Router pages and API routes; pages live under `app/[locale]/`
- `lib/db/` — Drizzle ORM schema (`schema.ts`), queries (`queries.ts`), and db singleton (`index.ts`)
- `lib/recalbox/` — All Recalbox integration: MQTT client, SSH client, gamelist XML parser, userdata `.ini` parser, system stats
- `lib/scrobbler/` — Session manager for the scrobbler daemon
- `lib/stats/` — Playtime calculators and formatters
- `lib/settings/` — App settings schemas (`schemas.ts`) and defaults (`defaults.ts`); persisted in DB via `lib/config-store.ts`
- `lib/retroachievements/` — RetroAchievements.org API integration: auth, game matching, achievement sync, cache
- `lib/notifications/` — Web Push notification service, VAPID key management, push subscriptions
- `lib/super-retrogamers/` — Super Retrogamers community site integration (game page lookup, slug matching)
- `lib/wrapped/` — Annual recap generator (playtime heatmap, top games, shareable images via Remotion)
- `lib/config.ts` — Typed config façade; reads from DB via `config-store.ts` (env vars used as fallback at first run)
- `components/` — React components; `components/ui/` is shadcn/ui
- `messages/` — i18n translation files (`en.json`, `fr.json`)
- `i18n/` — next-intl routing config (`routing.ts`) and middleware helpers

### Real-time event pipeline

```
Recalbox MQTT broker
  → lib/recalbox/mqtt-client.ts  (singleton EventEmitter, auto-reconnect)
  → lib/recalbox/events.ts       (parseRecalboxMessage — stateless, never throws)
  → app/api/events/route.ts      (SSE endpoint, Node.js runtime)
  → components/now-playing.tsx   (EventSource, no polling)
```

### Media proxy

`GET /api/media?path=/recalbox/share/...` proxies game cover images from the Recalbox filesystem over SSH (`base64 -w 0`). Paths are whitelisted to `/recalbox/share/` and shell-quoted before execution. A `test -f` check runs first to return a clean 404 for missing files.

### i18n

All UI routes live under `app/[locale]/` (locales: `en`, `fr`; default: `en`). The middleware in `proxy.ts` handles both i18n routing (via `next-intl`) and the setup wizard redirect: if the `setup_done` cookie is absent, every request is redirected to `/{locale}/welcome`.

### Database schema (SQLite via Drizzle)

- `sessions` — game play sessions (start/end timestamps, romPath, system, duration)
- `games` — collection imported from `gamelist.xml` files via SSH (metadata, artwork paths, favorites, region)
- `system_snapshots` — periodic CPU/RAM/temp snapshots from SSH
- `settings` — flat key-value store for all app config (format: `scope.key`)
- `notifications` / `push_subscriptions` — in-app and Web Push notification state
- `ra_achievements` / `ra_game_progress` / `ra_game_mapping` / `ra_cache` — RetroAchievements sync data
- `sr_cache` — Super Retrogamers page lookup cache
- `wrapped_cache` — pre-generated annual recap data keyed by `(year, locale)`

### Configuration

On first run the setup wizard (`/welcome`) collects connection details and stores them in the `settings` table. Subsequent reads go through `lib/config-store.ts` (singleton, EventEmitter-based). The `.env.local` file is only needed to bootstrap before the wizard runs or to override DB-stored values.

The `@` path alias resolves to `apps/dashboard/` (configured in `tsconfig.json` and `vitest.config.ts`).

## Code style

Biome enforces: tabs for indentation, single quotes, no semicolons, trailing commas. Tests live in `__tests__/` subdirectories next to the code they test.
