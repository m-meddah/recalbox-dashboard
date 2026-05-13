# Recalbox Dashboard

Self-hostable dashboard for your Recalbox retrogaming console. Runs on a machine on the
same local network as the Recalbox (Pi 5), **not** on the Recalbox itself.

## Installation

### With Docker (recommended)

```bash
curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
# Edit RECALBOX_HOST if your Recalbox has a different hostname
nano docker-compose.yml
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and follow the setup wizard.

Works on: **x86_64**, **ARM64** (Raspberry Pi 4/5, Apple Silicon, ARM NAS).

#### Updating

```bash
docker compose pull && docker compose up -d
```

#### Backup

```bash
docker run --rm -v recalbox-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/backup-$(date +%Y%m%d).tar.gz /data
```

### From source

See [Getting started](#getting-started) below.

---

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

Paths are whitelisted to `/recalbox/share/` to prevent path traversal. The path is
shell-quoted before execution to handle filenames with apostrophes or special characters.
A `test -f` check is performed first so that images referenced in `gamelist.xml` but
missing on disk return a clean 404 instead of a broken image.

## Running the scrobbler

The scrobbler is a separate daemon that listens to MQTT events and records every game
session to SQLite. It runs independently of the dashboard web process and keeps logging
even when no browser has the dashboard open.

### Development (two terminals)

```bash
pnpm dev              # Dashboard — http://localhost:3000
pnpm scrobbler:dev    # Scrobbler with auto-reload on file changes
```

### Production (PM2)

```bash
pm2 start npm --name "recalbox-dashboard" -- start
pm2 start npx --name "recalbox-scrobbler" -- tsx apps/dashboard/scripts/start-scrobbler.ts
pm2 save && pm2 startup
```

### Production (systemd)

A ready-to-use unit file is provided at
`apps/dashboard/docs/systemd-examples/recalbox-scrobbler.service`.

```bash
sudo cp apps/dashboard/docs/systemd-examples/recalbox-scrobbler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now recalbox-scrobbler
sudo journalctl -u recalbox-scrobbler -f
```

Both processes share the same SQLite database (WAL mode is active, concurrent access is safe).

## Roadmap

- [x] Ticket 1 — SSH system stats with live chart
- [x] Ticket 2 — Now Playing via MQTT + SSE
- [x] Ticket 3 — Game collection from gamelist.xml
- [x] Ticket 4 — Scrobble daemon (session tracking)
- [x] Ticket 5 — Stats page with heatmap, charts and streaks
- [x] Ticket 6 — Runtime settings UI with hot-reload
- [x] Ticket 7 — Docker Compose self-hosting with s6 + multi-arch CI

## Stats (`/stats/[period]`)

Gaming stats dashboard inspired by Last.fm + GitHub contributions.

| Period | URL |
| ------ | --- |
| This week | `/stats/week` |
| This month | `/stats/month` |
| This year | `/stats/year` |
| All time | `/stats/all` |

**Components:**

- KPI cards (playtime, games, sessions, current streak) with delta vs previous period
- GitHub-style heatmap (365 days, CSS grid, intensity 0–4)
- Daily playtime curve (Recharts AreaChart, grouped by week for year/all)
- Top 10 games (progress bars, "Show more" → 50)
- Breakdown by system (donut chart, click → `/collection/<system>`)
- Consecutive days streak card (including all-time record)
- Last 20 sessions timeline (ScrollArea)

**Test data seed:**

```bash
pnpm seed:dev              # Generate 200 sessions over 90 days
pnpm seed:dev -- --clear   # Delete seeded data
```

## Collection API

### `POST /api/collection/sync`

Full import from `gamelist.xml` files via SSH. Returns an NDJSON progress stream.

| Query param | Description |
| ----------- | ----------- |
| `system` | Sync a single system (e.g. `?system=snes`) |

NDJSON events:

```json
{ "type": "start", "totalSystems": 84 }
{ "type": "system", "system": "snes", "status": "done", "count": 1247 }
{ "type": "done", "totalGames": 9832, "durationMs": 4120 }
```

### `GET /api/collection`

Paginated list of games.

| Query param | Type | Description |
| ----------- | ---- | ----------- |
| `system` | string | Filter by system |
| `favoritesOnly` | boolean | Favorites only |
| `neverPlayed` | boolean | Never played |
| `developer` | string | Filter by developer |
| `search` | string | Search by name |
| `sortBy` | `name\|rating\|lastPlayed\|releaseDate` | Sort field |
| `sortDir` | `asc\|desc` | Sort direction |
| `page` | number | Page (default: 1) |
| `pageSize` | number | Size (max: 200, default: 50) |

### `GET /api/collection/regions`

Returns the regions available in the collection (useful for filter buttons).

| Query param | Description |
| ----------- | ----------- |
| `system` | Restrict to regions of a single system |

### User data (`gamelist-userdata.ini`)

Recalbox stores user preferences (favorites, hidden games, play statistics) in a
`gamelist-userdata.ini` file separate from the scraped `gamelist.xml`. The sync reads
both files and merges the data — `.ini` values take priority over the XML.

File format:

```text
relative/path/to/rom.ext:key1=val1,key2=val2,...
```

Handled keys: `favorite`, `hidden`, `playcount`, `lastplayed`.

### Drive paths

`gamelist.xml` files are read via SSH. USB drives are detected automatically under
`/recalbox/share/externals/usb*/recalbox/roms/`.

## License

MIT
