# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-20

First public release. Recalbox Dashboard is a companion analytics tool for
Recalbox that tracks playtime history, achievement progress, and your game
collection over time. It complements the built-in Recalbox Web Manager rather
than replacing it.

### Added

#### Real-time tracking

- Live "Now Playing" card via MQTT subscription and SSE push — no polling
- Scrobbler daemon that records game sessions to SQLite even when no browser tab is open
- WAL-mode SQLite for concurrent access between the Next.js app and the scrobbler daemon
- SSH system stats snapshots (CPU temp, RAM, storage) with live chart

#### Statistics and analytics

- Stats page with selectable periods: week, month, year, all-time
- GitHub-style activity heatmap, daily playtime bar chart, top 10 games by playtime
- System distribution chart and last 20 sessions timeline
- KPI cards: total playtime, unique games, session count, current streak
- Streak tracking with milestones at 3 / 7 / 14 / 30 / 50 / 100 / 200 / 365 days

#### Collection management

- Full collection sync from `gamelist.xml` files via SSH, with cover image proxy
- Filterable and sortable collection browser (system, favorites, never-played, search, region)
- `gamelist-userdata.ini` merged on sync — favorites and hidden flags respected
- Multi-disc detection across 10+ disc-naming patterns (PSX, Saturn, Sega CD, etc.)
- `.m3u` playlist generator: previews candidates and batch-deploys playlists to Recalbox over SSH
- Collection health panel: missing cover / description diagnostic per system, Patron status check

#### RetroAchievements integration

- Auto-detection of RetroAchievements username from `recalbox.conf` via SSH
- Background sync at a configurable interval (default: 30 min) in the scrobbler daemon
- Achievement page: profile header, 365-day unlock heatmap, recent unlocks, top games by completion
- Fuzzy ROM-to-game title matching (≥ 80% similarity) with manual override
- Trophy badges on game covers that have unlocked achievements

#### Annual Wrapped recap

- Story-mode slides at `/wrapped/:year` with tap / swipe navigation
- Glassmorphism dark design; shareable PNG images rendered via Remotion
- Archive page at `/wrapped` listing all available years
- Annual Wrapped available notification fires on 1 December at 09:00

#### Notifications

- In-app toast notifications via SSE when the dashboard tab is open
- Web Push (background) via Service Worker and auto-generated VAPID keys
- Notification events: achievement unlocks, streak milestones, annual Wrapped alert, system alerts
- Cross-process delivery from the scrobbler to open browser tabs via a 5-second DB poll;
  atomic `pushedInApp` flag prevents duplicate delivery across multiple tabs
- Per-type toggle switches, configurable quiet hours, notification center bell

#### Multi-Recalbox support

- Manage N Recalbox instances from a single install
- Per-browser active Recalbox selection via cookie; header switcher appears when more than one is configured
- SSH and MQTT connection pools with on-demand creation and automatic reconnect
- All data tables scoped by `recalbox_id` foreign key
- Aggregated playtime and session view across all Recalboxes at `/all-recalboxes`

#### Ecosystem integration

- MQTT analytics publisher: pushes playtime, streak, session, and last-game data to `RecalboxDashboard/#` topics
- Home Assistant Discovery: auto-registers 8 sensors (`playtime_today`, `playtime_week`,
  `streak_current`, `last_game`, etc.) with a single toggle
- Super Retrogamers community site cross-linking: slug matching and game page lookup with region preference

#### Infrastructure

- Single Docker container with s6-overlay supervising Next.js and the scrobbler as independent services
- Multi-arch CI (GitHub Actions): builds and pushes for x86\_64 and ARM64 (Raspberry Pi 4/5, Apple Silicon, ARM NAS)
- First-run setup wizard (`/welcome`); connection config is stored in the database, not in env files
- Database migrations managed by Drizzle Kit; schema version tracked automatically
- Progressive Web App: installable on iOS (Safari), Android (Chrome), and desktop (Chrome/Edge)
- Dark / light theme toggle with custom ThemeProvider (no flash on load)
- System power controls in the navbar: reboot and shutdown the Recalbox over SSH with a confirmation dialog

#### Security

- Media proxy path-whitelisted to `/recalbox/share/` to prevent path traversal
- RetroAchievements API key masked (`***`) in all GET responses; never logged
- `recalbox.conf` reads limited to a strict whitelist — password keys are inaccessible
- API error responses hardened to avoid leaking internal details

#### Internationalisation

- English and French UI via next-intl, with locale-prefix routing (`/en/`, `/fr/`)
- All user-facing strings translated; locale auto-detected from browser preferences

[Unreleased]: https://github.com/m-meddah/recalbox-dashboard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/m-meddah/recalbox-dashboard/releases/tag/v1.0.0
