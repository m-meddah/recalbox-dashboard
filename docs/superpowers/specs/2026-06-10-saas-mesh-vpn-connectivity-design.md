# Phase 5 — Mesh-VPN connectivity (design)

> SaaS multi-user edition, Phase 5 of `docs/prd/2026-06-08-saas-multi-user.md`.
> Prior phases (auth, ownership/scoping, admin read-only view, credential
> encryption) are DONE on branch `feat/saas-multi-user` (kept un-merged, stacking).

## Goal

Connect Recalbox machines living in different homes (behind separate NATs) to the
central dashboard server through a mesh VPN, **without changing the SSH/MQTT/scrobbler
pipeline** — only the target `host` values in the `recalboxes` table become tailnet
addresses. Delivered as two parts: operational documentation (the bulk) plus two small
code fixes that align with the now internet-exposed server.

## Decisions (from brainstorming)

- **Mesh VPN:** Tailscale (hosted) as the primary documented path; Headscale
  (self-hosted) as an annex for users who outgrow the free plan or want full self-hosting.
- **Per-home topology:** one always-on **subnet router** per home (Raspberry Pi /
  mini-PC / compatible router) advertising the home LAN. The Recalbox OS is read-only
  and locked down, so nothing is installed on the Recalbox itself — it stays reachable
  via its LAN IP through the subnet router. No "Tailscale directly on Recalbox" path is
  documented.
- **Code scope:** the existing SSH/MQTT connectivity diagnostic is sufficient for
  verification (no new probing code). Two fixes only: ownership lock on the
  `test-connection` route, and IPv6 acceptance in the host-validation regex.

## Part A — Documentation: `docs/mesh-vpn-setup.md`

A new step-by-step install/ops doc. Sections:

1. **Overview + topology** — ASCII diagram: central server (on the tailnet) → per-home
   subnet router → home LAN → Recalbox (unchanged, reachable by its LAN IP). Explain that
   the existing SSH/MQTT pipeline is reused unchanged; only the `host` value changes.
2. **Tailscale account** — create the tailnet, note MagicDNS.
3. **Per home: subnet router** — install Tailscale on an always-on device,
   `tailscale up --advertise-routes=<home LAN CIDR>`, approve the advertised routes in the
   Tailscale admin console.
4. **Central server** — join the tailnet, `tailscale up --accept-routes`.
5. **Configure the dashboard** — set each Recalbox `host` to its LAN IP (reachable via the
   subnet router) or a MagicDNS name; verify with the existing **test-connection** button
   on the Recalbox edit page.
6. **ACLs / tailnet lock** — restrict so the central server reaches only the SSH/MQTT
   ports of the Recalbox machines; scope family members' own devices appropriately.
7. **⚠️ Overlapping subnets gotcha** — two homes both on `192.168.1.0/24` collide when
   advertised into the same tailnet. Recommend unique LAN CIDRs per home (or Tailscale
   4via6). This is the #1 subnet-router pitfall across multiple sites and must be called
   out prominently.
8. **Headscale annex** — self-hosted coordinator alternative; point at the always-on host
   from Phase 6. Keep brief (pointer + key differences), not a full second install guide.
9. **Troubleshooting** — route not approved, MagicDNS resolution, latency.

Also: add a link from `docs/deployment.md` to this doc, and a short note in the
"Multi-Recalbox support" section of `CLAUDE.md` that hosts may be tailnet addresses.

## Part B — Code (two fixes, TDD)

### B1 — Ownership lock on `test-connection`

`apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts` currently checks only
`getUser()`, so any authenticated user can probe any Recalbox (and read its latency /
error output). Add `canViewRecalbox(user, id)` and return 404 when not viewable — the same
pattern as `GET /api/recalboxes/[id]`. View (not control) is the right scope: the
diagnostic is read-like and an admin's read-only view legitimately includes it.

**Tests** (new `__tests__/route.test.ts` next to the route, mocking `node-ssh` and `mqtt`
so no real connection is attempted):
- 401 when unauthenticated.
- 404 when the user cannot view the box (`canViewRecalbox` → false).
- 200 / proceeds when viewable.

### B2 — IPv6 acceptance + DRY the host regex

The host-validation regex `^[a-zA-Z0-9.-]+$` is duplicated across 8 files:

- `apps/dashboard/app/[locale]/welcome/page.tsx:26`
- `apps/dashboard/app/[locale]/settings/page.tsx:64`
- `apps/dashboard/app/api/settings/route.ts:27`
- `apps/dashboard/app/api/welcome-setup/route.ts:13`
- `apps/dashboard/app/api/recalboxes/route.ts:26`
- `apps/dashboard/app/api/recalboxes/[id]/route.ts:27`
- `apps/dashboard/lib/settings/schemas.ts:27` and `:85`
- `apps/dashboard/components/recalbox-form.tsx:25`

Extract to a single shared module `apps/dashboard/lib/validation/host.ts`:

```ts
// Host whitelist: hostnames, IPv4, IPv6 (tailnet fd7a:…), MagicDNS names.
// Sanity/anti-injection filter only — node-ssh / mqtt validate the real address.
export const HOST_REGEX = /^[a-zA-Z0-9.:-]+$/
```

The only behavioral change is adding `:` so tailnet IPv6 addresses (`fd7a:…`) are
accepted; IPv4 `100.x.y.z` and MagicDNS names already pass. Replace all 8 occurrences with
an import of `HOST_REGEX` (keeping each call's existing error message where one is passed,
e.g. `.regex(HOST_REGEX, 'Invalid hostname')`).

**Tests** (`apps/dashboard/lib/validation/__tests__/host.test.ts`):
- accepts IPv4 `100.64.0.1`, IPv6 `fd7a:115c:a1e0::1`, hostname `recalbox-salon`,
  MagicDNS FQDN `recalbox-salon.tailnet.ts.net`.
- rejects a value with a space and a value with `;` (shell-dangerous chars stay blocked).

## Out of scope (YAGNI)

- Docker deployment + HTTPS reverse proxy (Phase 6).
- A live connection-status indicator in the UI.
- Installing Tailscale directly on the Recalbox.

## Verification

- `docs/mesh-vpn-setup.md` exists, covers all 9 sections, and is linked from
  `docs/deployment.md`.
- `test-connection` returns 404 for a non-viewable Recalbox; tests green.
- `HOST_REGEX` lives in one module, imported by all 8 sites; IPv6 host accepted;
  dangerous chars rejected; tests green.
- Full dashboard test suite green, `tsc` clean, Biome clean on changed files.
- Branch `feat/saas-multi-user` stays un-merged (stacking phases).
