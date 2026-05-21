# v1.0.0 — First public release

Recalbox Dashboard is a companion analytics tool for Recalbox that tracks how
you've used your retrogaming setup over time. It complements the built-in
Recalbox Web Manager — think Last.fm for retrogaming.

## What's in v1.0.0

- **Session tracking without lifting a finger** — a background scrobbler daemon
  listens to the Recalbox MQTT broker and records every game session to a local
  SQLite database, even when no browser tab is open.
- **Stats that go deep** — GitHub-style activity heatmap, daily playtime chart,
  top games, session streaks, and system distribution. Filter by week, month,
  year, or all-time.
- **RetroAchievements wired in** — your username is auto-detected from
  `recalbox.conf`. The dashboard syncs your unlock history in the background,
  shows a 365-day heatmap, and badges game covers with your progress.
- **Annual Wrapped recap** — a story-mode recap at `/wrapped/:year` with
  tap/swipe slides, shareable PNG images, and an archive page. A push
  notification fires on 1 December.
- **Multi-Recalbox ready** — manage N Recalbox instances from one install.
  Each browser session can point to a different one; an aggregated view
  merges playtime across all of them.

## Getting started

```bash
curl -O https://raw.githubusercontent.com/m-meddah/recalbox-dashboard/main/docker-compose.yml
nano docker-compose.yml   # set RECALBOX_HOST to your Recalbox IP or hostname
docker compose up -d
```

Open http://localhost:3000 and follow the setup wizard.

## Compatibility

- Recalbox 10.x
- Architectures: x86\_64, ARM64 (Raspberry Pi 4/5, Apple Silicon, ARM NAS)
- Docker required (or Node.js 22 + pnpm 9 from source)

## Acknowledgments

Built on top of the Recalbox MQTT broker and SSH access — no Recalbox patches
required. Inspired by Last.fm, GitHub contributions graph, and Spotify Wrapped.

## Documentation

- [Installation (Docker + source)](https://github.com/m-meddah/recalbox-dashboard#installation)
- [Ecosystem integration (Home Assistant, Node-RED)](https://github.com/m-meddah/recalbox-dashboard#ecosystem)
- [MQTT topic contract](https://github.com/m-meddah/recalbox-dashboard/blob/main/docs/mqtt-api.md)
- [Full changelog](https://github.com/m-meddah/recalbox-dashboard/blob/main/CHANGELOG.md)
