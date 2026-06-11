# Phase 7 — Invitation Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin provision family `member` accounts via single-use invitation links (no email), which the invitee opens to set a password and get signed in.

**Architecture:** A dedicated `invitations` table holds a SHA-256 hash of a 256-bit token. Admin-only API routes create/list/revoke invites; public routes validate a token and accept it (creating the account server-side via `auth.api.createUser`, then the client signs in). Core logic is dependency-injected for unit testing, mirroring `lib/db/admin-queries.ts`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (better-sqlite3), Better Auth 1.6.15 (`admin()` plugin), Zod, Vitest, next-intl.

**Spec:** `docs/superpowers/specs/2026-06-11-saas-invitation-links-design.md`

**Conventions to follow (verified in this codebase):**
- Biome: TABS, single quotes, no semicolons, trailing commas.
- Auth guards from `@/lib/auth/require-user`: `getUser()`, `unauthorized()` (401), `forbidden()` (403); `isAdmin(user)` from `@/lib/auth/ownership`.
- API routes export `dynamic = 'force-dynamic'` and `runtime = 'nodejs'`; dynamic params typed `{ params: Promise<{ id: string }> }`.
- Test command: `pnpm --filter @recalbox/dashboard exec vitest run <path>`
- Type-check: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
- Lint a file: `node_modules/.bin/biome check <files>` (run from `apps/dashboard/`)
- All commands below run from `apps/dashboard/` unless noted.

---

## File Structure

- `lib/db/schema.ts` — add `invitations` table (timestamps stored as plain integer epoch-ms for simple arithmetic).
- `lib/db/invitation-queries.ts` (new) — thin Drizzle wrappers + `InvitationRow` type.
- `lib/db/user-queries.ts` — add `getUserByEmail`.
- `lib/auth/invitation-token.ts` (new) — pure crypto helpers (`generateInvitationToken`, `hashInvitationToken`).
- `lib/auth/invitations.ts` (new) — `createInvitation`, `validateInvitation`, `acceptInvitation` (dependency-injected).
- `app/api/invitations/route.ts` (new) — `POST` (create) + `GET` (list), admin-only.
- `app/api/invitations/[id]/route.ts` (new) — `DELETE` (revoke), admin-only.
- `app/api/invitations/validate/route.ts` (new) — `GET`, public.
- `app/api/invitations/accept/route.ts` (new) — `POST`, public.
- `proxy.ts` — exempt `/accept-invite` from the login redirect.
- `app/[locale]/accept-invite/page.tsx` (new) — public client page.
- `components/admin/invite-form.tsx` + `components/admin/pending-invitations.tsx` (new) — admin UI.
- `app/[locale]/admin/page.tsx` — render an "Invitations" section.
- `messages/en.json` + `messages/fr.json` — `invitations.*` and `acceptInvite.*` keys.

---

## Task 1: Database table + queries

**Files:**
- Modify: `lib/db/schema.ts` (add table near the end, before the `export * from '@/lib/auth/auth-schema'` line at :523)
- Create: `lib/db/invitation-queries.ts`
- Modify: `lib/db/user-queries.ts`
- Create: `drizzle/migrations/00XX_*.sql` (generated)

- [ ] **Step 1: Add the `invitations` table to the schema**

In `lib/db/schema.ts`, add immediately before the final `export * from '@/lib/auth/auth-schema'` line (`int`, `index`, `text`, `sqliteTable` are already imported at the top):

```ts
export const invitations = sqliteTable(
	'invitations',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		role: text('role').notNull().default('member'),
		tokenHash: text('token_hash').notNull().unique(),
		// Epoch milliseconds (plain integer) — kept as a number for simple expiry math.
		expiresAt: int('expires_at').notNull(),
		invitedByUserId: text('invited_by_user_id').notNull(),
		acceptedAt: int('accepted_at'),
		createdAt: int('created_at').notNull(),
	},
	(table) => [index('invitations_token_hash_idx').on(table.tokenHash)],
)
```

- [ ] **Step 2: Generate the migration**

Run (from repo root):
```bash
pnpm --filter @recalbox/dashboard drizzle-kit generate
```
Expected: a new `drizzle/migrations/00XX_*.sql` containing `CREATE TABLE \`invitations\``. Commit it as generated; do not edit by hand.

- [ ] **Step 3: Create the query module**

Create `lib/db/invitation-queries.ts`:

```ts
import { db } from '@/lib/db/index'
import { invitations } from '@/lib/db/schema'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'

export type InvitationRow = {
	id: string
	email: string
	role: string
	tokenHash: string
	expiresAt: number
	invitedByUserId: string
	acceptedAt: number | null
	createdAt: number
}

export type PendingInvitation = Pick<
	InvitationRow,
	'id' | 'email' | 'role' | 'expiresAt' | 'createdAt'
>

export function insertInvitation(row: InvitationRow): void {
	db.insert(invitations).values(row).run()
}

/** Remove any not-yet-accepted invite for this email (used to upsert before inserting). */
export function deletePendingByEmail(email: string): void {
	db.delete(invitations)
		.where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)))
		.run()
}

export function getInvitationByTokenHash(tokenHash: string): InvitationRow | undefined {
	const rows = db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).all()
	return rows[0] as InvitationRow | undefined
}

/** Pending = not accepted and not expired. Never exposes the token hash. */
export function listPendingInvitations(): PendingInvitation[] {
	return db
		.select({
			id: invitations.id,
			email: invitations.email,
			role: invitations.role,
			expiresAt: invitations.expiresAt,
			createdAt: invitations.createdAt,
		})
		.from(invitations)
		.where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, Date.now())))
		.orderBy(asc(invitations.createdAt))
		.all()
}

export function markAccepted(id: string, acceptedAt: number): void {
	db.update(invitations).set({ acceptedAt }).where(eq(invitations.id, id)).run()
}

export function deleteInvitationById(id: string): void {
	db.delete(invitations).where(eq(invitations.id, id)).run()
}
```

- [ ] **Step 4: Add `getUserByEmail` to `user-queries.ts`**

In `lib/db/user-queries.ts`, change the drizzle import to add `eq`, and append the function:

```ts
import { asc, eq } from 'drizzle-orm'
```

```ts
/** Look up a single user by email. Returns undefined when none exists. */
export function getUserByEmail(email: string): AppUser | undefined {
	try {
		const rows = db
			.select({ id: userTable.id, email: userTable.email, role: userTable.role })
			.from(userTable)
			.where(eq(userTable.email, email))
			.all()
		const row = rows[0]
		return row ? { id: row.id, email: row.email, role: row.role ?? 'member' } : undefined
	} catch {
		return undefined
	}
}
```

- [ ] **Step 5: Verify type-check + lint**

Run:
```bash
pnpm --filter @recalbox/dashboard exec tsc --noEmit
node_modules/.bin/biome check lib/db/invitation-queries.ts lib/db/user-queries.ts lib/db/schema.ts
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/lib/db/invitation-queries.ts apps/dashboard/lib/db/user-queries.ts apps/dashboard/drizzle/migrations
git commit -m "feat(saas): invitations table + queries"
```

---

## Task 2: Pure token helpers

**Files:**
- Create: `lib/auth/invitation-token.ts`
- Test: `lib/auth/__tests__/invitation-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/auth/__tests__/invitation-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateInvitationToken, hashInvitationToken } from '../invitation-token'

describe('invitation-token', () => {
	it('generateInvitationToken returns a url-safe token and its sha256 hash', () => {
		const { token, tokenHash } = generateInvitationToken()
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(token.length).toBeGreaterThanOrEqual(40)
		expect(tokenHash).toBe(hashInvitationToken(token))
		expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
	})

	it('generates a distinct token each call', () => {
		const a = generateInvitationToken()
		const b = generateInvitationToken()
		expect(a.token).not.toBe(b.token)
		expect(a.tokenHash).not.toBe(b.tokenHash)
	})

	it('hashInvitationToken is deterministic', () => {
		expect(hashInvitationToken('abc')).toBe(hashInvitationToken('abc'))
		expect(hashInvitationToken('abc')).not.toBe(hashInvitationToken('abd'))
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/invitation-token.test.ts`
Expected: FAIL — cannot find module `../invitation-token`.

- [ ] **Step 3: Implement**

Create `lib/auth/invitation-token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'

/** SHA-256 hex of a raw invitation token. Only the hash is ever persisted. */
export function hashInvitationToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

/** A 256-bit url-safe token plus its hash. The raw token is shown once, never stored. */
export function generateInvitationToken(): { token: string; tokenHash: string } {
	const token = randomBytes(32).toString('base64url')
	return { token, tokenHash: hashInvitationToken(token) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/invitation-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/auth/invitation-token.ts apps/dashboard/lib/auth/__tests__/invitation-token.test.ts
git commit -m "feat(saas): invitation token generation + hashing"
```

---

## Task 3: Invitation logic (create / validate / accept)

**Files:**
- Create: `lib/auth/invitations.ts`
- Test: `lib/auth/__tests__/invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/auth/__tests__/invitations.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { InvitationRow } from '@/lib/db/invitation-queries'
import {
	type AcceptInvitationDeps,
	type CreateInvitationDeps,
	type ValidateInvitationDeps,
	EmailAlreadyRegisteredError,
	INVITATION_TTL_MS,
	InvalidInvitationError,
	acceptInvitation,
	createInvitation,
	validateInvitation,
} from '../invitations'

function row(over: Partial<InvitationRow> = {}): InvitationRow {
	return {
		id: 'inv1',
		email: 'kid@x.c',
		role: 'member',
		tokenHash: 'hash',
		expiresAt: 9_999_999_999_999,
		invitedByUserId: 'admin1',
		acceptedAt: null,
		createdAt: 1000,
		...over,
	}
}

function createDeps(over: Partial<CreateInvitationDeps> = {}): CreateInvitationDeps {
	return {
		getUserByEmail: vi.fn(() => undefined),
		deletePendingByEmail: vi.fn(),
		insertInvitation: vi.fn(),
		generateToken: vi.fn(() => ({ token: 'raw', tokenHash: 'hash' })),
		newId: vi.fn(() => 'inv1'),
		now: vi.fn(() => 1000),
		...over,
	}
}

describe('createInvitation', () => {
	it('rejects an email that already has an account', () => {
		const deps = createDeps({ getUserByEmail: vi.fn(() => ({ id: 'u1' })) })
		expect(() => createInvitation({ email: 'kid@x.c', role: 'member', invitedByUserId: 'a' }, deps)).toThrow(
			EmailAlreadyRegisteredError,
		)
		expect(deps.insertInvitation).not.toHaveBeenCalled()
	})

	it('upserts: deletes any pending invite, then inserts a fresh one', () => {
		const deps = createDeps()
		const { invitation, token } = createInvitation(
			{ email: 'kid@x.c', role: 'member', invitedByUserId: 'admin1' },
			deps,
		)
		expect(deps.deletePendingByEmail).toHaveBeenCalledWith('kid@x.c')
		expect(deps.insertInvitation).toHaveBeenCalledWith(invitation)
		expect(token).toBe('raw')
		expect(invitation).toMatchObject({
			id: 'inv1',
			email: 'kid@x.c',
			role: 'member',
			tokenHash: 'hash',
			invitedByUserId: 'admin1',
			acceptedAt: null,
			createdAt: 1000,
			expiresAt: 1000 + INVITATION_TTL_MS,
		})
	})
})

function validateDeps(over: Partial<ValidateInvitationDeps> = {}): ValidateInvitationDeps {
	return {
		getInvitationByTokenHash: vi.fn(() => row()),
		hashToken: vi.fn(() => 'hash'),
		now: vi.fn(() => 1000),
		...over,
	}
}

describe('validateInvitation', () => {
	it('returns the row for a valid token', () => {
		expect(validateInvitation('raw', validateDeps())).toMatchObject({ id: 'inv1' })
	})

	it('returns null for an empty token', () => {
		expect(validateInvitation('', validateDeps())).toBeNull()
	})

	it('returns null when no invite matches', () => {
		expect(validateInvitation('raw', validateDeps({ getInvitationByTokenHash: vi.fn(() => undefined) }))).toBeNull()
	})

	it('returns null when already accepted', () => {
		expect(
			validateInvitation('raw', validateDeps({ getInvitationByTokenHash: vi.fn(() => row({ acceptedAt: 500 })) })),
		).toBeNull()
	})

	it('returns null when expired', () => {
		expect(
			validateInvitation(
				'raw',
				validateDeps({ getInvitationByTokenHash: vi.fn(() => row({ expiresAt: 999 })), now: vi.fn(() => 1000) }),
			),
		).toBeNull()
	})
})

describe('acceptInvitation', () => {
	it('creates the user and stamps accepted_at', async () => {
		const createUser = vi.fn(async () => {})
		const markAccepted = vi.fn()
		const deps: AcceptInvitationDeps = {
			validate: vi.fn(() => row()),
			createUser,
			markAccepted,
			now: vi.fn(() => 2000),
		}
		const result = await acceptInvitation({ token: 'raw', password: 'secret12' }, deps)
		expect(result).toEqual({ email: 'kid@x.c' })
		expect(createUser).toHaveBeenCalledWith({ email: 'kid@x.c', password: 'secret12', role: 'member' })
		expect(markAccepted).toHaveBeenCalledWith('inv1', 2000)
	})

	it('throws InvalidInvitationError for a bad token and never creates a user', async () => {
		const createUser = vi.fn(async () => {})
		const deps: AcceptInvitationDeps = {
			validate: vi.fn(() => null),
			createUser,
			markAccepted: vi.fn(),
			now: vi.fn(() => 2000),
		}
		await expect(acceptInvitation({ token: 'bad', password: 'secret12' }, deps)).rejects.toBeInstanceOf(
			InvalidInvitationError,
		)
		expect(createUser).not.toHaveBeenCalled()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/invitations.test.ts`
Expected: FAIL — cannot find module `../invitations`.

- [ ] **Step 3: Implement**

Create `lib/auth/invitations.ts`:

```ts
import { auth } from '@/lib/auth/server'
import { generateInvitationToken, hashInvitationToken } from '@/lib/auth/invitation-token'
import {
	type InvitationRow,
	deletePendingByEmail,
	getInvitationByTokenHash,
	insertInvitation,
	markAccepted,
} from '@/lib/db/invitation-queries'
import { getUserByEmail } from '@/lib/db/user-queries'
import { randomUUID } from 'node:crypto'

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class EmailAlreadyRegisteredError extends Error {
	constructor() {
		super('Email already registered')
		this.name = 'EmailAlreadyRegisteredError'
	}
}

export class InvalidInvitationError extends Error {
	constructor() {
		super('Invalid or expired invitation')
		this.name = 'InvalidInvitationError'
	}
}

export type CreateInvitationDeps = {
	getUserByEmail: (email: string) => { id: string } | undefined
	deletePendingByEmail: (email: string) => void
	insertInvitation: (row: InvitationRow) => void
	generateToken: () => { token: string; tokenHash: string }
	newId: () => string
	now: () => number
}

const defaultCreateDeps: CreateInvitationDeps = {
	getUserByEmail,
	deletePendingByEmail,
	insertInvitation,
	generateToken: generateInvitationToken,
	newId: randomUUID,
	now: Date.now,
}

export function createInvitation(
	input: { email: string; role: string; invitedByUserId: string },
	deps: CreateInvitationDeps = defaultCreateDeps,
): { invitation: InvitationRow; token: string } {
	if (deps.getUserByEmail(input.email)) throw new EmailAlreadyRegisteredError()
	deps.deletePendingByEmail(input.email)
	const { token, tokenHash } = deps.generateToken()
	const nowMs = deps.now()
	const invitation: InvitationRow = {
		id: deps.newId(),
		email: input.email,
		role: input.role,
		tokenHash,
		expiresAt: nowMs + INVITATION_TTL_MS,
		invitedByUserId: input.invitedByUserId,
		acceptedAt: null,
		createdAt: nowMs,
	}
	deps.insertInvitation(invitation)
	return { invitation, token }
}

export type ValidateInvitationDeps = {
	getInvitationByTokenHash: (hash: string) => InvitationRow | undefined
	hashToken: (token: string) => string
	now: () => number
}

const defaultValidateDeps: ValidateInvitationDeps = {
	getInvitationByTokenHash,
	hashToken: hashInvitationToken,
	now: Date.now,
}

export function validateInvitation(
	token: string,
	deps: ValidateInvitationDeps = defaultValidateDeps,
): InvitationRow | null {
	if (!token) return null
	const invite = deps.getInvitationByTokenHash(deps.hashToken(token))
	if (!invite) return null
	if (invite.acceptedAt != null) return null
	if (invite.expiresAt <= deps.now()) return null
	return invite
}

export type AcceptInvitationDeps = {
	validate: (token: string) => InvitationRow | null
	createUser: (args: { email: string; password: string; role: string }) => Promise<void>
	markAccepted: (id: string, acceptedAt: number) => void
	now: () => number
}

const defaultAcceptDeps: AcceptInvitationDeps = {
	validate: (token) => validateInvitation(token),
	createUser: async ({ email, password, role }) => {
		// Headless createUser: called server-side without request headers, so the admin
		// plugin skips its UNAUTHORIZED guard (same path as scripts/create-user.ts). The
		// role cast matches that script — the SDK types role as 'user' | 'admin' but our
		// app stores 'admin' | 'member' verbatim.
		await auth.api.createUser({
			body: { email, password, name: email, role: role as 'user' | 'admin' },
		})
	},
	markAccepted,
	now: Date.now,
}

export async function acceptInvitation(
	input: { token: string; password: string },
	deps: AcceptInvitationDeps = defaultAcceptDeps,
): Promise<{ email: string }> {
	const invite = deps.validate(input.token)
	if (!invite) throw new InvalidInvitationError()
	await deps.createUser({ email: invite.email, password: input.password, role: invite.role })
	deps.markAccepted(invite.id, deps.now())
	return { email: invite.email }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/invitations.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Type-check + lint + commit**

```bash
pnpm --filter @recalbox/dashboard exec tsc --noEmit
node_modules/.bin/biome check lib/auth/invitations.ts lib/auth/__tests__/invitations.test.ts
git add apps/dashboard/lib/auth/invitations.ts apps/dashboard/lib/auth/__tests__/invitations.test.ts
git commit -m "feat(saas): invitation create/validate/accept logic"
```

---

## Task 4: API routes

**Files:**
- Create: `app/api/invitations/route.ts`
- Create: `app/api/invitations/[id]/route.ts`
- Create: `app/api/invitations/validate/route.ts`
- Create: `app/api/invitations/accept/route.ts`
- Test: `app/api/invitations/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/invitations/__tests__/routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-user', () => ({
	getUser: vi.fn(),
	unauthorized: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
	forbidden: () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
}))
vi.mock('@/lib/auth/invitations', async (orig) => ({
	...(await orig<typeof import('@/lib/auth/invitations')>()),
	createInvitation: vi.fn(() => ({ invitation: { expiresAt: 123 }, token: 'raw-token' })),
	acceptInvitation: vi.fn(),
	validateInvitation: vi.fn(),
}))
vi.mock('@/lib/db/invitation-queries', () => ({ listPendingInvitations: vi.fn(() => []) }))

import { getUser } from '@/lib/auth/require-user'
import { acceptInvitation, validateInvitation } from '@/lib/auth/invitations'
import { GET as listInvites, POST as createInvite } from '../route'
import { POST as acceptRoute } from '../accept/route'
import { GET as validateRoute } from '../validate/route'

const asMock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('POST /api/invitations', () => {
	it('401 when unauthenticated', async () => {
		asMock(getUser).mockResolvedValue(null)
		const res = await createInvite(new Request('http://x/api/invitations', { method: 'POST', body: '{}' }))
		expect(res.status).toBe(401)
	})

	it('403 when not admin', async () => {
		asMock(getUser).mockResolvedValue({ id: 'u1', email: 'm@x.c', role: 'member' })
		const res = await createInvite(
			new Request('http://x/api/invitations', { method: 'POST', body: JSON.stringify({ email: 'k@x.c' }) }),
		)
		expect(res.status).toBe(403)
	})

	it('returns a link for an admin', async () => {
		asMock(getUser).mockResolvedValue({ id: 'a1', email: 'a@x.c', role: 'admin' })
		const res = await createInvite(
			new Request('http://x/api/invitations', { method: 'POST', body: JSON.stringify({ email: 'k@x.c' }) }),
		)
		expect(res.status).toBe(200)
		const json = await res.json()
		expect(json.link).toContain('/accept-invite?token=raw-token')
		expect(json.email).toBe('k@x.c')
	})
})

describe('GET /api/invitations', () => {
	it('403 when not admin', async () => {
		asMock(getUser).mockResolvedValue({ id: 'u1', email: 'm@x.c', role: 'member' })
		const res = await listInvites()
		expect(res.status).toBe(403)
	})
})

describe('GET /api/invitations/validate', () => {
	it('reports invalid when token does not validate', async () => {
		asMock(validateInvitation).mockReturnValue(null)
		const res = await validateRoute(new Request('http://x/api/invitations/validate?token=bad'))
		expect(await res.json()).toEqual({ valid: false })
	})

	it('echoes the email for a valid token', async () => {
		asMock(validateInvitation).mockReturnValue({ email: 'k@x.c' })
		const res = await validateRoute(new Request('http://x/api/invitations/validate?token=ok'))
		expect(await res.json()).toEqual({ valid: true, email: 'k@x.c' })
	})
})

describe('POST /api/invitations/accept', () => {
	it('400 on a short password (no accept attempted)', async () => {
		const res = await acceptRoute(
			new Request('http://x/api/invitations/accept', {
				method: 'POST',
				body: JSON.stringify({ token: 'ok', password: 'short' }),
			}),
		)
		expect(res.status).toBe(400)
		expect(acceptInvitation).not.toHaveBeenCalled()
	})

	it('returns ok on success', async () => {
		asMock(acceptInvitation).mockResolvedValue({ email: 'k@x.c' })
		const res = await acceptRoute(
			new Request('http://x/api/invitations/accept', {
				method: 'POST',
				body: JSON.stringify({ token: 'ok', password: 'longenough' }),
			}),
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ ok: true, email: 'k@x.c' })
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run app/api/invitations/__tests__/routes.test.ts`
Expected: FAIL — cannot find the route modules.

- [ ] **Step 3: Implement the create/list route**

Create `app/api/invitations/route.ts`:

```ts
import { EmailAlreadyRegisteredError, createInvitation } from '@/lib/auth/invitations'
import { isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { listPendingInvitations } from '@/lib/db/invitation-queries'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
	email: z.string().email().max(254),
	role: z.enum(['member', 'admin']).optional(),
})

export async function GET() {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()
	return NextResponse.json({ invitations: listPendingInvitations() })
}

export async function POST(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()

	const body = await req.json().catch(() => null)
	const parsed = createSchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

	const email = parsed.data.email.trim().toLowerCase()
	const role = parsed.data.role ?? 'member'

	try {
		const { invitation, token } = createInvitation({ email, role, invitedByUserId: user.id })
		const base = (process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')
		const link = `${base}/accept-invite?token=${encodeURIComponent(token)}`
		return NextResponse.json({ link, email, expiresAt: invitation.expiresAt })
	} catch (err) {
		if (err instanceof EmailAlreadyRegisteredError) {
			return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
		}
		throw err
	}
}
```

- [ ] **Step 4: Implement the revoke route**

Create `app/api/invitations/[id]/route.ts`:

```ts
import { isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { deleteInvitationById } from '@/lib/db/invitation-queries'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()
	const { id } = await params
	deleteInvitationById(id)
	return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Implement the public validate route**

Create `app/api/invitations/validate/route.ts`:

```ts
import { validateInvitation } from '@/lib/auth/invitations'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
	const token = new URL(req.url).searchParams.get('token') ?? ''
	const invite = validateInvitation(token)
	if (!invite) return NextResponse.json({ valid: false })
	return NextResponse.json({ valid: true, email: invite.email })
}
```

- [ ] **Step 6: Implement the public accept route**

Create `app/api/invitations/accept/route.ts`:

```ts
import { InvalidInvitationError, acceptInvitation } from '@/lib/auth/invitations'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const acceptSchema = z.object({
	token: z.string().min(1),
	password: z.string().min(8).max(128),
})

export async function POST(req: NextRequest) {
	const body = await req.json().catch(() => null)
	const parsed = acceptSchema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 })
	}
	try {
		const { email } = await acceptInvitation(parsed.data)
		return NextResponse.json({ ok: true, email })
	} catch (err) {
		if (err instanceof InvalidInvitationError) {
			return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 })
		}
		throw err
	}
}
```

- [ ] **Step 7: Run tests + type-check + lint**

Run:
```bash
pnpm --filter @recalbox/dashboard exec vitest run app/api/invitations/__tests__/routes.test.ts
pnpm --filter @recalbox/dashboard exec tsc --noEmit
node_modules/.bin/biome check app/api/invitations
```
Expected: tests PASS (9 tests), no type/lint errors.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/app/api/invitations
git commit -m "feat(saas): invitation API routes (create/list/revoke/validate/accept)"
```

---

## Task 5: Middleware exemption + accept-invite page

**Files:**
- Modify: `proxy.ts`
- Create: `app/[locale]/accept-invite/page.tsx`

- [ ] **Step 1: Exempt `/accept-invite` from the login redirect**

In `proxy.ts`, replace the block starting at `const isLoginPage =` through the first redirect with:

```ts
	const isLoginPage = pathname === `/${locale}/login` || pathname.endsWith('/login')
	// Invited members reach the accept page without a session.
	const isAcceptInvite = pathname.endsWith('/accept-invite')
	const isPublicPage = isLoginPage || isAcceptInvite
	if (!hasSession && !isPublicPage) {
		return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
	}
	if (hasSession && isLoginPage) {
		return NextResponse.redirect(new URL(`/${locale}`, request.url))
	}
```

- [ ] **Step 2: Create the accept page**

Create `app/[locale]/accept-invite/page.tsx`:

```tsx
'use client'

import { createAuthClient } from 'better-auth/react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const authClient = createAuthClient()

type State =
	| { kind: 'loading' }
	| { kind: 'invalid' }
	| { kind: 'ready'; email: string }

export default function AcceptInvitePage() {
	const t = useTranslations('acceptInvite')
	const router = useRouter()
	const params = useSearchParams()
	const token = params.get('token') ?? ''

	const [state, setState] = useState<State>({ kind: 'loading' })
	const [password, setPassword] = useState('')
	const [confirm, setConfirm] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		let active = true
		fetch(`/api/invitations/validate?token=${encodeURIComponent(token)}`)
			.then((r) => r.json())
			.then((data: { valid: boolean; email?: string }) => {
				if (!active) return
				setState(data.valid && data.email ? { kind: 'ready', email: data.email } : { kind: 'invalid' })
			})
			.catch(() => active && setState({ kind: 'invalid' }))
		return () => {
			active = false
		}
	}, [token])

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError(null)
		if (password.length < 8) {
			setError(t('passwordTooShort'))
			return
		}
		if (password !== confirm) {
			setError(t('passwordMismatch'))
			return
		}
		setSubmitting(true)
		const res = await fetch('/api/invitations/accept', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, password }),
		})
		if (!res.ok) {
			setSubmitting(false)
			setError(t('invalid'))
			return
		}
		const { email } = (await res.json()) as { email: string }
		const signIn = await authClient.signIn.email({ email, password })
		setSubmitting(false)
		if (signIn.error) {
			setError(signIn.error.message ?? t('signInFailed'))
			return
		}
		router.replace('/')
		router.refresh()
	}

	if (state.kind === 'loading') {
		return (
			<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
				<p className="text-sm text-muted-foreground">{t('loading')}</p>
			</main>
		)
	}

	if (state.kind === 'invalid') {
		return (
			<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
				<h1 className="text-2xl font-semibold">{t('invalidTitle')}</h1>
				<p className="text-sm text-muted-foreground">{t('invalidBody')}</p>
			</main>
		)
	}

	return (
		<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
			<h1 className="text-2xl font-semibold">{t('title')}</h1>
			<p className="text-sm text-muted-foreground">{t('subtitle', { email: state.email })}</p>
			<form onSubmit={onSubmit} className="flex flex-col gap-3">
				<input type="email" value={state.email} readOnly className="rounded border bg-muted px-3 py-2" />
				<input
					type="password"
					required
					placeholder={t('passwordPlaceholder')}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className="rounded border px-3 py-2"
				/>
				<input
					type="password"
					required
					placeholder={t('confirmPlaceholder')}
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
					className="rounded border px-3 py-2"
				/>
				{error && <p className="text-sm text-red-500">{error}</p>}
				<button type="submit" disabled={submitting} className="rounded bg-black px-3 py-2 text-white">
					{submitting ? t('submitting') : t('submit')}
				</button>
			</form>
		</main>
	)
}
```

- [ ] **Step 3: Type-check + lint**

Run:
```bash
pnpm --filter @recalbox/dashboard exec tsc --noEmit
node_modules/.bin/biome check proxy.ts "app/[locale]/accept-invite/page.tsx"
```
Expected: no errors. (i18n keys are added in Task 6; `useTranslations` does not fail type-check for missing keys.)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/proxy.ts "apps/dashboard/app/[locale]/accept-invite/page.tsx"
git commit -m "feat(saas): public accept-invite page + middleware exemption"
```

---

## Task 6: Admin UI + i18n

**Files:**
- Create: `components/admin/invite-form.tsx`
- Create: `components/admin/pending-invitations.tsx`
- Modify: `app/[locale]/admin/page.tsx`
- Modify: `messages/en.json`, `messages/fr.json`

- [ ] **Step 1: Add i18n keys**

In `messages/en.json`, add a top-level `"invitations"` and `"acceptInvite"` object (place them alphabetically near other top-level keys; match the file's existing 1-tab indentation):

```json
	"invitations": {
		"heading": "Invitations",
		"emailPlaceholder": "family.member@example.com",
		"create": "Create invite link",
		"creating": "Creating…",
		"linkHeading": "Invite link (shown once — copy it now)",
		"copy": "Copy",
		"copied": "Copied!",
		"alreadyExists": "A user with this email already exists.",
		"createError": "Could not create the invitation.",
		"pendingHeading": "Pending invitations",
		"none": "No pending invitations.",
		"expires": "expires {date}",
		"revoke": "Revoke"
	},
	"acceptInvite": {
		"title": "Accept your invitation",
		"subtitle": "Set a password for {email}.",
		"passwordPlaceholder": "Password (min 8 characters)",
		"confirmPlaceholder": "Confirm password",
		"submit": "Create account",
		"submitting": "Creating account…",
		"loading": "Checking your invitation…",
		"invalidTitle": "Invitation not valid",
		"invalidBody": "This link is invalid or has expired. Ask the admin for a fresh invitation.",
		"invalid": "This invitation is invalid or has expired.",
		"passwordTooShort": "Password must be at least 8 characters.",
		"passwordMismatch": "Passwords do not match.",
		"signInFailed": "Account created, but sign-in failed. Try logging in."
	},
```

In `messages/fr.json`, add the same keys translated:

```json
	"invitations": {
		"heading": "Invitations",
		"emailPlaceholder": "membre.famille@example.com",
		"create": "Créer un lien d'invitation",
		"creating": "Création…",
		"linkHeading": "Lien d'invitation (affiché une seule fois — copiez-le maintenant)",
		"copy": "Copier",
		"copied": "Copié !",
		"alreadyExists": "Un utilisateur avec cet email existe déjà.",
		"createError": "Impossible de créer l'invitation.",
		"pendingHeading": "Invitations en attente",
		"none": "Aucune invitation en attente.",
		"expires": "expire le {date}",
		"revoke": "Révoquer"
	},
	"acceptInvite": {
		"title": "Acceptez votre invitation",
		"subtitle": "Définissez un mot de passe pour {email}.",
		"passwordPlaceholder": "Mot de passe (8 caractères min)",
		"confirmPlaceholder": "Confirmez le mot de passe",
		"submit": "Créer le compte",
		"submitting": "Création du compte…",
		"loading": "Vérification de votre invitation…",
		"invalidTitle": "Invitation non valide",
		"invalidBody": "Ce lien est invalide ou a expiré. Demandez une nouvelle invitation à l'administrateur.",
		"invalid": "Cette invitation est invalide ou a expiré.",
		"passwordTooShort": "Le mot de passe doit comporter au moins 8 caractères.",
		"passwordMismatch": "Les mots de passe ne correspondent pas.",
		"signInFailed": "Compte créé, mais la connexion a échoué. Essayez de vous connecter."
	},
```

Validate JSON:
```bash
node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/fr.json','utf8'));console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 2: Create the invite form**

Create `components/admin/invite-form.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function InviteForm({ onCreated }: { onCreated: () => void }) {
	const t = useTranslations('invitations')
	const [email, setEmail] = useState('')
	const [link, setLink] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setLoading(true)
		setError(null)
		setLink(null)
		setCopied(false)
		const res = await fetch('/api/invitations', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email }),
		})
		setLoading(false)
		if (res.status === 409) {
			setError(t('alreadyExists'))
			return
		}
		if (!res.ok) {
			setError(t('createError'))
			return
		}
		const data = (await res.json()) as { link: string }
		setLink(data.link)
		setEmail('')
		onCreated()
	}

	async function copy() {
		if (!link) return
		await navigator.clipboard.writeText(link)
		setCopied(true)
	}

	return (
		<div className="space-y-3">
			<form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
				<input
					type="email"
					required
					placeholder={t('emailPlaceholder')}
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					className="flex-1 rounded border px-3 py-2"
				/>
				<button type="submit" disabled={loading} className="rounded bg-black px-3 py-2 text-white">
					{loading ? t('creating') : t('create')}
				</button>
			</form>
			{error && <p className="text-sm text-red-500">{error}</p>}
			{link && (
				<div className="space-y-1 rounded border bg-muted p-3">
					<p className="text-xs text-muted-foreground">{t('linkHeading')}</p>
					<div className="flex items-center gap-2">
						<code className="flex-1 truncate text-xs">{link}</code>
						<button type="button" onClick={copy} className="rounded border px-2 py-1 text-xs">
							{copied ? t('copied') : t('copy')}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
```

- [ ] **Step 3: Create the pending list**

Create `components/admin/pending-invitations.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

type Pending = { id: string; email: string; role: string; expiresAt: number; createdAt: number }

export function PendingInvitations({ reloadKey }: { reloadKey: number }) {
	const t = useTranslations('invitations')
	const [items, setItems] = useState<Pending[]>([])

	const load = useCallback(() => {
		fetch('/api/invitations')
			.then((r) => (r.ok ? r.json() : { invitations: [] }))
			.then((data: { invitations: Pending[] }) => setItems(data.invitations ?? []))
			.catch(() => setItems([]))
	}, [])

	useEffect(() => {
		load()
	}, [load, reloadKey])

	async function revoke(id: string) {
		await fetch(`/api/invitations/${id}`, { method: 'DELETE' })
		load()
	}

	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('none')}</p>
	}

	return (
		<ul className="space-y-2">
			{items.map((inv) => (
				<li key={inv.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
					<span className="truncate">
						{inv.email}{' '}
						<span className="text-xs text-muted-foreground">
							({inv.role}, {t('expires', { date: new Date(inv.expiresAt).toLocaleDateString() })})
						</span>
					</span>
					<button type="button" onClick={() => revoke(inv.id)} className="rounded border px-2 py-1 text-xs">
						{t('revoke')}
					</button>
				</li>
			))}
		</ul>
	)
}
```

- [ ] **Step 4: Wire a client section into the admin page**

The admin page is a server component, so wrap the two client components in a small client section that shares the reload key. Create `components/admin/invitations-section.tsx`:

```tsx
'use client'

import { InviteForm } from '@/components/admin/invite-form'
import { PendingInvitations } from '@/components/admin/pending-invitations'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function InvitationsSection() {
	const t = useTranslations('invitations')
	const [reloadKey, setReloadKey] = useState(0)

	return (
		<section className="space-y-4 border rounded-lg p-4">
			<h2 className="font-medium">{t('heading')}</h2>
			<InviteForm onCreated={() => setReloadKey((k) => k + 1)} />
			<div className="space-y-2">
				<h3 className="text-xs font-normal text-muted-foreground">{t('pendingHeading')}</h3>
				<PendingInvitations reloadKey={reloadKey} />
			</div>
		</section>
	)
}
```

Then in `app/[locale]/admin/page.tsx`, add the import at the top:

```tsx
import { InvitationsSection } from '@/components/admin/invitations-section'
```

and render it right after the `<header>…</header>` block (before the `{cards.length === 0 …}` line):

```tsx
			<InvitationsSection />
```

- [ ] **Step 5: Type-check, lint, and run the full suite**

Run:
```bash
pnpm --filter @recalbox/dashboard exec tsc --noEmit
node_modules/.bin/biome check components/admin "app/[locale]/admin/page.tsx" messages/en.json messages/fr.json
pnpm --filter @recalbox/dashboard exec vitest run
```
Expected: no type/lint errors; entire suite green (previous 489 + the new invitation tests).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/components/admin "apps/dashboard/app/[locale]/admin/page.tsx" apps/dashboard/messages/en.json apps/dashboard/messages/fr.json
git commit -m "feat(saas): admin invitations UI + i18n"
```

---

## Final verification

After all tasks:

- [ ] `pnpm --filter @recalbox/dashboard exec tsc --noEmit` — clean.
- [ ] `node_modules/.bin/biome check .` (from `apps/dashboard/`) — clean on changed files.
- [ ] `pnpm --filter @recalbox/dashboard exec vitest run` — full suite green.
- [ ] Manual browser walkthrough (no Recalbox required), with `BETTER_AUTH_SECRET` set in `.env.local`:
  1. Log in as an admin (create one via `tsx scripts/create-user.ts you@x.c pass admin` if needed), open `/admin`.
  2. Create an invite for a new email → copy the link.
  3. Open the link in a private window → set a password → land on the dashboard signed in as the new member.
  4. Re-open the same link → "Invitation not valid" (single-use).
  5. Back in `/admin`, create another invite, then revoke it from the pending list.
- [ ] Confirm no token is ever logged (`grep -rn "token" lib/auth/invitations.ts` shows only the value being hashed/returned, never `logger`/`console`).

## Notes for the implementer

- **No Recalbox needed.** This phase is auth/DB/UI only; the device being offline does not block anything.
- **Branch stays un-merged** (`feat/saas-multi-user` stacks phases) — do not merge to main.
- **Stage only the exact paths named** in each commit. Never stage `.next/` artifacts or `apps/dashboard/recalbox.db*`.
- The generated migration filename in Task 1 is auto-assigned by drizzle-kit (e.g. `0019_*.sql`); commit it verbatim.
