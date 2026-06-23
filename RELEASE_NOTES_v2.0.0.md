# Recalbox Dashboard v2.0.0

_Released 2026-06-23_

**Web Manager design language, BIOS health, live monitoring, a revamped collection, a Recalbox
config editor, game launch, a new online multi-user family edition with accounts — and an
optional serverless edition you can run from anywhere, with nothing always-on at home.**

This is a major release. The whole UI now shares the visual DNA of the built-in Recalbox
[Web Manager](https://wiki.recalbox.com/fr/basic-usage/features/webmanager), so your users
never feel like they've landed in a different app. On top of the reskin, 2.0 mirrors several
Web Manager views in its own design, lets you **edit `recalbox.conf` and launch games**, and
introduces an **invitation-only multi-user mode** so a whole family can share one install —
across homes — over a mesh VPN. And for the first time you can run it **serverless** — on Vercel,
with a tiny agent on the Recalbox that pushes data to the cloud — so you can check in from
anywhere with **nothing always-on at home**.

> **Upgrading from 1.x?** Your sessions, games and settings carry over untouched. Two things
> are new in 2.0: the database picks up a few additional tables (auth, invitations, per-machine
> ownership) applied automatically on first boot, and **every install now sits behind a login**.
> Set a `BETTER_AUTH_SECRET` and create your first account once (`create-user` CLI) — then it
> behaves like before. See [Upgrading](#️-upgrading).

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

### Online, multi-user — the family edition 👨‍👩‍👧‍👦

2.0 turns the dashboard from a single-LAN companion into something a whole family can share,
even across different homes:

- **Accounts (invitation-only)** — authentication is built on
  [Better Auth](https://www.better-auth.com/). Every page and API route now sits behind a
  login; there's no open sign-up. The first account is created from the CLI
  (`create-user <email> <password> [admin|member]`); after that, admins invite others.
- **Invitation links** — admins generate single-use, hashed, expiring invite tokens from the
  admin area. The invitee lands on a public `/accept-invite` page, sets a password, and is in.
- **Roles & per-Recalbox ownership** — `admin` vs `member`. Each Recalbox has an **owner**, and
  access is split into **view** (see its stats/collection) and **control** (power, launch, sync,
  config). Members only see and act on machines shared with them; control actions are hidden
  when they lack permission.
- **Admin overview** (`/admin`) — a read-only dashboard of users and machines, admin-only.
- **Across homes, over a mesh VPN** — a Recalbox `host` can now be a Tailscale/tailnet address
  (IPv6 included), so the dashboard reaches boxes in other houses without port-forwarding. See
  [docs/mesh-vpn-setup.md](docs/mesh-vpn-setup.md).
- **Public deployment via Tailscale Funnel** — a `docker-compose.saas.yml` overlay plus
  `BETTER_AUTH_TRUSTED_ORIGINS` and a strict login rate-limit let you expose the dashboard on
  public HTTPS so family members reach it from anywhere. See
  [docs/saas-deployment.md](docs/saas-deployment.md).
- **Credentials encrypted at rest** — SSH passwords and IGDB secrets are now stored with
  AES-256-GCM, keyed from `BETTER_AUTH_SECRET` (or a separate `CREDENTIALS_SECRET`). A backfill
  script encrypts any existing plaintext in place.

### Serverless edition — run it from anywhere, nothing always-on at home ☁️

Self-hosting on a LAN box (or across homes over a mesh VPN) is still the simple default — but 2.0
adds an **optional serverless edition** so you can consult your retrogaming from anywhere, even
with the Recalbox off, and **without keeping any extra device running at home**.

- **On-Recalbox agent** — a dependency-free Python agent (`agent/`) runs on the Recalbox itself
  (RecalboxOS already ships Python 3 + MQTT; it survives OS updates and reboots via a boot hook).
  It subscribes to the local MQTT broker and **pushes data outbound over HTTPS**, so it traverses
  home NAT with no port-forwarding.
- **What it pushes** — play sessions (scrobbled on the box, buffered + retried while offline),
  system-monitoring snapshots, the game collection (gamelists, split into chunks for large
  systems), and live **now playing** state (relayed to browsers so the existing UI is unchanged).
- **Remote control without SSH** — reboot/shutdown and `recalbox.conf` edits are queued in the
  cloud; the agent **polls** the queue, applies them on the box, and reports back. (Game launch is
  wired end-to-end; its device-side executor is pending.)
- **Artwork via object storage** — game art is mirrored to object storage (Vercel Blob) on demand:
  the first request for a cover marks it "wanted", the agent uploads it, and it's served from the
  CDN thereafter — replacing the live SSH media proxy.
- **Cloud stack** — the Next.js app runs on **Vercel** against a **Turso/libSQL** database (a gentle
  migration of the existing Drizzle schema). Per-Recalbox **agent enrolment tokens** are minted
  from the Recalbox edit page, and the whole multi-user layer (accounts, ownership, encrypted
  credentials) applies unchanged. Live-SSH-only UI (power buttons, the config editor) is hidden in
  this mode since it's superseded by the agent.

Full runbook: [docs/serverless-deploy.md](docs/serverless-deploy.md).

### Edit your Recalbox config (`/configuration`) 🛠️

A new configuration editor with Web Manager parity: read and write `recalbox.conf` settings
straight from the dashboard, grouped into sections (**global**, **system**, **audio**,
**controllers**, **scraper**, **updates**, **hyperion**, **kodi**, **wifi**, …). Writes go to
the box over the Web Manager API.

- **Secrets are protected** — password / API-key / Wi-Fi-PSK fields are masked (`••••`) on the
  way out, never logged, and an untouched masked field never overwrites the real value.
- **Risky sections** (system, Wi-Fi) require an explicit confirm before saving, and settings
  that need an EmulationStation restart are flagged.
- **Editing requires _control_** permission on the active Recalbox; viewing requires _view_.

### Per-system & per-game emulator overrides

Pick a different emulator/core for a whole system, or for a single game, right from the
dashboard — applied on the box over SSH. Handy when one title runs better on an alternate core.

### Super Retrogamers — real API client

The Super Retrogamers integration graduated from a stub to a **real API client** with
per-ROM-region data: game-page lookups now resolve against the live community API (with
caching), feeding the existing collection touchpoints.

---

## 🔧 Changed

- The top navigation bar is replaced by the collapsible sidebar rail; the previous mobile
  hamburger drawer is superseded by the sidebar's mobile sheet.
- **Authentication is now required** on every page and API route (see the family edition
  above). Existing single-user installs need a `BETTER_AUTH_SECRET` and one account.
- The unused `@recalbox/scraper-core` stub package was removed; the monorepo is now just the
  `apps/dashboard` workspace.
- IGDB review page: per-system sidebar, per-system fetch, and optimistic UI (`useOptimistic`)
  for instant feedback when confirming matches.

## 🐛 Fixed

- Recommendations: `scoreGame` now correctly excludes games exceeding 4× the available time
  in finish mode (test updated to match).
- Achievements: sync now pulls **all** game progress via `getUserCompletedGames` instead of
  only recent titles.
- Monitoring: cards refresh on bfcache page restore (back/forward navigation).
- Now Playing: shows screensaver demo games and the current system, with real console logos in
  the browsing card.
- Mobile (Android): restored interactivity and fixed several layout issues; activity state is
  now preserved across SPA navigation.
- Scrobbler: the previous instance is stopped on `tsx` watch hot-reload to avoid duplicate
  daemons.
- MQTT broker URLs now bracket IPv6 hosts correctly (tailnet addresses).

---

## 📡 New / notable API routes

| Route | Purpose |
| ----- | ------- |
| `GET /api/bios` | BIOS health report (present / mismatch / missing) |
| `GET /api/monitoring` | Per-core CPU + storage snapshot |
| `POST /api/collection/launch` | Launch a game (`{ system, romPath }`); `409` when busy |
| `POST /api/play-tonight/launch` | Launch a recommendation; returns `{ launched, busy, gameName }` |
| `GET /api/collection/regions` | Regions available in the collection (optionally `?system=`) |
| `GET / POST /api/recalbox/config/[section]` | Read / write a `recalbox.conf` section (secrets masked; control required) |
| `POST /api/recalbox/system-emulator` | Set a per-system emulator/core override |
| `POST /api/collection/emulator-override` | Set a per-game emulator/core override |
| `ALL /api/auth/[...all]` | Better Auth handler (sign-in, session, account) |
| `POST / GET / DELETE /api/invitations` | Create, list, and revoke invitations (admin) |
| `GET /api/invitations/validate` · `POST /api/invitations/accept` | Validate a token and accept an invite (public) |
| `POST /api/agent/ingest` · `/snapshots` · `/collection` · `/now-playing` | Agent push: sessions, monitoring, collection, live now-playing (serverless; Bearer token) |
| `GET / POST /api/agent/artwork` | Agent pulls "wanted" artwork paths / uploads images to object storage |
| `GET /api/agent/commands` · `POST /api/agent/commands/result` | Agent polls the remote-control queue and reports results |
| `GET / POST / DELETE /api/recalboxes/:id/agent-tokens` | Mint / list / revoke a box's agent enrolment tokens (owner) |
| `POST / GET /api/recalboxes/:id/commands` | Enqueue / list remote-control commands (owner) |

### Connections

| Protocol | Port | Purpose |
| -------- | ---- | ------- |
| MQTT | 1883 | Real-time game events |
| SSH | 22 | System stats, image/media proxy, per-core CPU, game launch |
| HTTP | 81 | Recalbox Web Manager API (BIOS health, storage info, config read/write) |

Game launch reaches EmulationStation's UDP listener (port **1337**), but the datagram is sent
from the box over SSH — no extra port needs to be open from the dashboard host.

> The table above is the **self-hosted** model. In the **serverless edition** the cloud never
> connects to the box: the on-Recalbox agent makes **outbound** HTTPS calls instead, so nothing at
> home needs to be reachable.

---

## ⬆️ Upgrading

> **New in 2.0:** every install now requires a login. Set `BETTER_AUTH_SECRET` (32+ chars,
> e.g. `openssl rand -base64 32`) and create your first account once. Database migrations for
> the new auth/invitation/ownership tables apply automatically on first boot — your sessions,
> games and settings are untouched.

### Single-user, on your LAN (recommended for most)

```bash
docker compose pull && docker compose up -d
# one-time: create your account
docker compose exec recalbox-dashboard node /app/create-user.js you@example.com 'a-strong-password' admin
```

Then open the dashboard and sign in. Everything else works exactly as before.

### Multi-user / online family edition

Use the `docker-compose.saas.yml` overlay and expose the dashboard over public HTTPS with
Tailscale Funnel — full walk-through (secrets, trusted origins, rate limiting) in
[docs/saas-deployment.md](docs/saas-deployment.md). To reach Recalbox machines in other homes,
see [docs/mesh-vpn-setup.md](docs/mesh-vpn-setup.md).

### Serverless edition (Vercel + Turso)

Run the dashboard on Vercel against a Turso/libSQL DB, with the Python agent on each Recalbox —
no always-on host, no port-forwarding. Set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
(plus `TURSO_DISABLE_REPLICA=1` for the build), `BLOB_READ_WRITE_TOKEN`, `AGENT_ONLY_MEDIA=1` and
the `BETTER_AUTH_*` vars; bootstrap your admin account; then enrol each box's agent from its
Recalbox edit page. Full step-by-step in [docs/serverless-deploy.md](docs/serverless-deploy.md).

### From source

```bash
git pull
pnpm install
pnpm build
# set BETTER_AUTH_SECRET in apps/dashboard/.env.local, then:
pnpm --filter @recalbox/dashboard exec tsx scripts/create-user.ts you@example.com 'a-strong-password' admin
```

Already had plaintext SSH/IGDB secrets in the DB? Run the idempotent backfill once to encrypt
them at rest (see the [README](README.md#getting-started) / CLAUDE.md for the exact command).

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
