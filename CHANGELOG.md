# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - Unreleased

### Added

- **Automatic agent updates** — each box converges to the version the cloud designates, verifies
  the package before switching, and restores the previous one if the new version never talks
  back to the cloud.
- **Progressive rollout** — target version and rollout percentage adjustable from `/admin`, a
  per-Recalbox `stable`/`beta` channel, and a fleet version-split table.
- **ROM collection audit** (`/collection/audit`) — compares what is actually on the box, support by support, against the No-Intro, Redump, MAME and FBNeo reference catalogues, and lists the **games** that are missing. Strictly read-only: nothing is downloaded and nothing on the Recalbox is modified.
  - **On-box scanning** — a dependency-free Python scanner walks every `/roms` directory of **every support, SD card included** (the previous system listing only ever looked at the USB disks), and identifies files by five strategies: zip central-directory CRC, CHD header, RVZ/ISO disc header, 7z entry listing, and full hashing. Nothing is written to the box: the script travels on the SSH exec's stdin.
  - **Four confidence levels** — ✅ verified (hash), ◆ identified by serial (RVZ/ISO game code), ~ identified by name, ? unknown. CHDs top out at `named` by construction: they merge the tracks Redump hashes separately.
  - **Arcade support** — the MAME/FBNeo catalogues speak a quote-less dialect and hash the **archive itself** rather than its contents, so arcade systems are scanned in container mode. Measured on the reference collection: 138 of 140 Neo Geo archives identified this way, against 0 in content mode.
  - **Incremental rescans** — the previous scan is handed back to the scanner, which skips re-reading files whose size and mtime have not moved. Measured on 7 713 arcade archives (44,9 GB): **314 s cold, 0,9 s on the second pass**, with a byte-identical result.
  - **Deep verification of one title** — `chdman verify` catches a rotting CHD; `dolphin-tool` recomputes an RVZ's disc image and compares it to Redump, which yields a genuine catalogue match. Self-hosted only, and hidden when the binary is absent.
  - **Two transports** — SSH from the dashboard when self-hosted, and the on-box agent's command queue in serverless. Detail is kept locally; the cloud stores per-system aggregates and unknown files only, so a rescan that changes nothing writes **zero rows**.
  - **Export** — the missing list as CSV or JSON, filters included.
- **Plug-and-play agent install** — enrolling a Recalbox in the serverless edition no longer means SSH-ing into the box to hand-copy `agent.py`, write a `config.json` and cobble together a `custom.sh`. In serverless mode, `/recalboxes/add` is now a guided 3-screen wizard; self-hosted keeps its existing technical form unchanged.
  - **Name it, download, wait** — screen 1 takes just a name/emoji/colour; screen 2 hands over a pre-configured `.zip`; screen 3 polls quietly and turns green the moment the console first checks in. Closing the tab is safe: the box shows as "awaiting setup" in the list with a link back into the wizard. After roughly three minutes with no sighting the screen lists the likely causes instead of spinning forever, and the polling itself stops after a bounded wait.
  - **One drag, no password** — the zip mirrors the Recalbox share's own layout (`system/` + `userscripts/`), so installing is a single drag of two folders into `\\RECALBOX\share` (Windows) or `smb://recalbox` (macOS/Linux), then a reboot. Samba is guest-writable on Recalbox by default, so nothing needs typing; Windows merges the folders rather than replacing them, and none of the shipped filenames collide with anything already on a console.
  - **Self-starting and self-watching** — the agent is launched by a script dropped in `userscripts/`, named for the EmulationStation event that fires when the system list appears (at boot, and again on every menu navigation), which makes the same script double as a watchdog: a dead agent restarts on the next trip to the menu.
  - **Exactly one agent, guaranteed** — a kernel-arbitrated `flock` taken inside `agent.py` itself ensures it, because that startup event fires twice within a second, and because a console still carrying an old manual `custom.sh` install would otherwise run a second agent and double-record every play session. The lock lives in the agent, so every start path — old install or new — contends for the same lock; `custom.sh` itself is never read, edited or overwritten, so a user's own customisations there are untouched.
  - **A token, scoped and self-cleaning** — the zip embeds a per-console enrolment token, owner-only and never cached; unused sibling installer tokens are cleaned up the first time a token is actually used, never at download time, since a token already sitting on a console that hasn't finished booting must not be revoked out from under it.
  - `GET /api/recalboxes/:id/installer` downloads the zip; `GET /api/recalboxes/:id/agent-status` backs the wizard's wait screen; a new sidebar entry makes the flow reachable before you have a box at all.

### Fixed

- **Network shares are now a first-class support** — `network0..3` mounts (ROMs living on a NAS) were invisible to system discovery, to the collection and to the audit, which reported those systems as empty rather than as unreachable. They are now walked like the USB disks and the SD card, over SSH as well as through the on-box agent.
- **The SD card is no longer skipped when reading the collection** — only the external USB disks were ever listed, so a collection sitting on the internal card came back empty.
- **An unreadable support no longer passes for an empty collection** — it is reported as unreadable, which is a different claim.
- **Adding a Recalbox refused a blank SSH password in serverless mode** — even though the cloud never opens an SSH connection to the box there; the field was required regardless of deployment mode.
- **Saving an existing Recalbox failed for everyone unless the SSH password was retyped** — the edit form never receives the stored secret to prefill it, so it always submits a blank field and a plain rename used to come back as a validation error. A blank now means "leave the stored password alone," same as the existing `***` mask.
- **Add/edit Recalbox failures surfaced as a generic toast** — the client discarded the API's actual explanation; it now shows the real reason, which is what most serverless users hit first.
- **The Docker image builds again** — the multi-arch build tripped on a leftover `COPY` of a package that had been deleted, then on the static prerender of `/[locale]/offline`: that page renders the locale layout, which resolves the session and therefore initialises Better Auth, and Better Auth refuses its default secret under `NODE_ENV=production`. The builder stage now sets a build-only placeholder secret, which never reaches the runtime image.

### Security

A full audit — 108 API routes, the authorization layer, the SSH/MQTT integration, the on-box agent and the dependency tree — with one fix per finding. The authorization model itself held up; the gaps were concentrated in the `settings` scope, which the earlier ownership work had never covered.

- **The stored SSH password could be sent to a host of the caller's choosing** — `POST /api/settings/test-connection` took `host` from the request body but fell back to the **stored** password whenever the body omitted it, or sent the `***` mask. Any signed-in member could point it at a machine they run and read the box's credentials — root, on Recalbox — out of their own sshd log, defeating the masking the rest of the app maintains carefully. The stored secret is now spent only by the box's **owner**, admins included; supplying a password explicitly still works without ownership, which is what the setup wizard needs, and the owner still never has to retype theirs.
- **Instance-wide configuration was writable by any member** — the `settings` scope checked that you were signed in and nothing more, then wrote through to the **default** Recalbox, which is not necessarily yours. Repointing its `host` harvested the stored password on the next connection from the scrobbler or the media proxy. It now targets the **active** box and requires ownership, exactly as `PUT /api/recalboxes/[id]` always did. The scopes holding shared API keys — RetroAchievements, Super Retrogamers, MQTT publishing, scrobbler tuning, IGDB credentials — are admin-only, and so is `POST /api/settings/reset`, whose `scope` is optional and whose omission wipes every key. Those keys and the endpoints they are sent to had to be gated together: repointing `superRetrogamers.apiUrl` shipped the stored `X-API-Key` to the new host, the same trick as the SSH one. The matching settings tabs are hidden from members.
- **The dashboard totalled every user's collection** — `getCollectionStats()` had no tenant filter at all, so the game count, the per-system breakdown, the favourites and the never-played shown on the overview and the collection pages aggregated **every** Recalbox of **every** user. It also disagreed with the games actually listed beside it, which are scoped. It now takes a required box id and returns empty rather than global totals when there is none.
- **A conf lookup only appeared to be shell-quoted** — `grep -E '^\s*${shellQuote(key)}\s*='` quotes nothing: the helper's own quotes close and reopen the surrounding ones, leaving the value **unquoted**, so a key of `a;id;b` ran `id` on the box. `GET /api/recalbox/conf?key=` passes its query parameter straight there, with only a three-entry whitelist in front of it — the whitelist held, so this was never exploitable end to end, but the escaping everyone would assume was protecting it was inert. The key no longer reaches the command line at all: the file is read and filtered in JS, as the sibling function already did.
- **Rate limiting counted per process** — Better Auth's default store is in-memory, so each warm serverless instance keeps its own tally and the strict five-per-minute rule on `/sign-in/email` really allowed five times the number of live instances. Counters now live in the database, in a new `rate_limit` table.
- **32 dependency advisories, 2 critical and 17 high** — Next.js 16.2.6 → 16.2.12 closes an App Router middleware bypass, which matters here because `proxy.ts` is the only authentication gate in front of pages, and two SSRF advisories; Better Auth 1.6.15 → 1.6.25 closes an account-takeover path (not reachable in this app, which enables neither magic links nor email OTP). Transitive fixes for `ws`, `sharp`, `postcss`, `vite` and others go through pnpm overrides. Three advisories remain, none high or critical.
- **A Content-Security-Policy and HSTS are now sent** — image sources are restricted to what the UI actually loads, and the policy was verified in a browser rather than asserted as a string. `script-src` still needs `'unsafe-inline'` for Next's hydration bootstrap and the anti-FOUC script, so injected inline script is not stopped; third-party script files, cross-origin exfiltration and plugin embedding are. HSTS is deliberately sent without `preload`, which is effectively irreversible and would force HTTPS on LAN and tailnet deployments that legitimately serve plain HTTP.
- **The artwork endpoint trusted the agent's declared content type** — a token holder could upload arbitrary bytes as `text/html` and turn the artwork bucket into a page host, on a domain you own and where the headers above do not reach. The type is derived from the file extension against an image allowlist (SVG excluded, being the one image format that can carry script), a path that is not an image is refused outright, and the bytes must start with a real image signature. That signature is deliberately **not** matched against the extension: scraped artwork is routinely mislabelled, and rejecting it would break real uploads for no gain.
- **Accepting an invitation was a race** — two concurrent requests carrying the same token both passed validation. The unique email meant no second account was ever created, but the loser crashed on the duplicate insert instead of being rejected cleanly. The invitation is now claimed atomically before the account is created, and released if creating it fails, so a mistyped password no longer burns the invite.
- **A missing encryption key no longer degrades to plaintext** — with neither `CREDENTIALS_SECRET` nor `BETTER_AUTH_SECRET` set, SSH and IGDB credentials were written in the clear behind a single log line. Production now refuses outright. Better Auth already declines to boot without a secret, so this was not reachable in practice; the invariant now belongs to the module that owns it rather than to another library's validation.

**Upgrading:** a Recalbox with no `owner_user_id` becomes uneditable, since ownership is what now gates its stored credentials. Boxes created through the setup wizard's no-JavaScript fallback were left unowned; that path assigns an owner now, but existing rows are not adopted automatically — deciding who owns a machine is not something a first click should settle. Check with `select count(*) from recalboxes where owner_user_id is null` and set the column by hand if it returns anything.

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

[2.1.0]: https://github.com/m-meddah/recalbox-dashboard/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/m-meddah/recalbox-dashboard/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/m-meddah/recalbox-dashboard/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/m-meddah/recalbox-dashboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/m-meddah/recalbox-dashboard/releases/tag/v1.0.0
