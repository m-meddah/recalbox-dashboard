# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-06-05

A major release that reskins the dashboard to share the visual DNA of the built-in
Recalbox Web Manager, mirrors several of its views (monitoring, BIOS, collection), and
adds the ability to launch games on the Recalbox directly from the dashboard. No data
migration is required when upgrading from 1.x — same database, same connection settings.

### Added

- **Web Manager design language** — full UI reskin: navy/teal palette with a derived dark mode, Roboto type, and a **collapsible icon rail** replacing the top navigation (it becomes a drawer on mobile). Cards, toggles and tabs follow the same Material-ish styling.
- **Overview home page** — gradient hero with the gamepad pattern, stat circles, and a restyled *Now Playing* (current system + current game, screensaver demo state).
- **BIOS health** (`/bios`) — read-only health view mirroring the Web Manager BIOS screen: every required/optional BIOS with its status (present / hash mismatch / missing), filter chips and search, fed by the Web Manager API (`GET /api/bios`).
- **Monitoring redesign** — per-core CPU as a vertical bar chart and storage as Web-Manager-style HDD rows (share/boot partitions only, de-duplicated, usage %), served by `GET /api/monitoring`.
- **Revamped collection** — a systems grid showing every system with at least one ROM, and a per-system detail table with **box-3D artwork**, 5-star ratings, a **region column + region filter**, favorites filter, search and pagination.
- **Launch games from the dashboard** — a ▶ button on each game (`POST /api/collection/launch`) and on the *Play Tonight* recommendations asks EmulationStation to start the game via its UDP listener (port 1337), sent from the box over SSH.
- **Running-game guard** — launches are blocked when a game is already running: live via MQTT events (the button is disabled with a tooltip) and server-side by reading `es_state.inf` before sending (returns `409 { error: 'busy', gameName }`), so a game is never silently queued behind another.
- Regenerated favicons and PWA icons from the Recalbox button logo.

### Changed

- Top navigation bar replaced by the collapsible sidebar rail; the previous mobile hamburger drawer is superseded by the sidebar's mobile sheet.

### Fixed

- Recommendations: `scoreGame` now correctly excludes games exceeding 4× the available time in finish mode (test updated to match).

## [1.1.0] - 2026-05-30

### Added

- **What to Play Tonight** (`/play-tonight`) — content-based recommendation engine that scores every game in the collection against the user's taste profile, current mood, and available time. Supports six moods: chill, challenge, nostalgia, discovery, finish, surprise.
- **IGDB enrichment** — lazy matching links collection games to IGDB entries in the background, providing critic ratings and similarity data that feed into recommendations. Configurable in Settings → IGDB.
- **Taste Profile** (`/profile`) — inferred preference weights (system, genre, decade, developer) computed in background from session history and ratings. Includes transparency metrics: maturity score, signal session count, quality charts.
- **Post-session feedback prompts** — after sessions classified as bounce, taste, meaningful, or marathon, users are invited to rate the game (love / like / dislike). Ratings feed back into recommendation scoring.
- **Session engagement classification** — every scrobbler session receives a classification based on duration: `noise` (< 2 min), `bounce` (2–10 min), `taste` (10–30 min), `meaningful` (30 min–2 h), `marathon` (> 2 h).
- **`pnpm dev:all`** — launches Next.js and scrobbler together in one terminal (replaces the two-terminal workflow).
- **`pnpm dev:all:mobile`** — same as `dev:all`, bound to `0.0.0.0` so the dev server is accessible from phones on the local network.
- **Separate inherited userdata** — sessions created from `gamelist-userdata.ini` (via `gamelist:import`) are stored in a dedicated `game_inherited_stats` table and weighted separately from live scrobbler sessions in profile computation.
- **Now Playing: browsing and screensaver state** — the Now Playing card shows when EmulationStation is in game browsing mode or when the screensaver is active, not just when a game is running.
- English translations for Profile page and IGDB settings.

### Fixed

- PWA: missing `apple-mobile-web-app-capable` meta tag prevented proper iOS Safari fullscreen installation.
- PWA: reliability and UX improvements (install prompt, service worker update detection).
- Stats: total playtime query used `=` for `recalbox_id` NULL comparison; replaced with `IS` operator for correct NULL-safe behaviour.
- Wrapped: playtime displayed in hours even when under 1 hour; now shows minutes correctly.
- Wrapped: navbar and theme toggle were missing on the `/wrapped` archive page.
- SSH: patron status check failures logged with full stack trace; reduced to a plain info message.
- API: several routes lacked error logging and input validation; hardened.
- API: `logger.debug` called in a module that only exposes `logger.info`; replaced.
- Recommendations: `inArray` called with the full game collection exceeded SQLite's variable limit; query restructured.
- Play Tonight / Profile: page containers were missing `mx-auto` and `px-4`, causing full-width overflow on large screens.

### Performance

- SSH circuit breaker — when a Recalbox instance is unreachable, subsequent SSH calls fail fast with a short timeout instead of waiting for the full connection timeout on every request.

## [1.0.1] - 2026-05-22

### Fixed

- Favicon not reliably served as a PWA; added `app/icon.png` and `app/apple-icon.png` following Next.js file convention
- Horizontal overflow and broken responsive layout on Android devices
- Satori layout error in Wrapped `SlideImage` caused by string concatenation; fixed with template literals
- Welcome setup form favicon metadata moved to root layout so it is served on all routes

### Changed

- Mobile navigation replaced with a hamburger drawer; desktop nav links hidden on small viewports
- Welcome setup form works without JavaScript via a new `/api/welcome-setup` POST route (progressive enhancement)
- Developer bootstrap scripts added: `seed:clear`, `gamelist:import`, `gamelist:clear` for initial data population from existing `gamelist.xml` data

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

[Unreleased]: https://github.com/m-meddah/recalbox-dashboard/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/m-meddah/recalbox-dashboard/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/m-meddah/recalbox-dashboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/m-meddah/recalbox-dashboard/releases/tag/v1.0.0
