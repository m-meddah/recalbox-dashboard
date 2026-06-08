# Recalbox Dashboard v2.0.0

_Released 2026-06-05_

**Web Manager design language, BIOS health, live monitoring, a revamped collection — and you can now launch games straight from the dashboard.**

This is a major release. The whole UI now shares the visual DNA of the built-in Recalbox
[Web Manager](https://wiki.recalbox.com/fr/basic-usage/features/webmanager), so your users
never feel like they've landed in a different app. On top of the reskin, 2.0 mirrors several
Web Manager views in its own design and adds game launch.

> **Upgrading from 1.x?** No data migration needed — same database, same connection
> settings. This is a major version because the UI changed substantially; functionality is
> purely additive.

---

## ✨ Highlights

### A familiar look — the Web Manager design language

The interface was rebuilt around the Web Manager's identity: navy/teal palette (with a
derived dark mode), Roboto type, and a **collapsible icon rail** that replaces the old top
navigation. On mobile the rail becomes a drawer. Cards, toggles and tabs all follow the same
Material-ish styling, and the favicons + PWA icons were regenerated from the Recalbox button
logo.

The home page got a matching **overview**: a gradient hero with the gamepad pattern, stat
circles, and a restyled _Now Playing_ that shows the current system, the running game, and
the screensaver demo state.

### BIOS health (`/bios`)

A read-only health view that mirrors the Web Manager's BIOS screen. Every required and
optional BIOS is listed with its status:

| Status | Meaning |
| ------ | ------- |
| ✅ present | File on disk, MD5 matches an expected hash |
| ⚠️ mismatch | File present but its MD5 isn't in the expected list |
| ❌ missing | Required file not found on disk |

Filter chips and search make it easy to find problems at a glance; a summary banner counts
present / mismatch / missing across your whole library. Use the Web Manager to actually
upload or fix the files.

### Monitoring redesign

The overview now shows a live snapshot styled after the Web Manager's monitoring screen:
**per-core CPU** as a vertical bar chart, and **storage** as Web-Manager-style HDD rows
(the user-facing `share`/`boot` partitions only, de-duplicated, with usage %).

### Revamped collection

- A **systems grid** showing every system with at least one ROM.
- A per-system detail table with **box-3D artwork**, 5-star ratings, a **region column and
  region filter**, a favorites filter, search and pagination.

### Launch games from the dashboard 🎮

A ▶ button on each game — and on the _Play Tonight_ recommendations — asks EmulationStation
to start the game via its UDP listener (port 1337). The datagram is sent **from the box over
the existing SSH connection**, so there's no extra port to open from the dashboard host.

Launches are **guarded against a game already running**, two ways:

- **Live** — MQTT events disable the button (with a tooltip) while a game is playing.
- **Server-side** — the launch endpoints read `es_state.inf` before sending and refuse with
  `409 { error: 'busy', gameName }` if a game is already running.

So a game is never silently queued behind another one.

---

## 🔧 Changed

- The top navigation bar is replaced by the collapsible sidebar rail; the previous mobile
  hamburger drawer is superseded by the sidebar's mobile sheet.

## 🐛 Fixed

- Recommendations: `scoreGame` now correctly excludes games exceeding 4× the available time
  in finish mode (test updated to match).

---

## 📡 New / notable API routes

| Route | Purpose |
| ----- | ------- |
| `GET /api/bios` | BIOS health report (present / mismatch / missing) |
| `GET /api/monitoring` | Per-core CPU + storage snapshot |
| `POST /api/collection/launch` | Launch a game (`{ system, romPath }`); `409` when busy |
| `POST /api/play-tonight/launch` | Launch a recommendation; returns `{ launched, busy, gameName }` |
| `GET /api/collection/regions` | Regions available in the collection (optionally `?system=`) |

### Connections

| Protocol | Port | Purpose |
| -------- | ---- | ------- |
| MQTT | 1883 | Real-time game events |
| SSH | 22 | System stats, image/media proxy, per-core CPU, game launch |
| HTTP | 81 | Recalbox Web Manager API (BIOS health, storage info) |

Game launch reaches EmulationStation's UDP listener (port **1337**), but the datagram is sent
from the box over SSH — no extra port needs to be open from the dashboard host.

---

## ⬆️ Upgrading

### Docker (recommended)

```bash
docker compose pull && docker compose up -d
```

### From source

```bash
git pull
pnpm install
pnpm build
```

No schema migration is required — your existing database and connection settings carry over.

> 💡 **Developing locally?** The dashboard is a phone companion, so the command you'll use
> most is `pnpm dev:all:mobile` — it runs both the Next.js app and the scrobbler and binds to
> `0.0.0.0`, so you can open it from your phone on the local network.

---

## 🙏 Thanks

Built to complement the Recalbox Web Manager and the wider community ecosystem
([RecalboxHomeAssistant](https://github.com/recalbox/RecalboxHomeAssistant) for control &
automation). The Web Manager runs your Recalbox; this dashboard tells you how you've used it
over time — and now lets you fire up your next game from the couch.

**Full changelog:** [CHANGELOG.md](CHANGELOG.md)
