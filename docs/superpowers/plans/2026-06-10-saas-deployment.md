# Phase 6 — SaaS deployment (Tailscale Funnel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the multi-user dashboard deployable on an always-on tailnet host, exposed over public HTTPS via Tailscale Funnel, with the login surface hardened for public exposure.

**Architecture:** Reuse the existing single-container image (Next.js + scrobbler via s6-overlay) unchanged. Add (A) two pure, testable auth-config helpers wired into Better Auth — `trustedOrigins` and a production login rate limit; (B) a SaaS compose overlay plus an esbuild-bundled admin-bootstrap CLI shipped in the image; (C) an operational deployment guide. No live deployment in this phase — verification is the local test suite plus a Docker build smoke test.

**Tech Stack:** Next.js 16, Better Auth 1.6.x, Drizzle/better-sqlite3, esbuild, Docker + s6-overlay, Tailscale Funnel, Vitest, Biome (tabs, single quotes, no semicolons, trailing commas).

**Spec:** `docs/superpowers/specs/2026-06-10-saas-deployment-design.md`

**Conventions for every task:**
- Biome style: **tabs**, single quotes, no semicolons, trailing commas.
- Run a single test file: `pnpm --filter @recalbox/dashboard exec vitest run <path>`
- Run Biome on changed files only: `node_modules/.bin/biome check <files>` (a whole-repo run surfaces unrelated pre-existing errors).
- Branch `feat/saas-multi-user` stays un-merged. Work on it directly.

---

## File Structure

- `apps/dashboard/lib/auth/trusted-origins.ts` (new) — pure `parseTrustedOrigins(env)`.
- `apps/dashboard/lib/auth/__tests__/trusted-origins.test.ts` (new).
- `apps/dashboard/lib/auth/rate-limit.ts` (new) — pure `buildRateLimitConfig(env)`.
- `apps/dashboard/lib/auth/__tests__/rate-limit.test.ts` (new).
- `apps/dashboard/lib/auth/server.ts` (modify) — wire both helpers into `betterAuth({...})`.
- `docker-compose.saas.yml` (new, repo root) — SaaS deployment overlay.
- `apps/dashboard/.env.example` (modify) — document `BETTER_AUTH_TRUSTED_ORIGINS`.
- `apps/dashboard/package.json` (modify) — add `build:create-user` script.
- `Dockerfile` (modify) — compile `create-user.js` into the standalone output.
- `docs/saas-deployment.md` (new) — deployment guide.
- `docs/deployment.md` (modify) — link to the SaaS guide.

---

## Task 1: `parseTrustedOrigins` helper

**Files:**
- Create: `apps/dashboard/lib/auth/trusted-origins.ts`
- Test: `apps/dashboard/lib/auth/__tests__/trusted-origins.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/auth/__tests__/trusted-origins.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseTrustedOrigins } from '../trusted-origins'

describe('parseTrustedOrigins', () => {
	it('splits a comma-separated list into trimmed origins', () => {
		expect(
			parseTrustedOrigins({
				BETTER_AUTH_TRUSTED_ORIGINS: 'https://a.ts.net,https://b.ts.net',
			} as NodeJS.ProcessEnv),
		).toEqual(['https://a.ts.net', 'https://b.ts.net'])
	})

	it('trims spaces and drops empty entries', () => {
		expect(
			parseTrustedOrigins({
				BETTER_AUTH_TRUSTED_ORIGINS: ' https://a.ts.net , , https://b.ts.net ,',
			} as NodeJS.ProcessEnv),
		).toEqual(['https://a.ts.net', 'https://b.ts.net'])
	})

	it('falls back to BETTER_AUTH_URL when the CSV is unset', () => {
		expect(
			parseTrustedOrigins({
				BETTER_AUTH_URL: 'https://host.ts.net',
			} as NodeJS.ProcessEnv),
		).toEqual(['https://host.ts.net'])
	})

	it('returns an empty array when neither is set', () => {
		expect(parseTrustedOrigins({} as NodeJS.ProcessEnv)).toEqual([])
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/trusted-origins.test.ts`
Expected: FAIL — cannot find module `../trusted-origins`.

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/lib/auth/trusted-origins.ts`:

```ts
/**
 * Origins Better Auth will accept for cross-origin / CSRF checks.
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/trusted-origins.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint the changed files**

Run: `node_modules/.bin/biome check apps/dashboard/lib/auth/trusted-origins.ts apps/dashboard/lib/auth/__tests__/trusted-origins.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/auth/trusted-origins.ts apps/dashboard/lib/auth/__tests__/trusted-origins.test.ts
git commit -m "feat(saas): parseTrustedOrigins helper for public auth origins"
```

---

## Task 2: `buildRateLimitConfig` helper

**Files:**
- Create: `apps/dashboard/lib/auth/rate-limit.ts`
- Test: `apps/dashboard/lib/auth/__tests__/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/auth/__tests__/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildRateLimitConfig } from '../rate-limit'

describe('buildRateLimitConfig', () => {
	it('is enabled in production', () => {
		const cfg = buildRateLimitConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
		expect(cfg?.enabled).toBe(true)
	})

	it('is disabled outside production', () => {
		expect(
			buildRateLimitConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)?.enabled,
		).toBe(false)
		expect(buildRateLimitConfig({} as NodeJS.ProcessEnv)?.enabled).toBe(false)
	})

	it('applies a strict rule to the email sign-in path', () => {
		const cfg = buildRateLimitConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
		expect(cfg?.customRules?.['/sign-in/email']).toEqual({ window: 60, max: 5 })
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/rate-limit.test.ts`
Expected: FAIL — cannot find module `../rate-limit`.

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/lib/auth/rate-limit.ts`:

```ts
import type { BetterAuthOptions } from 'better-auth'

/**
 * Rate-limit config for Better Auth. Enabled outside development (the login page
 * is publicly reachable via Tailscale Funnel). A strict per-path rule throttles
 * brute-force attempts on email sign-in; other endpoints use the window default.
 * In-memory store (single instance).
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/rate-limit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint the changed files**

Run: `node_modules/.bin/biome check apps/dashboard/lib/auth/rate-limit.ts apps/dashboard/lib/auth/__tests__/rate-limit.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/auth/rate-limit.ts apps/dashboard/lib/auth/__tests__/rate-limit.test.ts
git commit -m "feat(saas): buildRateLimitConfig helper (strict login throttle in prod)"
```

---

## Task 3: Wire both helpers into the Better Auth server config

**Files:**
- Modify: `apps/dashboard/lib/auth/server.ts`

The current file is:

```ts
import { db } from '@/lib/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin } from 'better-auth/plugins'

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'sqlite',
	}),
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
	},
	plugins: [admin()],
	hooks: {
		// Invitation-only: reject any public sign-up with a 403 Forbidden. Accounts are
		// created server-side via scripts/create-user.ts. Better Auth's own disableSignUp
		// guard (kept above as defense-in-depth) returns 400; we prefer a semantically
		// correct 403, applied before validation so the response is consistent.
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path.startsWith('/sign-up')) {
				throw new APIError('FORBIDDEN', { message: 'Sign up is disabled' })
			}
		}),
	},
})

export type Auth = typeof auth
```

- [ ] **Step 1: Add the two imports**

Add after the existing `import { admin } from 'better-auth/plugins'` line:

```ts
import { buildRateLimitConfig } from '@/lib/auth/rate-limit'
import { parseTrustedOrigins } from '@/lib/auth/trusted-origins'
```

- [ ] **Step 2: Add the two config keys**

In the `betterAuth({...})` object, add these two keys immediately after the `database` key (before `emailAndPassword`):

```ts
	trustedOrigins: parseTrustedOrigins(process.env),
	rateLimit: buildRateLimitConfig(process.env),
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no errors. (If `tsc` is slow, this is the project's standard check; wait for it.)

- [ ] **Step 4: Run the auth test suite**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth`
Expected: PASS — the new helper tests plus the existing `ownership.test.ts` / `require-user.test.ts` all green.

- [ ] **Step 5: Lint the changed file**

Run: `node_modules/.bin/biome check apps/dashboard/lib/auth/server.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/auth/server.ts
git commit -m "feat(saas): wire trustedOrigins + login rate limit into Better Auth"
```

---

## Task 4: `docker-compose.saas.yml` + `.env.example`

**Files:**
- Create: `docker-compose.saas.yml` (repo root)
- Modify: `apps/dashboard/.env.example`

- [ ] **Step 1: Create the SaaS compose overlay**

Create `docker-compose.saas.yml` at the repo root:

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

Note: the single-user `RECALBOX_HOST` / `RECALBOX_SSH_*` env vars are intentionally omitted — in multi-user mode, machines are added through the in-app UI after the admin logs in.

- [ ] **Step 2: Validate the compose file**

Run (a dummy secret satisfies the required-var guard):
```bash
BETTER_AUTH_SECRET=x BETTER_AUTH_URL=https://example.ts.net docker compose -f docker-compose.saas.yml config >/dev/null && echo OK
```
Expected: `OK` (no error). If `docker` is unavailable in the environment, run `docker compose -f docker-compose.saas.yml config` is skipped — note it in the commit and have the reviewer verify.

- [ ] **Step 3: Document the new env var in `.env.example`**

The file currently ends with the `CREDENTIALS_SECRET=` block. After the `BETTER_AUTH_URL=http://localhost:3000` line, add:

```
# Comma-separated origins Better Auth accepts (CSRF / cross-origin). For a public
# Tailscale Funnel deployment, set this to the public URL, e.g.
# https://<node>.<tailnet>.ts.net (add any MagicDNS name too). Defaults to
# BETTER_AUTH_URL when unset.
BETTER_AUTH_TRUSTED_ORIGINS=
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.saas.yml apps/dashboard/.env.example
git commit -m "feat(saas): docker-compose.saas.yml overlay + BETTER_AUTH_TRUSTED_ORIGINS env"
```

---

## Task 5: Ship the admin-bootstrap CLI in the image

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `Dockerfile`

The production image copies only the Next.js standalone output, the esbuild-bundled `scrobbler.js`, `drizzle/`, and `migrate.js` — never `scripts/` or `tsx`. Bundle `create-user.ts` the same way `scrobbler.ts` is bundled so the deployment doc's admin-bootstrap command has something to run.

- [ ] **Step 1: Add the build script**

In `apps/dashboard/package.json`, in `"scripts"`, immediately after the existing `"build:scrobbler"` line, add:

```json
		"build:create-user": "esbuild scripts/create-user.ts --bundle --platform=node --target=node22 --packages=external --tsconfig=tsconfig.json --outfile=.next/standalone/create-user.js",
```

(Match the surrounding indentation — the file uses tabs. Keep the trailing comma since `build:scrobbler` is not the last script entry.)

- [ ] **Step 2: Verify the bundle builds locally**

Run: `pnpm --filter @recalbox/dashboard run build:create-user`
Expected: esbuild writes `apps/dashboard/.next/standalone/create-user.js` with no error. (Requires a prior `pnpm --filter @recalbox/dashboard build` so `.next/standalone/` exists; if it does not, run that first — it is slow but is the standard build.)

Confirm: `test -f apps/dashboard/.next/standalone/create-user.js && echo OK` → `OK`.

- [ ] **Step 3: Add the Dockerfile build step**

In `Dockerfile`, the builder stage currently has at lines 31-32:

```dockerfile
# Compile scrobbler TypeScript → JS (no tsx required at runtime)
RUN pnpm --filter @recalbox/dashboard run build:scrobbler
```

Add immediately after line 32:

```dockerfile

# Compile the admin-bootstrap CLI → JS (no tsx required at runtime)
RUN pnpm --filter @recalbox/dashboard run build:create-user
```

No new `COPY` is needed: `COPY --from=builder /app/apps/dashboard/.next/standalone/ ./` already copies the bundle to `/app/create-user.js` in the runner image.

- [ ] **Step 4: Build the image (smoke test)**

Run: `docker build -t recalbox-dashboard:phase6 .`
Expected: build succeeds.

Verify the bundle is in the image:
```bash
docker run --rm --entrypoint sh recalbox-dashboard:phase6 -c 'test -f /app/create-user.js && echo OK'
```
Expected: `OK`. (If `docker` is unavailable in the environment, skip the build, note it in the commit message, and have the reviewer run it.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/package.json Dockerfile
git commit -m "feat(saas): bundle create-user CLI into the production image"
```

---

## Task 6: Deployment guide `docs/saas-deployment.md`

**Files:**
- Create: `docs/saas-deployment.md`
- Modify: `docs/deployment.md`

- [ ] **Step 1: Write the deployment guide**

Create `docs/saas-deployment.md` with this content:

````markdown
# Multi-user (SaaS) deployment — Tailscale Funnel

This guide deploys the **multi-user** dashboard on an always-on host, exposed over
public HTTPS via [Tailscale Funnel](https://tailscale.com/kb/1223/funnel). Family
members reach it from anywhere without installing Tailscale on their own device.

The dashboard reaches each Recalbox over the mesh VPN — see
[mesh-vpn-setup.md](mesh-vpn-setup.md) for connecting machines in different homes.
Funnel here exposes only the dashboard itself.

> Single-user LAN self-hosting? Use [deployment.md](deployment.md) instead — it does
> not require auth secrets or Funnel.

## 1. Prerequisites

- An always-on Linux host with Docker + Docker Compose.
- [Tailscale installed on the host](https://tailscale.com/download) and the node
  joined to your tailnet (`tailscale up`).
- Funnel enabled for your tailnet (Tailscale admin console → **Settings → Funnel**,
  and the `funnel` attribute granted in your ACLs).

## 2. Generate secrets (one-shot)

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # CREDENTIALS_SECRET (optional — see below)
```

Create a `.env` next to the compose file, readable only by you:

```bash
umask 077
cat > .env <<'EOF'
BETTER_AUTH_SECRET=<paste first value>
# BETTER_AUTH_URL / BETTER_AUTH_TRUSTED_ORIGINS are filled in at step 5.
BETTER_AUTH_URL=
BETTER_AUTH_TRUSTED_ORIGINS=
# Optional: rotate the credential-encryption key independently of the auth secret.
CREDENTIALS_SECRET=
TZ=Europe/Paris
EOF
```

> ⚠️ **Never regenerate these secrets once data exists.** Rotating
> `BETTER_AUTH_SECRET` invalidates every session **and** — because it also derives the
> credential-encryption key by default (Phase 4) — makes stored SSH/IGDB secrets
> permanently undecryptable. Set `CREDENTIALS_SECRET` if you need to rotate the auth
> secret without touching the credential key. Store both somewhere safe (a password
> manager); a database backup is useless without them.

## 3. Start the container

```bash
docker compose -f docker-compose.saas.yml up -d
docker compose -f docker-compose.saas.yml logs -f   # watch startup + migrations
```

The container binds `127.0.0.1:3000` only. Confirm it is healthy locally:

```bash
curl -fsS http://localhost:3000/api/health && echo OK
```

## 4. Expose via Tailscale Funnel

```bash
tailscale funnel --bg 3000
tailscale funnel status   # prints the public https://<node>.<tailnet>.ts.net URL
```

## 5. Point Better Auth at the public URL

Edit `.env` and set both to the Funnel URL from step 4:

```
BETTER_AUTH_URL=https://<node>.<tailnet>.ts.net
BETTER_AUTH_TRUSTED_ORIGINS=https://<node>.<tailnet>.ts.net
```

Apply the change:

```bash
docker compose -f docker-compose.saas.yml up -d
```

Setting `BETTER_AUTH_URL` to an `https://` origin also makes Better Auth issue secure
cookies automatically. If you also reach the app over a MagicDNS name, add it to
`BETTER_AUTH_TRUSTED_ORIGINS` as a second comma-separated origin.

## 6. Bootstrap the admin account

Sign-up is disabled (invitation-only). Create the first admin with the bundled CLI:

```bash
docker compose -f docker-compose.saas.yml exec recalbox-dashboard \
  node /app/create-user.js you@example.com 'a-strong-password' admin
```

Then open the public URL, log in, and add your Recalbox machines through the UI
(**Settings → Recalbox**). Each machine is owned by the account that creates it.

Additional family accounts use the same command with the `member` role (until email
invitations land in a later phase):

```bash
docker compose -f docker-compose.saas.yml exec recalbox-dashboard \
  node /app/create-user.js relative@example.com 'their-password' member
```

## 7. Backup & restore

The SQLite database (with **encrypted** credentials) lives in the `recalbox-data`
volume. Back it up — and keep `BETTER_AUTH_SECRET`/`CREDENTIALS_SECRET` with it, or the
backup cannot be decrypted:

```bash
# Backup
docker run --rm \
  -v recalbox-data:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/recalbox-backup-$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v recalbox-data:/data \
  -v "$(pwd)":/backup \
  alpine tar xzf /backup/recalbox-backup-YYYYMMDD.tar.gz -C /
```

## Updating

```bash
docker compose -f docker-compose.saas.yml pull
docker compose -f docker-compose.saas.yml up -d
```

---

## Annex B — Tailscale in a sidecar container

If you prefer not to install Tailscale on the host OS, run it as a second container
with its own state volume and an
[auth key](https://tailscale.com/kb/1085/auth-keys), share its network namespace with
the dashboard container (`network_mode: service:tailscale`), and run `tailscale funnel`
from inside it. This keeps the app entirely off the host network at the cost of an
extra container and an auth key to manage. See the
[Tailscale Docker guide](https://tailscale.com/kb/1282/docker).

## Annex C — Reverse proxy + custom domain

To serve from your own domain instead of `*.ts.net`, put Caddy/Traefik/Nginx in front
(see [deployment.md](deployment.md) for a Traefik label example and
[https-setup.md](https-setup.md) for Caddy / Nginx Proxy Manager / Cloudflare Tunnel).
Set `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` to your custom `https://` origin.
````

- [ ] **Step 2: Link the guide from `docs/deployment.md`**

`docs/deployment.md` ends with a "Connecting machines across homes (mesh VPN)"
section. Append a new section after it:

```markdown
## Multi-user (SaaS) deployment

To run the invitation-only multi-user edition on an always-on host exposed over public
HTTPS (Tailscale Funnel), with auth secrets and admin bootstrap, see
[saas-deployment.md](saas-deployment.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/saas-deployment.md docs/deployment.md
git commit -m "docs(saas): phase 6 Tailscale Funnel deployment guide"
```

---

## Final verification (after all tasks)

- [ ] Full dashboard suite green: `pnpm --filter @recalbox/dashboard exec vitest run` (expect +7 new tests vs the prior baseline).
- [ ] Type-check clean: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`.
- [ ] Biome clean on all changed files: `node_modules/.bin/biome check apps/dashboard/lib/auth/trusted-origins.ts apps/dashboard/lib/auth/rate-limit.ts apps/dashboard/lib/auth/server.ts apps/dashboard/.env.example`.
- [ ] `docker build -t recalbox-dashboard:phase6 .` succeeds and `/app/create-user.js` exists in the image.
- [ ] `docker compose -f docker-compose.saas.yml config` validates.
- [ ] `docs/saas-deployment.md` covers prerequisites → secrets → start → Funnel → auth URL → admin bootstrap → backup → annexes, and is linked from `docs/deployment.md`.
- [ ] Branch `feat/saas-multi-user` still un-merged.
