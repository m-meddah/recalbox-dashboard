# Recalbox Dashboard

**A companion analytics dashboard for Recalbox.** Historical session tracking,
playtime statistics, achievement progress, and an annual recap of your retrogaming year.
Supports multiple Recalbox instances from a single dashboard.

Runs on a machine on the same local network as your Recalbox — **not** on the Recalbox itself.

## Why this dashboard?

Recalbox ships with an excellent built-in [Web Manager](https://wiki.recalbox.com/fr/basic-usage/features/webmanager)
at `http://recalbox.local/` for live monitoring, config editing, and BIOS/ROM
management. **This project does not replace it** — it complements it.

The Web Manager answers *"How's my Recalbox right now?"*. This dashboard
answers *"How have I used my Recalbox over time?"* — think Last.fm for
retrogaming.

| Recalbox Web Manager (built-in) | Recalbox Dashboard (this project) |
| --- | --- |
| Live CPU temp, RAM, storage | Historical playtime charts |
| Edit `recalbox.conf` | Activity heatmap (GitHub-style) |
| Upload BIOS / ROMs | Top games, streaks, sessions timeline |
| Screenshots and logs | Game collection browsable & filterable |
| Mobile-friendly | Mobile-friendly + PWA installable (coming) |

### Where this fits in the Recalbox ecosystem

Recalbox has a rich ecosystem of community tools, each serving a different
purpose:

- **Web Manager** (built-in) — operations: live monitoring, config, BIOS/ROM management
- **[RecalboxHomeAssistant](https://github.com/recalbox/RecalboxHomeAssistant)** — control & automation: launch/stop games, trigger smart-home automations, voice commands
- **This dashboard** — analytics: long-term playtime history, stats, achievement tracking, annual recap

These tools are **orthogonal, not competing**. The Web Manager runs your
Recalbox, RecalboxHomeAssistant controls it from your smart home, and this
dashboard tells you how you've used it over time. If you use Home Assistant,
run both: RecalboxHomeAssistant for control, this dashboard for analytics.

Use both: the Web Manager for ops, this dashboard for analytics.

## Installation

### With Docker (recommended)

```bash
curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
nano docker-compose.yml   # set RECALBOX_HOST to your Recalbox IP or hostname
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). Go to **Settings** to adjust the connection parameters if needed.

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

See [docs/deployment.md](docs/deployment.md) for Synology, Unraid, Traefik, and Raspberry Pi guides.

---

## Install as an app (PWA)

The dashboard is a Progressive Web App — you can install it on your home screen for a native-like experience.

| Platform | Instructions |
| --- | --- |
| **iPhone / iPad** | Safari → tap Share (□↑) → **Add to Home Screen** |
| **Android** | Chrome → menu (⋮) → **Add to Home Screen** |
| **Desktop** | Chrome/Edge → click the install icon (⊕) in the address bar |

> **HTTPS required** — PWA installation and Web Push notifications require a secure context. See [docs/https-setup.md](docs/https-setup.md) for Caddy, Tailscale, and Cloudflare Tunnel options.
> **Web Push on iOS** requires the app to be installed as a PWA first (iOS 16.4+).

### From source

See [Getting started](#getting-started) below.

---

## Monorepo structure

```text
recalbox-dashboard/
├── apps/
│   └── dashboard/       # @recalbox/dashboard — Next.js 16 web app
├── packages/
│   └── scraper-core/    # @recalbox/scraper-core — shared scraping lib (stub)
└── docker/              # s6-overlay service definitions and migration script
```

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9

## Getting started

```bash
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env.local
# Edit .env.local: set RECALBOX_HOST, RECALBOX_SSH_USER, RECALBOX_SSH_PASSWORD
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
| `pnpm seed:dev` | Generate 200 fake sessions over 90 days |

## Ecosystem

The dashboard can publish analytics to MQTT so other tools can consume playtime and session data:

- **Home Assistant** — enable **Home Assistant Discovery** in Settings → MQTT Publish to auto-register sensors (`playtime_today`, `playtime_week`, `streak_current`, etc.)
- **Node-RED, any MQTT client** — subscribe to `RecalboxDashboard/#` topics (prefix configurable)

See [docs/mqtt-api.md](docs/mqtt-api.md) for the full topic contract.

## Connections

| Protocol | Port | Purpose |
| -------- | ---- | ------- |
| MQTT | 1883 | Real-time game events |
| SSH | 22 | System stats snapshots + image proxy |

## Stack

- **Next.js 16** — App Router, Turbopack
- **Drizzle ORM + better-sqlite3** — local SQLite persistence
- **Tailwind CSS v4 + shadcn/ui** — UI
- **Biome** — linting & formatting (replaces ESLint + Prettier)

## Architecture

### Two processes, one database

The dashboard runs as two independent processes sharing the same SQLite database (WAL mode, concurrent access safe):

1. **Next.js app** — serves the UI and REST/SSE API routes
2. **Scrobbler daemon** — listens to MQTT events and writes sessions to SQLite, even when no browser is open

In Docker, both are managed by [s6-overlay](https://github.com/just-containers/s6-overlay) inside a single container.

### Real-time events

```text
Recalbox MQTT broker
  → lib/recalbox/mqtt-client.ts  (singleton, typed EventEmitter, auto-reconnect)
  → lib/recalbox/events.ts       (parseRecalboxMessage — stateless, never throws)
  → app/api/events/route.ts      (SSE endpoint, NodeJS runtime)
  → components/now-playing.tsx   (EventSource, no polling)
```

**Relevant topic:** `Recalbox/WebAPI/EmulationStation/Event`

| `event` value | Mapped to |
| --- | --- |
| `rungame` | `game:start` |
| `endgame` | `game:stop` |
| `gamebrowsing` | `system:change` (deduplicated) |

### Multi-Recalbox support

The dashboard manages **N Recalbox instances** from a single install.

Each Recalbox is stored in the `recalboxes` DB table with its connection parameters
(host, SSH credentials, MQTT port). All data tables (`sessions`, `games`,
`system_snapshots`, `ra_game_mapping`, `notifications`) carry a `recalbox_id` foreign key.

**Active Recalbox** is selected via a cookie (`active_recalbox_id`) so each browser
session can point to a different Recalbox independently. A header switcher appears when
more than one Recalbox is configured.

| Route | Description |
| ----- | ----------- |
| `GET /recalboxes` | Management list — add, edit, archive |
| `GET /recalboxes/add` | Add a new Recalbox |
| `GET /recalboxes/:id/edit` | Edit, archive, or delete a Recalbox |
| `GET /all-recalboxes` | Aggregated playtime and session view |
| `PUT /api/recalboxes/active` | Switch active Recalbox (sets cookie) |
| `GET /api/recalboxes` | List all Recalboxes |
| `POST /api/recalboxes` | Create a Recalbox |
| `PUT /api/recalboxes/:id` | Update a Recalbox |
| `DELETE /api/recalboxes/:id` | Delete a Recalbox |
| `POST /api/recalboxes/:id/test-connection` | Test SSH + MQTT connectivity |

SSH and MQTT connections are managed by **pools** (`SshPool`, `MqttPool`) that create
one client per Recalbox on demand and reconnect automatically. The scrobbler daemon
subscribes to all non-archived Recalboxes and reacts to add/remove events in real-time.

### Media proxy

```text
GET /api/media?path=/recalbox/share/...
  → SSH exec: base64 -w 0 "<path>"
  → decode → return with Cache-Control: public, max-age=3600
```

Paths are whitelisted to `/recalbox/share/` to prevent path traversal.
A `test -f` check is performed first so that images missing on disk return a clean 404.

## Running the scrobbler

### Development (two terminals)

```bash
pnpm dev              # Dashboard — http://localhost:3000
pnpm scrobbler:dev    # Scrobbler with auto-reload on file changes
```

### Production without Docker (PM2)

```bash
pm2 start npm --name "recalbox-dashboard" -- start
pm2 start npx --name "recalbox-scrobbler" -- tsx apps/dashboard/scripts/start-scrobbler.ts
pm2 save && pm2 startup
```

### Production without Docker (systemd)

```bash
sudo cp apps/dashboard/docs/systemd-examples/recalbox-scrobbler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now recalbox-scrobbler
```

## Roadmap

- [x] Ticket 1 — SSH system stats with live chart
- [x] Ticket 2 — Now Playing via MQTT + SSE
- [x] Ticket 3 — Game collection from gamelist.xml
- [x] Ticket 4 — Scrobbler daemon (session tracking)
- [x] Ticket 5 — Stats page with heatmap, charts and streaks
- [x] Ticket 6 — Runtime settings UI with hot-reload
- [x] Ticket 7 — Docker Compose self-hosting with s6 + multi-arch CI
- [x] Ticket 8 — Internationalisation FR/EN (next-intl, locale prefix routing)
- [x] Ticket 9 — RetroAchievements integration with auto-username detection
- [x] Ticket 10 — Super Retrogamers cross-project linking (slug matching, proxy routes, UI touchpoints, API spec — see [docs/super-retrogamers-api-spec.md](docs/super-retrogamers-api-spec.md))
- [x] Ticket 11 — Recalbox Wrapped: annual gaming recap at `/wrapped/:year` — glassmorphism slides, tap/swipe navigation, easter eggs, shareable PNG images, archive page
- [x] Ticket 12 — Push notifications: in-app toasts via SSE + Web Push (background), achievement unlocks, streak milestones, annual Wrapped alert, notification center bell, quiet hours, per-type toggles
- [x] Ticket 14 — Multi-Recalbox support: manage N Recalbox instances from one dashboard, per-user active switcher (cookie), SSH/MQTT connection pools, aggregated view, CRUD management UI
- [x] Ticket 15 — MQTT Publish: push analytics (playtime, streaks, sessions, last game) to MQTT topics for Home Assistant, Node-RED and any MQTT client; Home Assistant Discovery auto-registers 8 sensors
- [x] Ticket 16 — Multi-disc / .m3u Generator: detect multi-disc games (PSX, Saturn, Sega CD…) from the synced collection, generate `.m3u` playlist files with LF line endings, deploy to Recalbox over SSH from a dedicated `/collection/m3u` page

## RetroAchievements integration

The dashboard integrates with [RetroAchievements](https://retroachievements.org) to track achievement progress across your game library.

### Setup

1. Go to **Settings → RetroAchievements**
2. Enable the integration
3. Your **username** is auto-detected from `recalbox.conf` via SSH (click 🔄 to refresh)
4. Generate a **Web API Key** at [retroachievements.org/controlpanel.php](https://retroachievements.org/controlpanel.php) and paste it in
5. Click **Test Connection** to verify
6. Save — background sync starts automatically

### Features

| Feature | Description |
| ------- | ----------- |
| `/achievements` | Profile header, unlock heatmap (365 days), recent unlocks, top games by completion |
| Game badges | Trophy icon on game covers that have unlocked achievements |
| Background sync | Configurable interval (default 30 min), runs in the scrobbler daemon |
| ROM matching | Fuzzy title matching (≥80% similarity) to link local ROMs to RA games |
| Manual linking | `POST /api/retroachievements/match` to link any ROM manually |

### API routes

| Route | Description |
| ----- | ----------- |
| `GET /api/retroachievements/profile` | User profile (points, motto, avatar) |
| `GET /api/retroachievements/recent?count=20` | Recent achievement unlocks |
| `GET /api/retroachievements/progress` | All game progress from DB |
| `GET /api/retroachievements/game/:id` | Single game progress |
| `POST /api/retroachievements/sync` | Force a sync |
| `POST /api/retroachievements/test-connection` | Test API credentials |
| `GET /api/retroachievements/match?romPath=&system=` | Find RA game for a ROM |
| `POST /api/retroachievements/match` | Set manual ROM → RA game mapping |
| `GET /api/recalbox/conf?key=global.retroachievements.username` | Read whitelisted keys from `recalbox.conf` |

### Security

- API key masked (`***`) in all `GET /api/settings` responses
- `recalbox.conf` read uses a strict whitelist — password keys are never accessible
- API key is never logged

### Recalbox Wrapped

Annual gaming recap at `/wrapped/:year` — story-mode slides with tap/swipe navigation, glassmorphism dark design, and shareable PNG images. Accessible year-round. Archive at `/wrapped`.

## Notifications

Two delivery tiers, zero external dependencies.

| Tier | How | When |
| ---- | --- | ---- |
| In-app toasts | SSE (Server-Sent Events) | Dashboard tab is open |
| Web Push | Service Worker + VAPID | Dashboard is closed / background |

### Events

| Event | Trigger |
| ----- | ------- |
| Achievement unlocked | RA sync detects a new unlock |
| Streak milestone | Session close reaches 3/7/14/30/50/100/200/365 days |
| Annual Wrapped available | Cron fires on December 1st at 09:00 |
| System alert | Manual test or internal alert |

### Setup (Web Push)

1. Go to **Settings → Notifications**
2. Toggle **Web Push (background)** → your browser will ask for permission
3. Done — VAPID keys are generated automatically on first scrobbler boot and stored in the database

> **Requires HTTPS** in production (browsers block push on plain HTTP, except `localhost`).
> On iOS, install the dashboard as a PWA (Add to Home Screen) before enabling push.

### Cross-process delivery

The scrobbler daemon and the Next.js app run as separate processes. Notifications created by the scrobbler are delivered to open browser tabs via a 5-second DB poll in the SSE endpoint — no message broker needed. An atomic `pushedInApp` flag prevents duplicate delivery across multiple tabs.

## Stats (`/stats/[period]`)

| Period | URL |
| ------ | --- |
| This week | `/stats/week` |
| This month | `/stats/month` |
| This year | `/stats/year` |
| All time | `/stats/all` |

**Components:** KPI cards (playtime, games, sessions, streak) · GitHub-style heatmap · daily playtime chart · top 10 games · system distribution · last 20 sessions timeline

**Test data:**

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

### `GET /api/collection`

| Query param | Type | Description |
| ----------- | ---- | ----------- |
| `system` | string | Filter by system |
| `favoritesOnly` | boolean | Favorites only |
| `neverPlayed` | boolean | Never played |
| `search` | string | Search by name |
| `sortBy` | `name\|rating\|lastPlayed\|releaseDate` | Sort field |
| `sortDir` | `asc\|desc` | Sort direction |
| `page` | number | Page (default: 1) |
| `pageSize` | number | Size (max: 200, default: 50) |

### `GET /api/collection/regions`

Returns regions available in the collection, optionally filtered by `?system=`.

### User data (`gamelist-userdata.ini`)

Recalbox stores user preferences (favorites, hidden, play stats) in a separate `.ini` file.
The sync reads both files and merges them — `.ini` values take priority over XML.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
