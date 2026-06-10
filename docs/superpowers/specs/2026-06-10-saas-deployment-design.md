# Phase 6 — SaaS deployment (Tailscale Funnel) (design)

> SaaS multi-user edition, Phase 6 of `docs/prd/2026-06-08-saas-multi-user.md`.
> Prior phases (auth, ownership/scoping, admin read-only view, credential
> encryption, mesh-VPN connectivity) are DONE on branch `feat/saas-multi-user`
> (kept un-merged, stacking).

## Goal

Make the multi-user app deployable on an always-on host on the tailnet, exposed
over public HTTPS via **Tailscale Funnel**, with authentication hardened for that
public exposure. The existing single-container image (Next.js + scrobbler via
s6-overlay) is reused unchanged — Phase 6 adds a SaaS-specific compose overlay, two
small auth-config hardening changes, and operational documentation. Account
provisioning stays on the existing `scripts/create-user.ts` for the admin bootstrap;
email invitations are a separate subsystem deferred to Phase 7.

## Decisions (from brainstorming)

- **Exposure:** Tailscale **Funnel** (public Internet via `*.ts.net`), so family
  members reach the dashboard without installing Tailscale on their own device. This
  is more exposed than Serve (tailnet-only), so the login surface must be hardened.
- **Tailscale runs on the host OS**, not in the container (Approach A). The container
  binds port 3000 to loopback only; `tailscale funnel --bg 3000` forwards public HTTPS
  to it. A containerized Tailscale sidecar is documented as a brief annex, not the
  primary path.
- **Account provisioning:** keep the server-side `scripts/create-user.ts` (sign-up
  stays disabled). Email invitations (magic link) are a distinct subsystem with their
  own SMTP/token/route/page/migration work — deferred to **Phase 7**, which also
  depends on a deployed public URL for the invitation links.
- **Deliverable:** config + docs + code hardening. No live deployment this session
  (the always-on host is not yet provisioned); verification is the local test suite
  plus a Docker build smoke test.

## Part A — Auth hardening (code, TDD)

The public Funnel exposure means the login page is reachable from the open Internet.
Two changes to `apps/dashboard/lib/auth/server.ts`, each backed by a pure, testable
helper so the Better Auth config object itself needs no integration test.

### A1 — `trustedOrigins`

Better Auth rejects requests whose `Origin` is not in `trustedOrigins` (CSRF
protection); the default is just `baseURL`. Once the app is served from a
`*.ts.net` domain — and possibly also reached via a MagicDNS name or `localhost`
during admin operations — the trusted origins must be explicit.

New module `apps/dashboard/lib/auth/trusted-origins.ts`:

```ts
/**
 * Origins Better Auth will accept for cross-origin/CSRF checks.
 * Reads BETTER_AUTH_TRUSTED_ORIGINS (comma-separated); falls back to
 * BETTER_AUTH_URL when unset. Returns [] when neither is set (Better Auth
 * then defaults to its own baseURL).
 */
export function parseTrustedOrigins(env: NodeJS.ProcessEnv): string[] {
	const csv = env.BETTER_AUTH_TRUSTED_ORIGINS
	if (csv) {
		return csv
			.split(',')
			.map((o) => o.trim())
			.filter((o) => o.length > 0)
	}
	const base = env.BETTER_AUTH_URL
	return base ? [base] : []
}
```

Wired into `server.ts` as `trustedOrigins: parseTrustedOrigins(process.env)`.

**Tests** (`apps/dashboard/lib/auth/__tests__/trusted-origins.test.ts`):
- CSV with multiple origins → trimmed array.
- CSV with surrounding spaces and an empty trailing entry → cleaned array.
- unset CSV but `BETTER_AUTH_URL` set → `[BETTER_AUTH_URL]`.
- both unset → `[]`.

### A2 — Login rate limiting

Enable Better Auth's built-in rate limiting in production with a strict rule on the
email sign-in path. Single instance → the default in-memory store is sufficient.

New module `apps/dashboard/lib/auth/rate-limit.ts`:

```ts
import type { BetterAuthOptions } from 'better-auth'

/**
 * Rate-limit config for Better Auth. Enabled outside development (the login page
 * is publicly reachable via Tailscale Funnel). A strict per-path rule throttles
 * brute-force attempts on email sign-in; other auth endpoints use the window
 * default. In-memory store (single instance).
 */
export function buildRateLimitConfig(
	env: NodeJS.ProcessEnv,
): BetterAuthOptions['rateLimit'] {
	return {
		enabled: env.NODE_ENV === 'production',
		window: 60,
		max: 100,
		customRules: {
			'/sign-in/email': { window: 60, max: 5 },
		},
	}
}
```

Wired into `server.ts` as `rateLimit: buildRateLimitConfig(process.env)`.

**Tests** (`apps/dashboard/lib/auth/__tests__/rate-limit.test.ts`):
- `NODE_ENV=production` → `enabled: true`.
- `NODE_ENV=development` (or unset) → `enabled: false`.
- the `/sign-in/email` custom rule is present with `max: 5`, `window: 60`.

### A3 — Secure cookies (no code)

Better Auth auto-enables secure cookies when `baseURL` is `https://`. Setting
`BETTER_AUTH_URL` to the public `https://…ts.net` origin is therefore sufficient —
documented in Part C, no code change.

## Part B — Deployment config

### B1 — `docker-compose.saas.yml` (repo root)

A SaaS-specific compose file alongside the existing single-user `docker-compose.yml`
(which is left untouched for LAN self-hosters):

```yaml
services:
  recalbox-dashboard:
    image: ghcr.io/m-meddah/recalbox-dashboard:latest
    container_name: recalbox-dashboard
    restart: unless-stopped
    # Loopback only — Tailscale Funnel on the host forwards public HTTPS to :3000.
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - recalbox-data:/data
    environment:
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set in .env}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:?set in .env}
      BETTER_AUTH_TRUSTED_ORIGINS: ${BETTER_AUTH_TRUSTED_ORIGINS:-}
      CREDENTIALS_SECRET: ${CREDENTIALS_SECRET:-}
      TZ: ${TZ:-Europe/Paris}
      DATABASE_PATH: /data/recalbox.db
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  recalbox-data:
```

Notes:
- The single-user `RECALBOX_HOST` / `RECALBOX_SSH_*` env vars are intentionally
  **omitted**: in multi-user mode, Recalbox machines are added through the in-app UI
  after the admin logs in (each becomes an owned `recalboxes` row), not seeded from
  env. Pre-seeding would create an unowned machine.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` use the `${VAR:?msg}` form so
  `docker compose` fails fast if they are missing.
- `CREDENTIALS_SECRET` is optional (defaults to deriving from `BETTER_AUTH_SECRET`,
  per Phase 4).

### B2 — `.env.example`

Add `BETTER_AUTH_TRUSTED_ORIGINS` with a comment explaining it is the
comma-separated list of accepted origins (public `*.ts.net` URL, plus any MagicDNS
name), defaulting to `BETTER_AUTH_URL` when unset.

### B3 — Ship the admin-bootstrap script in the image

`scripts/create-user.ts` is a `tsx` script and is **not** in the production image:
the Dockerfile copies only the Next.js standalone output, the esbuild-bundled
`scrobbler.js`, `drizzle/`, and `migrate.js` — never `scripts/` or `tsx`. So the
admin bootstrap (section 6 of the doc) has nothing to run today. Fix it by mirroring
the established scrobbler-bundling pattern:

- New package script in `apps/dashboard/package.json`, alongside `build:scrobbler`:

  ```json
  "build:create-user": "esbuild scripts/create-user.ts --bundle --platform=node --target=node22 --packages=external --tsconfig=tsconfig.json --outfile=.next/standalone/create-user.js"
  ```

- New Dockerfile build step in the builder stage, next to the scrobbler compile:

  ```dockerfile
  # Compile the admin-bootstrap CLI → JS (no tsx required at runtime)
  RUN pnpm --filter @recalbox/dashboard run build:create-user
  ```

  Because the whole `.next/standalone/` directory is already copied into the image
  (`COPY --from=builder /app/apps/dashboard/.next/standalone/ ./`), the bundle lands
  at `/app/create-user.js` with no extra `COPY`. `--packages=external` resolves
  `better-auth`/`drizzle`/`better-sqlite3` from the traced standalone `node_modules`,
  exactly as `scrobbler.js` does.

- Bootstrap command becomes:
  `docker compose -f docker-compose.saas.yml exec recalbox-dashboard \
  node /app/create-user.js <email> <password> admin`.

## Part C — Documentation: `docs/saas-deployment.md`

A new operational guide. Sections:

1. **Overview** — always-on host on the tailnet + Tailscale Funnel topology; the
   dashboard reaches each Recalbox over the mesh VPN (link to
   `docs/mesh-vpn-setup.md`), while Funnel exposes the dashboard itself publicly.
2. **Prerequisites** — Docker + Docker Compose on the host; Tailscale installed on
   the host and the node joined to the tailnet; Funnel enabled in the tailnet ACLs.
3. **Generate secrets (one-shot)** — `openssl rand -base64 32` for
   `BETTER_AUTH_SECRET` (and optionally `CREDENTIALS_SECRET`); write them to a
   root-readable `.env` next to the compose file. ⚠️ **Never regenerate them** once
   data exists: rotating `BETTER_AUTH_SECRET` invalidates all sessions and (since it
   also derives the Phase 4 credential key by default) makes stored SSH/IGDB secrets
   undecryptable. Document `CREDENTIALS_SECRET` as the way to rotate the auth secret
   independently of the credential key.
4. **Start the container** — `docker compose -f docker-compose.saas.yml up -d`;
   confirm `/api/health` via the loopback port.
5. **Expose via Funnel** — `tailscale funnel --bg 3000`; read back the public
   `https://<node>.<tailnet>.ts.net` URL; set it as `BETTER_AUTH_URL` and add it to
   `BETTER_AUTH_TRUSTED_ORIGINS` in `.env`; `docker compose -f docker-compose.saas.yml up -d`
   to apply.
6. **Bootstrap the admin** — using the compiled CLI shipped in the image (Part B3):
   `docker compose -f docker-compose.saas.yml exec recalbox-dashboard \
   node /app/create-user.js <email> <password> admin`. Then log in at the public URL
   and add Recalbox machines through the UI.
7. **Backup & restore runbook** — adapt the existing volume tar block from
   `docs/deployment.md` to the SaaS `/data` volume; note the DB now contains
   encrypted credentials, so a backup is useless without the matching
   `BETTER_AUTH_SECRET`/`CREDENTIALS_SECRET` — store those securely alongside.
8. **Annex B — Tailscale sidecar container** (brief): run Tailscale as a second
   container with Funnel + an auth key + a state volume, so the app is never bound on
   the host. Pointer + key differences only.
9. **Annex C — Reverse proxy + custom domain** (brief): for users who want their own
   domain instead of `*.ts.net`, point to `docs/deployment.md` (Traefik) and
   `docs/https-setup.md` (Caddy/NPM/Cloudflare); remind them to set `BETTER_AUTH_URL`
   and `BETTER_AUTH_TRUSTED_ORIGINS` to the custom origin.

Also: add a link from `docs/deployment.md` to this guide (a "Multi-user (SaaS)
deployment" section).

## Out of scope (YAGNI)

- Email invitations / magic-link account creation (Phase 7).
- Live deployment and end-to-end Funnel test this session.
- Multi-instance / horizontal scaling (the in-memory rate-limit store and the single
  SQLite file assume one instance).
- External secrets manager (a root-restricted `.env` is adequate for a family
  circle).

## Verification

- `parseTrustedOrigins` and `buildRateLimitConfig` unit tests green; both wired into
  `lib/auth/server.ts`.
- Full dashboard test suite green; `tsc` clean; Biome clean on all changed files.
- `docker build` succeeds; the image contains `/app/create-user.js` (Part B3);
  `docker compose -f docker-compose.saas.yml config` validates.
- `docs/saas-deployment.md` exists, covers all sections, and is linked from
  `docs/deployment.md`.
- Branch `feat/saas-multi-user` stays un-merged (stacking phases).
