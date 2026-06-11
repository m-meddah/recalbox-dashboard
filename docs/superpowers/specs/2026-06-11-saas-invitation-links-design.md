# Phase 7 — Invitation links (account provisioning) — Design

> Part of the SaaS multi-user edition. Lets an **admin** provision family member
> accounts by generating a single-use **invitation link** (no email infrastructure):
> the admin copies the link and shares it however they like; the invitee opens it,
> sets a password, and is signed in as a `member`.

## Context

Better Auth (1.6.15) is already in place: `emailAndPassword` with `disableSignUp`,
an `admin()` plugin, role column (`admin` | `member`), a `before` hook that 403s every
`/sign-up`, and accounts created server-side via `auth.api.createUser`
(`scripts/create-user.ts`, also bundled into the prod image as `/app/create-user.js`).
There is **no email library** installed and — per the brainstorm — none will be added.

Phase 7 depends on Phase 6 only for the public base URL (`BETTER_AUTH_URL`) used to
build links. It touches **no** SSH/MQTT/Recalbox code, so it is fully testable without a
live Recalbox.

### Decisions (brainstormed & accepted)

- **Delivery = manual link, no email.** The admin generates a link in the UI and shares
  it out-of-band (WhatsApp/SMS/etc.). No SMTP, no templates, no deliverability concerns.
- **Admin fixes the email** at invite time; the invitee only sets a password.
- **Mechanism = dedicated `invitations` table**, account created on acceptance (not a
  half-created user upfront, not Better Auth's internal `verification` table).

## Data model

New table `invitations` (Drizzle migration `0019`), text `id` to match the auth tables:

| column | type | notes |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()` |
| `email` | text not null | invited address (admin-specified) |
| `role` | text not null default `'member'` | `'member'` \| `'admin'` |
| `token_hash` | text not null **unique** | `sha256(rawToken)` hex — raw token never stored |
| `expires_at` | integer ts_ms not null | now + 7 days |
| `invited_by_user_id` | text not null → `user.id` | who created it |
| `accepted_at` | integer ts_ms nullable | stamped on acceptance (single-use marker) |
| `created_at` | integer ts_ms not null | default now |

Index: unique on `token_hash` (lookup + dedupe). The table lives in the Drizzle schema
alongside the other domain tables.

### Token model (API-key-style "shown once")

- Raw token = `crypto.randomBytes(32).toString('base64url')` — 256-bit, unguessable, so
  brute force is infeasible and **no custom rate-limiter is needed**.
- Only `sha256(token)` (hex) is stored. The raw token appears exactly once, in the create
  response/link. **Never stored, never logged.**
- A lost link can't be recovered (no raw token on hand) → admin **revokes and re-invites**.
  This is the intended, secure behavior.
- **Re-inviting the same email** deletes any existing pending invite for it, then inserts a
  fresh one (upsert → new token).
- **Guard:** inviting an email that already has a `user` account is rejected (409).

## Server logic & API routes

### `lib/auth/invitations.ts`

- `generateInvitationToken()` → `{ token, tokenHash }`
- `hashInvitationToken(token)` → sha256 hex
- `INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000`
- `createInvitation({ email, role, invitedByUserId })` → reject if a `user` with that email
  exists; delete any pending invite for the email; insert fresh; return `{ invitation, token }`
- `validateInvitation(token)` → look up by hash; return the row only if **not accepted** and
  **not expired**; else `null`
- `acceptInvitation({ token, password })` → validate; `auth.api.createUser({ body: { email,
  password, name: email, role } })` (headless, same proven path as the CLI); stamp
  `accepted_at`; return `{ email }`

### `lib/db/invitation-queries.ts`

Thin Drizzle wrappers: `insertInvitation`, `deletePendingByEmail`, `getInvitationByTokenHash`,
`listPendingInvitations`, `markAccepted`, `deleteInvitationById`. Plus `getUserByEmail`
(added to `user-queries.ts`).

### API routes

Admin routes gated with the existing `requireUser` + `isAdmin`:

| Route | Auth | Body / Query | Returns |
|---|---|---|---|
| `POST /api/invitations` | admin | `{ email, role? }` (role default `member`) | `{ link, email, expiresAt }` — raw token in `link`, shown once |
| `GET /api/invitations` | admin | — | pending `[{ id, email, role, expiresAt, createdAt }]` (never token/hash) |
| `DELETE /api/invitations/[id]` | admin | — | `{ ok }` (revoke) |
| `GET /api/invitations/validate?token=` | public | `token` | `{ valid, email }` or `{ valid: false }` |
| `POST /api/invitations/accept` | public | `{ token, password }` | `{ ok, email }` — generic error on bad/expired token |

The `link` is `${BETTER_AUTH_URL}/${locale}/accept-invite?token=…`, falling back to the
request origin if `BETTER_AUTH_URL` is unset.

**Auth interplay (verified in Phase 6):** the `/sign-up` 403 hook does not touch these custom
routes, and `auth.api.createUser` called server-side without request headers skips the
admin-only guard. After a successful accept, the **client** (accept page) calls the existing
Better Auth `signIn.email` to obtain the session cookie — no cookie-forwarding plumbing in the
route. All failures return a generic "invalid or expired" (no enumeration beyond echoing the
admin-chosen email on a valid token).

## UI & middleware

### Admin — "Invitations" card on the existing `/[locale]/admin` page

The `/admin` page is already admin-gated (non-admins redirected). Two client components:

- `components/admin/invite-form.tsx` — email input + submit → `POST /api/invitations` →
  renders the returned link with a **copy button** and a "shown only once" note.
- `components/admin/pending-invitations.tsx` — lists pending invites (email, role, expiry)
  with a **revoke** button (`DELETE`). No copy-link here (only the hash is stored).

### Member — new public page `/[locale]/accept-invite` (client)

1. On mount, read `?token=` and call `GET /api/invitations/validate`.
2. Valid → show the pre-filled email (read-only) + password (+ confirm) → submit
   `POST /api/invitations/accept`, then `authClient.signIn.email({ email, password })`,
   then redirect to `/`.
3. Invalid/expired → a clear message to ask the admin for a fresh link.

### Middleware (`proxy.ts`)

Generalize the `isLoginPage` check to an `isPublicPage` that also matches `/accept-invite`,
so invited members reach it without a session. `/api/*` already passes through, so the
validate/accept endpoints need no change.

### i18n

Add `invitations.*` (admin card) and `acceptInvite.*` (member page) keys to `en.json` and
`fr.json`.

## Testing

TDD, Vitest, `__tests__/` next to code:

- `lib/auth/__tests__/invitations.test.ts` — token gen produces distinct values;
  `hashInvitationToken` is deterministic; `createInvitation` rejects an existing-account email
  and deletes a prior pending invite (upsert); `validateInvitation` rejects expired and
  already-accepted tokens; `acceptInvitation` calls `createUser` and stamps `accepted_at`.
  DB injected/in-memory per existing patterns.
- Route-level: admin routes return 401/403 for unauthenticated/non-admin; `accept` with a bad
  token returns the generic error.
- Manual browser walkthrough: invite → copy link → accept → auto-login (no Recalbox needed).

## Security recap

- 256-bit token, stored hashed, shown once, single-use (`accepted_at`), 7-day expiry.
- Admin routes behind `requireUser` + `isAdmin`; public routes limited to `validate`/`accept`
  with generic errors.
- Tokens never logged; the `/sign-up` 403 hook stays as defense-in-depth.

## Out of scope (YAGNI)

Email/SMTP sending (manual link chosen), member-initiated invites, re-sending an existing link
(re-invite instead), editing a member's role from the UI (CLI/future phase), organizations/
teams, audit logging.
