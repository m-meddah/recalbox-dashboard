# Recalbox Dashboard

Self-hostable dashboard for your Recalbox retrogaming console. Runs on a machine on the
same local network as the Recalbox (Pi 5), **not** on the Recalbox itself.

## Monorepo structure

```text
recalbox-dashboard/
├── apps/
│   └── dashboard/       # @recalbox/dashboard — Next.js 16 web app
└── packages/
    └── scraper-core/    # @recalbox/scraper-core — shared scraping lib (stub)
```

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9

## Getting started

```bash
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env.local
pnpm dev          # http://localhost:3000
```

## Scripts

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Start Next.js dev server with Turbopack |
| `pnpm build` | Build all packages |
| `pnpm lint` | Biome lint + check |
| `pnpm format` | Biome format (write) |
| `pnpm test` | Run all tests |
| `pnpm scrobbler:dev` | Start MQTT scrobbler in watch mode |

## Connections

| Protocol | Port | Purpose |
| -------- | ---- | ------- |
| MQTT | 1883 | Real-time game events |
| SSH | 22 | System stats snapshots + image proxy |
| SMB/Network | — | gamelist.xml collection data |

## Stack

- **Next.js 16** — App Router, Turbopack
- **Drizzle ORM + better-sqlite3** — local SQLite persistence
- **Tailwind CSS v4 + shadcn/ui** — UI
- **Biome** — linting & formatting (replaces ESLint + Prettier)

## Architecture

### Real-time events

Recalbox 10 publishes EmulationStation events on its local MQTT broker (mosquitto, port 1883).

**Relevant topic:** `Recalbox/WebAPI/EmulationStation/Event`

| `event` value | Mapped to |
| --- | --- |
| `rungame` | `game:start` |
| `endgame` | `game:stop` |
| `gamebrowsing` | `system:change` (deduplicated) |

The event pipeline is:

```text
Recalbox MQTT broker
  → lib/recalbox/mqtt-client.ts  (singleton, typed EventEmitter, auto-reconnect)
  → lib/recalbox/events.ts       (parseRecalboxMessage — stateless, never throws)
  → app/api/events/route.ts      (SSE endpoint, NodeJS runtime)
  → components/now-playing.tsx   (EventSource, no polling)
```

### Media proxy

Game cover images live on the Recalbox filesystem. The dashboard proxies them via SSH:

```text
GET /api/media?path=/recalbox/share/...
  → SSH exec: base64 -w 0 "<path>"
  → decode → return with Cache-Control: public, max-age=3600
```

Paths are whitelisted to `/recalbox/share/` to prevent path traversal.

## Roadmap

- [x] Ticket 1 — SSH system stats with live chart
- [x] Ticket 2 — Now Playing via MQTT + SSE
- [x] Ticket 3 — Game collection from gamelist.xml

## Collection API

### `POST /api/collection/sync`

Import complet depuis les `gamelist.xml` via SSH. Retourne un flux NDJSON de progression.

| Query param | Description |
| ----------- | ----------- |
| `system` | Sync un seul système (ex: `?system=snes`) |

Événements NDJSON :

```json
{ "type": "start", "totalSystems": 84 }
{ "type": "system", "system": "snes", "status": "done", "count": 1247 }
{ "type": "done", "totalGames": 9832, "durationMs": 4120 }
```

### `GET /api/collection`

Liste paginée de jeux.

| Query param | Type | Description |
| ----------- | ---- | ----------- |
| `system` | string | Filtrer par système |
| `favoritesOnly` | boolean | Favoris uniquement |
| `neverPlayed` | boolean | Jamais joués |
| `developer` | string | Filtrer par développeur |
| `search` | string | Recherche dans le nom |
| `sortBy` | `name\|rating\|lastPlayed\|releaseDate` | Tri |
| `sortDir` | `asc\|desc` | Direction du tri |
| `page` | number | Page (défaut: 1) |
| `pageSize` | number | Taille (max: 200, défaut: 50) |

### Chemins des disques durs

Les gamelist.xml sont lus via SSH. Les disques USB sont détectés automatiquement sous `/recalbox/share/externals/usb*/recalbox/roms/`.

## License

MIT
