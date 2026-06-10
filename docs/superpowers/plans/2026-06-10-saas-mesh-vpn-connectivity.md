# Phase 5 — Mesh-VPN Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the mesh-VPN connectivity setup for connecting Recalbox machines across homes, and harden two code paths for the now internet-exposed server (ownership lock on the connection diagnostic; IPv6-capable host validation).

**Architecture:** Two independent code fixes plus one documentation deliverable. The code is small and surgical: a shared host-validation constant replacing 8 duplicated regexes, and a `canViewRecalbox` guard on the `test-connection` route. The SSH/MQTT pipeline is untouched. The doc describes a per-home Tailscale subnet-router topology (Headscale as annex).

**Tech Stack:** Next.js App Router (Node runtime), Zod, Vitest, `node-ssh`, `mqtt`, Better Auth (`AuthedUser` = `{ id, email, role }`).

**Spec:** `docs/superpowers/specs/2026-06-10-saas-mesh-vpn-connectivity-design.md`

**Conventions:** Biome — TABS, single quotes, no semicolons, trailing commas. Tests live in `__tests__/` next to the code. Run a single test file with:
`pnpm --filter @recalbox/dashboard exec vitest run <path>`
Branch `feat/saas-multi-user` stays un-merged (stacking phases).

---

## File Structure

- **Create** `apps/dashboard/lib/validation/host.ts` — single source of truth for the host-format whitelist (`HOST_REGEX`).
- **Create** `apps/dashboard/lib/validation/__tests__/host.test.ts` — tests the constant.
- **Modify** 8 files to import `HOST_REGEX` instead of inlining the regex.
- **Modify** `apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts` — add the `canViewRecalbox` guard.
- **Create** `apps/dashboard/app/api/recalboxes/[id]/test-connection/__tests__/route.test.ts` — auth/ownership gate tests.
- **Create** `docs/mesh-vpn-setup.md` — the install/ops guide.
- **Modify** `docs/deployment.md` and `CLAUDE.md` — link/note the new doc.

---

## Task 1: Shared host-validation constant with IPv6 support

**Files:**
- Create: `apps/dashboard/lib/validation/host.ts`
- Test: `apps/dashboard/lib/validation/__tests__/host.test.ts`
- Modify (replace inline regex with `HOST_REGEX` import):
  - `apps/dashboard/lib/settings/schemas.ts:27` and `:85`
  - `apps/dashboard/app/api/settings/route.ts:27`
  - `apps/dashboard/app/api/welcome-setup/route.ts:13`
  - `apps/dashboard/app/api/recalboxes/route.ts:26`
  - `apps/dashboard/app/api/recalboxes/[id]/route.ts:27`
  - `apps/dashboard/app/[locale]/welcome/page.tsx:26`
  - `apps/dashboard/app/[locale]/settings/page.tsx:64`
  - `apps/dashboard/components/recalbox-form.tsx:25`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/validation/__tests__/host.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HOST_REGEX } from '../host'

describe('HOST_REGEX', () => {
	it.each([
		'recalbox.local',
		'100.64.0.1',
		'fd7a:115c:a1e0::1',
		'fd7a:115c:a1e0:ab12:4843:cd96:6258:0102',
		'recalbox-salon',
		'recalbox-salon.tailnet-name.ts.net',
	])('accepts %s', (host) => {
		expect(HOST_REGEX.test(host)).toBe(true)
	})

	it.each(['has space', 'evil;rm -rf', 'a/b', 'quote"', 'pipe|cmd', ''])(
		'rejects %s',
		(host) => {
			expect(HOST_REGEX.test(host)).toBe(false)
		},
	)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/validation/__tests__/host.test.ts`
Expected: FAIL — `Failed to resolve import "../host"` (module does not exist yet).

- [ ] **Step 3: Create the module**

Create `apps/dashboard/lib/validation/host.ts`:

```ts
// Host-format whitelist for SSH/MQTT targets: hostnames, IPv4, IPv6 (tailnet fd7a:…),
// and MagicDNS names. The colon enables IPv6 addresses for mesh-VPN hosts.
// This is a sanity/anti-injection filter only — node-ssh and mqtt validate the real
// address when a connection is attempted.
export const HOST_REGEX = /^[a-zA-Z0-9.:-]+$/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/validation/__tests__/host.test.ts`
Expected: PASS (12 assertions).

- [ ] **Step 5: Replace the inline regex in the two Zod schema files**

In `apps/dashboard/lib/settings/schemas.ts`, add this import near the top (after the existing imports):

```ts
import { HOST_REGEX } from '@/lib/validation/host'
```

Then replace both occurrences:
- Line ~27: `.regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),` → `.regex(HOST_REGEX, 'Invalid hostname'),`
- Line ~85: `.regex(/^[a-zA-Z0-9.-]+$/),` → `.regex(HOST_REGEX),`

- [ ] **Step 6: Replace the inline regex in the API route schemas**

Add `import { HOST_REGEX } from '@/lib/validation/host'` to each of these and swap the regex literal:
- `apps/dashboard/app/api/settings/route.ts`: `.regex(/^[a-zA-Z0-9.-]+$/)` → `.regex(HOST_REGEX)`
- `apps/dashboard/app/api/welcome-setup/route.ts`: `.regex(/^[a-zA-Z0-9.-]+$/)` → `.regex(HOST_REGEX)`
- `apps/dashboard/app/api/recalboxes/route.ts`: `.regex(/^[a-zA-Z0-9.-]+$/)` → `.regex(HOST_REGEX)`
- `apps/dashboard/app/api/recalboxes/[id]/route.ts`: `.regex(/^[a-zA-Z0-9.-]+$/)` → `.regex(HOST_REGEX)`

- [ ] **Step 7: Replace the inline regex in the client components**

These are `'use client'` files; importing a plain exported const is safe (no server-only code). Add `import { HOST_REGEX } from '@/lib/validation/host'` to each and swap:
- `apps/dashboard/app/[locale]/welcome/page.tsx`: `.regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),` → `.regex(HOST_REGEX, 'Invalid hostname'),`
- `apps/dashboard/app/[locale]/settings/page.tsx`: `.regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),` → `.regex(HOST_REGEX, 'Invalid hostname'),`
- `apps/dashboard/components/recalbox-form.tsx`: `.regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),` → `.regex(HOST_REGEX, 'Invalid hostname'),`

- [ ] **Step 8: Verify no inline host regex remains**

Run: `grep -rn 'a-zA-Z0-9.-' apps/dashboard/app apps/dashboard/lib apps/dashboard/components`
Expected: no matches (the only remaining `a-zA-Z0-9` is `super-retrogamers/slug.ts`, which is unrelated and uses a different pattern `\.[a-zA-Z0-9]{1,5}$`).

- [ ] **Step 9: Run type check and the host test**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no errors.
Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/validation/__tests__/host.test.ts`
Expected: PASS.

- [ ] **Step 10: Run Biome on changed files**

Run (from repo root, bypassing any shell wrapper that may run Biome over the whole repo):
`node_modules/.bin/biome check apps/dashboard/lib/validation/host.ts apps/dashboard/lib/validation/__tests__/host.test.ts apps/dashboard/lib/settings/schemas.ts apps/dashboard/app/api/settings/route.ts apps/dashboard/app/api/welcome-setup/route.ts apps/dashboard/app/api/recalboxes/route.ts "apps/dashboard/app/api/recalboxes/[id]/route.ts" "apps/dashboard/app/[locale]/welcome/page.tsx" "apps/dashboard/app/[locale]/settings/page.tsx" apps/dashboard/components/recalbox-form.tsx`
Expected: "No fixes applied." (no errors).

- [ ] **Step 11: Commit**

```bash
git add apps/dashboard/lib/validation/host.ts \
  apps/dashboard/lib/validation/__tests__/host.test.ts \
  apps/dashboard/lib/settings/schemas.ts \
  apps/dashboard/app/api/settings/route.ts \
  apps/dashboard/app/api/welcome-setup/route.ts \
  apps/dashboard/app/api/recalboxes/route.ts \
  "apps/dashboard/app/api/recalboxes/[id]/route.ts" \
  "apps/dashboard/app/[locale]/welcome/page.tsx" \
  "apps/dashboard/app/[locale]/settings/page.tsx" \
  apps/dashboard/components/recalbox-form.tsx
git commit -m "feat(saas): share host-validation regex and accept IPv6 tailnet hosts"
```

---

## Task 2: Ownership lock on the test-connection route

**Files:**
- Modify: `apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts`
- Test: `apps/dashboard/app/api/recalboxes/[id]/test-connection/__tests__/route.test.ts`

**Context:** The current `POST` handler checks only `getUser()`, so any authenticated user can probe any Recalbox and read its latency/error output. Add `canViewRecalbox(user, id)` and return 404 when not viewable, matching `GET /api/recalboxes/[id]`. View (not control) is the correct scope: the diagnostic is read-like and an admin's read-only view legitimately includes it.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/app/api/recalboxes/[id]/test-connection/__tests__/route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canViewRecalbox: (...a: unknown[]) => canView(...a),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: {
		getRecalbox: () => ({
			id: 'rb-1',
			host: 'h',
			sshUser: 'root',
			sshPassword: 'x',
			sshPort: 22,
			mqttPort: 1883,
		}),
	},
}))
vi.mock('node-ssh', () => ({
	NodeSSH: class {
		connect = vi.fn().mockResolvedValue(undefined)
		execCommand = vi.fn().mockResolvedValue({ stdout: 'ok' })
		dispose = vi.fn()
	},
}))
vi.mock('mqtt', () => ({
	default: {
		connect: () => {
			const client = {
				on: (ev: string, cb: (...a: unknown[]) => void) => {
					if (ev === 'connect') setTimeout(() => cb(), 0)
				},
				subscribe: vi.fn(),
				end: vi.fn(),
			}
			return client
		},
	},
}))

import { POST } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }
afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
})

describe('POST /api/recalboxes/[id]/test-connection', () => {
	it('returns 401 when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await POST({} as never, ctx as never)
		expect(res.status).toBe(401)
	})

	it('returns 404 when the user cannot view the box', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canView.mockReturnValue(false)
		const res = await POST({} as never, ctx as never)
		expect(res.status).toBe(404)
	})

	it('runs the diagnostic when the box is viewable', async () => {
		vi.useFakeTimers()
		getUser.mockResolvedValue({ id: 'a1', email: 'a@b.c', role: 'admin' })
		canView.mockReturnValue(true)
		const resPromise = POST({} as never, ctx as never)
		await vi.runAllTimersAsync()
		const res = await resPromise
		vi.useRealTimers()
		expect(res.status).toBe(200)
		expect(await res.json()).toHaveProperty('overall')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run "app/api/recalboxes/[id]/test-connection/__tests__/route.test.ts"`
Expected: FAIL — the "404 when not viewable" test fails because the route does not yet consult `canViewRecalbox` (it would proceed and return 200 or hit the box).

- [ ] **Step 3: Add the guard to the route**

In `apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts`:

Change the import line:
```ts
import { getUser, unauthorized } from '@/lib/auth/require-user'
```
to:
```ts
import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
```

Replace the start of the `POST` handler:
```ts
export async function POST(_req: NextRequest, { params }: Ctx) {
	if (!(await getUser())) return unauthorized()
	const { id } = await params
	const rb = configStore.getRecalbox(id)
	if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })
```
with:
```ts
export async function POST(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!canViewRecalbox(user, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	const rb = configStore.getRecalbox(id)
	if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run "app/api/recalboxes/[id]/test-connection/__tests__/route.test.ts"`
Expected: PASS (3 tests).

Note: if the fake-timer flush in the third test proves flaky in this environment, the security-critical assertions are the 401 and 404 tests, which short-circuit before any network call and are fully deterministic. Do not weaken the guard to make a test pass.

- [ ] **Step 5: Type check and Biome**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no errors.
Run: `node_modules/.bin/biome check "apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts" "apps/dashboard/app/api/recalboxes/[id]/test-connection/__tests__/route.test.ts"`
Expected: "No fixes applied."

- [ ] **Step 6: Commit**

```bash
git add "apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts" \
  "apps/dashboard/app/api/recalboxes/[id]/test-connection/__tests__/route.test.ts"
git commit -m "fix(saas): require view permission to test a recalbox connection"
```

---

## Task 3: Mesh-VPN setup documentation

**Files:**
- Create: `docs/mesh-vpn-setup.md`
- Modify: `docs/deployment.md` (add a link)
- Modify: `CLAUDE.md` (note tailnet hosts in the Multi-Recalbox section)

This task has no automated test; verification is that the file exists with all sections and the links resolve.

- [ ] **Step 1: Create `docs/mesh-vpn-setup.md`**

Write this exact content:

````markdown
# Mesh-VPN setup (connecting Recalbox machines across homes)

When the dashboard server and the Recalbox machines live in **different homes** (behind
separate NATs), they cannot reach each other over the LAN. A mesh VPN puts every machine
on one private overlay network so the existing SSH/MQTT pipeline keeps working — only the
`host` value of each Recalbox changes to a tailnet address.

This guide uses **Tailscale** (hosted) as the primary path. A **Headscale** (self-hosted)
annex is at the end.

## Topology

```
                         ┌─────────────────────────┐
                         │  Central dashboard host  │
                         │  (always-on, on tailnet) │
                         │  --accept-routes         │
                         └────────────┬─────────────┘
                                      │  tailnet (WireGuard mesh)
                 ┌────────────────────┼────────────────────┐
                 │                                          │
      ┌──────────┴───────────┐                  ┌───────────┴──────────┐
      │  Home A subnet router │                  │  Home B subnet router │
      │  (Pi / mini-PC)       │                  │  (Pi / mini-PC)       │
      │  --advertise-routes   │                  │  --advertise-routes   │
      │   =10.10.0.0/24       │                  │   =10.20.0.0/24       │
      └──────────┬───────────┘                  └───────────┬──────────┘
                 │ LAN                                       │ LAN
        ┌────────┴────────┐                         ┌────────┴────────┐
        │ Recalbox (10.10.0.5) │                    │ Recalbox (10.20.0.5) │
        │ unchanged             │                    │ unchanged            │
        └──────────────────────┘                    └──────────────────────┘
```

The Recalbox OS is read-only and locked down, so **nothing is installed on the Recalbox**.
Each home runs one always-on **subnet router** that advertises its LAN into the tailnet;
the central server reaches each Recalbox by its LAN IP through that router.

## 1. Create a Tailscale account

1. Sign up at <https://tailscale.com> and create a tailnet.
2. Leave **MagicDNS** enabled (Admin console → DNS) — it gives each node a stable name.

## 2. Per home: install a subnet router

On an always-on device in each home (Raspberry Pi, mini-PC, or a router with Tailscale
support):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
# Advertise this home's LAN. Use a UNIQUE CIDR per home (see the warning below).
sudo tailscale up --advertise-routes=10.10.0.0/24
```

Then in the Tailscale admin console → **Machines** → the subnet router → **Edit route
settings**, approve the advertised subnet. Routes are not active until approved.

## 3. Central server: accept routes

On the always-on host that runs the dashboard container:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-routes
```

The server can now reach every approved home subnet.

## 4. Point the dashboard at each Recalbox

In the dashboard, edit each Recalbox and set its **host** to the LAN IP it has inside its
home (e.g. `10.10.0.5`), or a MagicDNS name if you assigned one. SSH port, MQTT port, and
credentials are unchanged. Use the **Test connection** button on the edit page to confirm
SSH and MQTT both succeed.

## 5. Lock it down (ACLs)

In the Tailscale admin console → **Access controls**, restrict traffic so the dashboard
host reaches only what it needs — the Recalbox SSH and MQTT ports. Example policy fragment:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:dashboard"],
      "dst": ["10.10.0.5:22,1883", "10.20.0.5:22,1883"]
    }
  ]
}
```

Tag the dashboard host with `tag:dashboard` (Machines → Edit ACL tags). Consider enabling
**tailnet lock** if you want device-key approval for new nodes.

## ⚠️ Overlapping subnets (the #1 pitfall)

If two homes both use `192.168.1.0/24` (the most common default), advertising both into the
same tailnet creates an **overlapping-route collision** and traffic will go to the wrong
home. Fix it one of these ways:

- Give each home a **unique LAN CIDR** (e.g. Home A `10.10.0.0/24`, Home B `10.20.0.0/24`).
  Change the router's DHCP range; the Recalbox picks up the new subnet on reconnect.
- Or use Tailscale **4via6** subnet routers, which map each overlapping subnet to a unique
  IPv6 range. See <https://tailscale.com/kb/1201/4via6-subnets>.

Plan unique CIDRs **before** onboarding the second home — it is far easier than renumbering
later.

## Troubleshooting

- **Can't reach the Recalbox:** confirm the subnet route is *approved* in the admin console
  and the server was brought up with `--accept-routes`.
- **MagicDNS name doesn't resolve:** MagicDNS covers tailnet nodes, not LAN devices behind a
  subnet router — use the Recalbox's LAN IP for those.
- **High latency / drops:** check `tailscale status` for a relayed (DERP) connection; a
  direct connection needs UDP reachability. `tailscale ping <node>` shows the path.

## Annex: self-hosting with Headscale

If you outgrow Tailscale's free plan (its user/seat limits) or want to self-host the
coordinator, [Headscale](https://github.com/juanfont/headscale) is an open-source,
API-compatible control server. Run it on the same always-on host as the dashboard (see
`docs/deployment.md`), point each node at it with `tailscale up --login-server=https://…`,
and approve subnet routes with `headscale routes enable`. The node-side setup, subnet
routers, and overlapping-subnet rules above are identical; only the coordinator changes.
````

- [ ] **Step 2: Link the doc from `docs/deployment.md`**

At the end of `docs/deployment.md`, append:

```markdown

## Connecting machines across homes (mesh VPN)

If your Recalbox machines are in different homes (behind separate NATs), see
[mesh-vpn-setup.md](mesh-vpn-setup.md) for the Tailscale subnet-router setup.
```

- [ ] **Step 3: Note tailnet hosts in `CLAUDE.md`**

In `CLAUDE.md`, find the "### Multi-Recalbox support" section. At the end of its first
paragraph (the one describing the `recalboxes` table row: "host, SSH creds, MQTT port,
color, emoji"), append this sentence:

```markdown
 The `host` may be a LAN hostname/IP or a mesh-VPN (tailnet) address — see `docs/mesh-vpn-setup.md` for connecting machines across homes.
```

- [ ] **Step 4: Verify links and structure**

Run: `ls docs/mesh-vpn-setup.md && grep -n "mesh-vpn-setup" docs/deployment.md CLAUDE.md`
Expected: the file exists and both the deployment.md link and the CLAUDE.md note are present.

- [ ] **Step 5: Commit**

```bash
git add docs/mesh-vpn-setup.md docs/deployment.md CLAUDE.md
git commit -m "docs(saas): add mesh-VPN (Tailscale subnet-router) setup guide"
```

---

## Final Verification (after all tasks)

- [ ] Run the full dashboard test suite: `pnpm --filter @recalbox/dashboard exec vitest run`
  Expected: all green (previous baseline 465, now +~15 new tests).
- [ ] `pnpm --filter @recalbox/dashboard exec tsc --noEmit` → no errors.
- [ ] `node_modules/.bin/biome check` on all changed files → no errors.
- [ ] `docs/mesh-vpn-setup.md` reads end-to-end with all 9 spec sections present.
- [ ] Branch `feat/saas-multi-user` still un-merged.
