# Ownership & Per-User Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope every Recalbox (and therefore all its data) to an owning user — members see/control only their own machines; an admin can *view* all machines but *control* only their own.

**Architecture:** Add a nullable `owner_user_id` column to `recalboxes`. Ownership decisions live in one new request-layer module `lib/auth/ownership.ts` (`getViewableRecalboxIds`, `canViewRecalbox`, `canControlRecalbox`). The process-global `configStore` and the scrobbler/SSH/MQTT pools stay un-scoped (they legitimately need every machine). `getActiveRecalboxId` becomes user-aware internally so its ~24 callers need no change. List endpoints/pages filter to viewable; control routes assert `canControlRecalbox`; the UI receives a `canControl` flag to hide action buttons.

**Tech Stack:** Next.js 16.2.6, Drizzle ORM 0.45 (sqlite), better-sqlite3 11, Better Auth (`role` on `user`), Vitest 2 (node env).

**Scope note:** Plan 2 of the SaaS PRD ([docs/prd/2026-06-08-saas-multi-user.md](../../prd/2026-06-08-saas-multi-user.md)), covering PRD §4, §5, §7 and the role-based read/write split from §6/§9. Builds on Plan 1 (auth foundation, already merged on this branch): `getUser()`/`AuthedUser` from `lib/auth/require-user.ts`, `role` column on `user`. Roles already exist; this plan applies them to data. After this plan: a member logging in sees only their Recalboxes and can control them; an admin sees everyone's (read-only on others).

---

## Key existing code (reuse, do not reinvent)

- `lib/auth/require-user.ts` — `getUser(): Promise<AuthedUser | null>`, `AuthedUser = { id, email, role }`, `unauthorized()`. The guard `if (!(await getUser())) return unauthorized()` is already on every API route.
- `lib/db/recalbox-queries.ts` — `listRecalboxes()`, `getRecalbox(id)`, `insertRecalbox(row)`, `updateRecalbox(id, patch)`, `RecalboxRow`/`RecalboxInsert` types (Drizzle `$inferSelect`/`$inferInsert`).
- `lib/config-store.ts` — process-global singleton. `getRecalboxes()`, `getRecalbox(id)`, `addRecalbox(config)`, `rowToInstance(row)`. `RecalboxInstance` type lives in `lib/settings/schemas.ts` (`recalboxInstanceSchema`).
- `lib/recalbox/active.ts` — `getActiveRecalboxId()` reads the `active_recalbox_id` cookie and validates it against `configStore.getRecalbox()`.
- Switcher UI: `components/recalbox-switcher.tsx` (receives a list as props). Recalbox list is assembled in `app/[locale]/layout.tsx`.

## File Structure

- Modify `lib/db/schema.ts` — add `owner_user_id` column + index to `recalboxes`.
- Create migration under `drizzle/migrations/` (drizzle-kit generated).
- Modify `lib/settings/schemas.ts` — add `ownerUserId` to `recalboxInstanceSchema`.
- Modify `lib/config-store.ts` — map/persist `ownerUserId` (`rowToInstance`, `addRecalbox`).
- Create `lib/auth/ownership.ts` — viewable/controllable decisions (the only ownership surface routes import).
- Create `lib/auth/__tests__/ownership.test.ts`.
- Modify `lib/recalbox/active.ts` — make `getActiveRecalboxId` user-aware.
- Modify `lib/recalbox/__tests__/active.test.ts` (create if absent).
- Modify list surfaces: `app/api/recalboxes/route.ts` (GET), `app/[locale]/layout.tsx`, `app/[locale]/recalboxes/page.tsx`, `app/[locale]/all-recalboxes/page.tsx`.
- Modify ownership-enforced routes: `app/api/recalboxes/[id]/route.ts`, `app/api/recalboxes/active/route.ts`, and the control routes (`system/power`, `collection/launch`, `play-tonight/launch`, `collection/sync`, `m3u/generate`, `media`, `game-media`, `system-logo`).
- Create `scripts/assign-recalbox-owner.ts` — backfill/claim ownership.

---

## Task 1: Add `owner_user_id` to the schema + migration

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts` (the `recalboxes` table, lines 4-18)
- Create: migration under `apps/dashboard/drizzle/migrations/`

- [ ] **Step 1: Add the column and index**

In `apps/dashboard/lib/db/schema.ts`, change the `recalboxes` table definition to add an `ownerUserId` column and an index. Replace:
```typescript
export const recalboxes = sqliteTable('recalboxes', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	host: text('host').notNull(),
	sshUser: text('ssh_user').notNull(),
	sshPassword: text('ssh_password').notNull(),
	sshPort: int('ssh_port').notNull().default(22),
	mqttPort: int('mqtt_port').notNull().default(1883),
	color: text('color'),
	iconEmoji: text('icon_emoji'),
	isDefault: int('is_default', { mode: 'boolean' }).default(false),
	archived: int('archived', { mode: 'boolean' }).default(false),
	createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
	lastConnectedAt: int('last_connected_at', { mode: 'timestamp' }),
})
```
with (note: add `index` is already imported on line 2; if `recalboxes` currently has no third callback arg, add one):
```typescript
export const recalboxes = sqliteTable(
	'recalboxes',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		host: text('host').notNull(),
		sshUser: text('ssh_user').notNull(),
		sshPassword: text('ssh_password').notNull(),
		sshPort: int('ssh_port').notNull().default(22),
		mqttPort: int('mqtt_port').notNull().default(1883),
		color: text('color'),
		iconEmoji: text('icon_emoji'),
		isDefault: int('is_default', { mode: 'boolean' }).default(false),
		archived: int('archived', { mode: 'boolean' }).default(false),
		createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
		lastConnectedAt: int('last_connected_at', { mode: 'timestamp' }),
		ownerUserId: text('owner_user_id'),
	},
	(t) => ({
		ownerIdx: index('idx_recalboxes_owner').on(t.ownerUserId),
	}),
)
```
The column is nullable: existing rows become "unowned" (admin-visible, claimable via Task 9). This is a plain column (logical FK to `user.id`); SQLite FK enforcement is off, matching the existing `recalbox_id` columns elsewhere.

- [ ] **Step 2: Generate the migration**

Run from `apps/dashboard/`:
```bash
pnpm drizzle-kit generate
```
Expected: a new `drizzle/migrations/00XX_*.sql` with `ALTER TABLE recalboxes ADD owner_user_id text;` and a `CREATE INDEX idx_recalboxes_owner`.

- [ ] **Step 3: Inspect the migration is non-destructive**

Read the generated `.sql`. Confirm it only `ALTER TABLE ... ADD COLUMN` and `CREATE INDEX` — no DROP/recreate of `recalboxes`. If drizzle tries to recreate the table (SQLite sometimes does for table changes), STOP and report — an additive column should be a plain ADD COLUMN.

- [ ] **Step 4: Apply the migration**

Run from `apps/dashboard/`:
```bash
pnpm drizzle-kit migrate
```
Verify the column exists:
```bash
node -e "const D=require('better-sqlite3'); const db=new D(process.env.DATABASE_PATH||'./recalbox.db'); console.log(db.prepare(\"PRAGMA table_info('recalboxes')\").all().map(c=>c.name))"
```
Expected: the array includes `owner_user_id`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/drizzle/migrations/
git commit -m "feat(saas): add owner_user_id column to recalboxes"
```

---

## Task 2: Surface `ownerUserId` through the row/instance types and config-store

**Files:**
- Modify: `apps/dashboard/lib/settings/schemas.ts` (`recalboxInstanceSchema`)
- Modify: `apps/dashboard/lib/config-store.ts` (`rowToInstance`, `addRecalbox`)

- [ ] **Step 1: Add `ownerUserId` to the instance schema**

In `apps/dashboard/lib/settings/schemas.ts`, find `recalboxInstanceSchema` (around line 96, `export type RecalboxInstance = z.infer<typeof recalboxInstanceSchema>`). Add an `ownerUserId` field to the object schema:
```typescript
	ownerUserId: z.string().nullable().default(null),
```
Place it alongside the other optional fields (`color`, `iconEmoji`). This makes `RecalboxInstance.ownerUserId: string | null`.

- [ ] **Step 2: Map it in `rowToInstance`**

In `apps/dashboard/lib/config-store.ts`, in `rowToInstance` (around line 82), add to the returned object:
```typescript
		ownerUserId: row.ownerUserId ?? null,
```
(`RecalboxRow` already includes `ownerUserId` from the schema change in Task 1 — `$inferSelect` picks it up automatically.)

- [ ] **Step 3: Let `addRecalbox` persist an owner**

In `apps/dashboard/lib/config-store.ts`, change `addRecalbox` to accept an optional owner. Update the signature and the inserted row:
```typescript
	addRecalbox(
		config: Omit<RecalboxInstance, 'id' | 'isDefault' | 'archived' | 'ownerUserId'>,
		ownerUserId: string | null = null,
	): RecalboxInstance {
		const all = listRecalboxes()
		const id = randomUUID()
		const row = {
			id,
			...config,
			isDefault: all.length === 0,
			archived: false,
			ownerUserId,
			createdAt: new Date(),
		}
		insertRecalbox(row)
		const instance = rowToInstance({
			...row,
			color: config.color ?? null,
			iconEmoji: config.iconEmoji ?? null,
			lastConnectedAt: null,
		})
		this.emit('recalbox:added', { recalbox: instance })
		if (instance.isDefault) {
			this.config = null
			this.emit('changed:recalbox', this.get())
		}
		return instance
	}
```

- [ ] **Step 4: Verify it type-checks**

Run from repo root:
```bash
pnpm --filter @recalbox/dashboard exec tsc --noEmit
```
Expected: no NEW errors in `config-store.ts` or `schemas.ts`. (`insertRecalbox` takes `RecalboxInsert` which now includes optional `ownerUserId`.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/settings/schemas.ts apps/dashboard/lib/config-store.ts
git commit -m "feat(saas): expose and persist ownerUserId on recalbox instances"
```

---

## Task 3: Ownership decision module (`lib/auth/ownership.ts`) — TDD

This is the single source of truth for "what can this user see / control". Pure logic over `listRecalboxes()`; testable by mocking the query.

**Files:**
- Create: `apps/dashboard/lib/auth/ownership.ts`
- Test: `apps/dashboard/lib/auth/__tests__/ownership.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/auth/__tests__/ownership.test.ts`:
```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'

const listRecalboxes = vi.fn()
vi.mock('@/lib/db/recalbox-queries', () => ({ listRecalboxes: () => listRecalboxes() }))

import { canControlRecalbox, canViewRecalbox, getViewableRecalboxIds } from '../ownership'

const admin = { id: 'admin1', email: 'a@b.c', role: 'admin' }
const member = { id: 'm1', email: 'm@b.c', role: 'member' }

afterEach(() => listRecalboxes.mockReset())

function rows() {
	return [
		{ id: 'rb-m1', ownerUserId: 'm1' },
		{ id: 'rb-m2', ownerUserId: 'm2' },
		{ id: 'rb-unowned', ownerUserId: null },
	]
}

describe('getViewableRecalboxIds', () => {
	it('returns all recalboxes for an admin', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(getViewableRecalboxIds(admin).sort()).toEqual(['rb-m1', 'rb-m2', 'rb-unowned'])
	})

	it('returns only owned recalboxes for a member', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(getViewableRecalboxIds(member)).toEqual(['rb-m1'])
	})
})

describe('canViewRecalbox', () => {
	it('admin can view any', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canViewRecalbox(admin, 'rb-m2')).toBe(true)
	})
	it('member cannot view others', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canViewRecalbox(member, 'rb-m2')).toBe(false)
	})
})

describe('canControlRecalbox', () => {
	it('owner can control own', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canControlRecalbox(member, 'rb-m1')).toBe(true)
	})
	it('admin canNOT control a machine they do not own', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canControlRecalbox(admin, 'rb-m2')).toBe(false)
	})
	it('nobody can control an unowned machine', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canControlRecalbox(admin, 'rb-unowned')).toBe(false)
		expect(canControlRecalbox(member, 'rb-unowned')).toBe(false)
	})
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run from repo root:
```bash
pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/ownership.test.ts
```
Expected: FAIL — cannot resolve `../ownership`.

- [ ] **Step 3: Write the implementation**

Create `apps/dashboard/lib/auth/ownership.ts`:
```typescript
import type { AuthedUser } from '@/lib/auth/require-user'
import { listRecalboxes } from '@/lib/db/recalbox-queries'

function isAdmin(user: AuthedUser): boolean {
	return user.role === 'admin'
}

/** Recalbox ids the user may READ. Admin sees all; members see only what they own. */
export function getViewableRecalboxIds(user: AuthedUser): string[] {
	const all = listRecalboxes()
	if (isAdmin(user)) return all.map((r) => r.id)
	return all.filter((r) => r.ownerUserId === user.id).map((r) => r.id)
}

/** Whether the user may READ a specific recalbox. */
export function canViewRecalbox(user: AuthedUser, recalboxId: string): boolean {
	if (isAdmin(user)) return true
	const row = listRecalboxes().find((r) => r.id === recalboxId)
	return row?.ownerUserId === user.id
}

/** Whether the user may CONTROL (write/launch/power) a recalbox. Owner only — admins are
 * read-only on machines they do not own, and nobody controls an unowned machine. */
export function canControlRecalbox(user: AuthedUser, recalboxId: string): boolean {
	const row = listRecalboxes().find((r) => r.id === recalboxId)
	return row != null && row.ownerUserId != null && row.ownerUserId === user.id
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run:
```bash
pnpm --filter @recalbox/dashboard exec vitest run lib/auth/__tests__/ownership.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/auth/ownership.ts apps/dashboard/lib/auth/__tests__/ownership.test.ts
git commit -m "feat(saas): add recalbox ownership helpers (view/control scopes)"
```

---

## Task 4: Make `getActiveRecalboxId` user-aware — TDD

By scoping resolution here, the ~24 callers that read the active recalbox get a viewable id (or `null`) with no change. The cookie is only honoured if it points to a viewable recalbox; otherwise we fall back to the user's first viewable one.

**Files:**
- Modify: `apps/dashboard/lib/recalbox/active.ts`
- Test: `apps/dashboard/lib/recalbox/__tests__/active.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/recalbox/__tests__/active.test.ts`:
```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'

const getCookie = vi.fn()
const getUser = vi.fn()
const getViewableRecalboxIds = vi.fn()

vi.mock('next/headers', () => ({
	cookies: vi.fn(async () => ({ get: (n: string) => getCookie(n) })),
}))
vi.mock('@/lib/auth/require-user', () => ({ getUser: () => getUser() }))
vi.mock('@/lib/auth/ownership', () => ({ getViewableRecalboxIds: (u: unknown) => getViewableRecalboxIds(u) }))

import { getActiveRecalboxId } from '../active'

const user = { id: 'm1', email: 'm@b.c', role: 'member' }

afterEach(() => {
	getCookie.mockReset()
	getUser.mockReset()
	getViewableRecalboxIds.mockReset()
})

describe('getActiveRecalboxId', () => {
	it('returns null when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		expect(await getActiveRecalboxId()).toBeNull()
	})

	it('honours the cookie when it points to a viewable recalbox', async () => {
		getUser.mockResolvedValue(user)
		getCookie.mockReturnValue({ value: 'rb-1' })
		getViewableRecalboxIds.mockReturnValue(['rb-1', 'rb-2'])
		expect(await getActiveRecalboxId()).toBe('rb-1')
	})

	it('falls back to the first viewable when the cookie is not viewable', async () => {
		getUser.mockResolvedValue(user)
		getCookie.mockReturnValue({ value: 'rb-other' })
		getViewableRecalboxIds.mockReturnValue(['rb-2', 'rb-3'])
		expect(await getActiveRecalboxId()).toBe('rb-2')
	})

	it('returns null when the user has no viewable recalboxes', async () => {
		getUser.mockResolvedValue(user)
		getCookie.mockReturnValue(undefined)
		getViewableRecalboxIds.mockReturnValue([])
		expect(await getActiveRecalboxId()).toBeNull()
	})
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
pnpm --filter @recalbox/dashboard exec vitest run lib/recalbox/__tests__/active.test.ts
```
Expected: FAIL (current `getActiveRecalboxId` ignores the user / uses configStore).

- [ ] **Step 3: Rewrite `getActiveRecalboxId`**

Replace the body of `getActiveRecalboxId` in `apps/dashboard/lib/recalbox/active.ts` (keep `setActiveRecalboxId` and the constants unchanged). New imports + function:
```typescript
import { getUser } from '@/lib/auth/require-user'
import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'active_recalbox_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export async function getActiveRecalboxId(): Promise<string | null> {
	const user = await getUser()
	if (!user) return null
	const viewable = getViewableRecalboxIds(user)
	if (viewable.length === 0) return null
	const jar = await cookies()
	const fromCookie = jar.get(COOKIE_NAME)?.value
	if (fromCookie && viewable.includes(fromCookie)) return fromCookie
	return viewable[0] ?? null
}
```
Remove the now-unused `configStore` import if it is no longer referenced in the file. Keep `setActiveRecalboxId` exactly as is.

- [ ] **Step 4: Run the test, verify it passes**

Run:
```bash
pnpm --filter @recalbox/dashboard exec vitest run lib/recalbox/__tests__/active.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/recalbox/active.ts apps/dashboard/lib/recalbox/__tests__/active.test.ts
git commit -m "feat(saas): scope active recalbox resolution to the current user"
```

---

## Task 5: Scope the recalbox LIST surfaces to viewable

The list of machines shown anywhere must be filtered to what the user may view. The scrobbler/MQTT/SSH paths are NOT touched (they need all machines).

**Files:**
- Modify: `apps/dashboard/app/api/recalboxes/route.ts` (GET)
- Modify: `apps/dashboard/app/[locale]/layout.tsx` (switcher list)
- Modify: `apps/dashboard/app/[locale]/recalboxes/page.tsx`
- Modify: `apps/dashboard/app/[locale]/all-recalboxes/page.tsx`
- Test: `apps/dashboard/app/api/recalboxes/__tests__/route.test.ts` (extend existing)

- [ ] **Step 1: Extend the GET test to assert filtering**

In `apps/dashboard/app/api/recalboxes/__tests__/route.test.ts`, add a mock for ownership and a filtering assertion. Add near the other `vi.mock` calls:
```typescript
vi.mock('@/lib/auth/ownership', () => ({
	getViewableRecalboxIds: () => ['rb-1'],
}))
```
Change the `@/lib/config-store` mock to return two recalboxes:
```typescript
vi.mock('@/lib/config-store', () => ({
	configStore: {
		getRecalboxes: () => [
			{ id: 'rb-1', name: 'A', sshPassword: 'x' },
			{ id: 'rb-2', name: 'B', sshPassword: 'y' },
		],
	},
}))
```
Add a test:
```typescript
	it('returns only viewable recalboxes', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		const res = await GET()
		const body = await res.json()
		expect(body.map((r: { id: string }) => r.id)).toEqual(['rb-1'])
	})
```

- [ ] **Step 2: Run the test, verify the new case fails**

Run:
```bash
pnpm --filter @recalbox/dashboard exec vitest run app/api/recalboxes/__tests__/route.test.ts
```
Expected: the new "only viewable" test FAILS (GET currently returns both).

- [ ] **Step 3: Filter the GET handler**

In `apps/dashboard/app/api/recalboxes/route.ts`, change `GET` to filter by viewable ids. Replace the handler body:
```typescript
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { configStore } from '@/lib/config-store'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const user = await getUser()
	if (!user) return unauthorized()
	const viewable = new Set(getViewableRecalboxIds(user))
	const all = configStore
		.getRecalboxes()
		.filter((rb) => viewable.has(rb.id))
		.map((rb) => ({ ...rb, sshPassword: '***' }))
	return NextResponse.json(all)
}
```
Keep `POST` as-is for now (ownership on create is Task 9).

- [ ] **Step 4: Run the test, verify it passes**

Run the same command. Expected: PASS (all recalboxes route tests, including 401/200/filtering).

- [ ] **Step 5: Filter the page-level lists**

In each of `app/[locale]/layout.tsx`, `app/[locale]/recalboxes/page.tsx`, `app/[locale]/all-recalboxes/page.tsx`: these are server components that currently call `configStore.getRecalboxes()`. After that call, filter to viewable. Pattern (apply in each file, adapting the variable name):
```typescript
import { getUser } from '@/lib/auth/require-user'
import { getViewableRecalboxIds } from '@/lib/auth/ownership'
// ...
const user = await getUser()
const viewable = user ? new Set(getViewableRecalboxIds(user)) : new Set<string>()
const recalboxes = configStore.getRecalboxes().filter((rb) => viewable.has(rb.id))
```
Use `recalboxes` wherever the full list was previously passed to the switcher / rendered. Do not change other logic on these pages.

- [ ] **Step 6: Type-check and commit**

Run from repo root:
```bash
pnpm --filter @recalbox/dashboard exec tsc --noEmit
```
Expected: no new errors in the touched files. Then:
```bash
git add apps/dashboard/app/api/recalboxes/route.ts apps/dashboard/app/[locale]/layout.tsx 'apps/dashboard/app/[locale]/recalboxes/page.tsx' 'apps/dashboard/app/[locale]/all-recalboxes/page.tsx' apps/dashboard/app/api/recalboxes/__tests__/route.test.ts
git commit -m "feat(saas): scope recalbox lists to viewable machines"
```

---

## Task 6: Enforce view/control on the recalbox detail & active routes

**Files:**
- Modify: `apps/dashboard/app/api/recalboxes/[id]/route.ts` (GET view; PUT/DELETE control)
- Modify: `apps/dashboard/app/api/recalboxes/active/route.ts` (PUT must target a viewable recalbox)
- Test: `apps/dashboard/app/api/recalboxes/[id]/__tests__/route.test.ts` (create)

- [ ] **Step 1: Write the failing test for `[id]` enforcement**

Create `apps/dashboard/app/api/recalboxes/[id]/__tests__/route.test.ts`:
```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canViewRecalbox: (...a: unknown[]) => canView(...a),
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: {
		getRecalbox: () => ({ id: 'rb-1', name: 'A', sshPassword: 'x' }),
		getRecalboxes: () => [{ id: 'rb-1', archived: false }],
		updateRecalboxConfig: vi.fn(),
		removeRecalbox: vi.fn(),
	},
}))

import { DELETE, GET } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }
afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
	canControl.mockReset()
})

describe('GET /api/recalboxes/[id]', () => {
	it('404s when the user cannot view it', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canView.mockReturnValue(false)
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(404)
	})
})

describe('DELETE /api/recalboxes/[id]', () => {
	it('403s when the user cannot control it', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canControl.mockReturnValue(false)
		const res = await DELETE({} as never, ctx as never)
		expect(res.status).toBe(403)
	})
})
```

- [ ] **Step 2: Run it, verify failure**

```bash
pnpm --filter @recalbox/dashboard exec vitest run app/api/recalboxes/[id]/__tests__/route.test.ts
```
Expected: FAIL (no view/control checks yet).

- [ ] **Step 3: Add a `forbidden()` helper**

In `apps/dashboard/lib/auth/require-user.ts`, add next to `unauthorized()`:
```typescript
export function forbidden(): NextResponse {
	return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

- [ ] **Step 4: Enforce in `[id]/route.ts`**

In `apps/dashboard/app/api/recalboxes/[id]/route.ts`:
- Add imports: `import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'` and add `forbidden` to the `require-user` import.
- In `GET`, after resolving `const { id } = await params` and confirming the user, return 404 when not viewable (treat invisible as not-found, do not leak existence):
```typescript
	if (!canViewRecalbox(user, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
```
  (Capture the user: change `if (!(await getUser())) return unauthorized()` to `const user = await getUser(); if (!user) return unauthorized()`.)
- In `PUT` and `DELETE`, after capturing the user, require control:
```typescript
	if (!canControlRecalbox(user, id)) return forbidden()
```
  Place these checks before the existing not-found / mutation logic.

- [ ] **Step 5: Enforce in `active/route.ts`**

In `apps/dashboard/app/api/recalboxes/active/route.ts`, the PUT sets the active cookie. A user must not activate a machine they cannot view. After parsing `parsed.data.id` and capturing the user, replace the existence check with a viewable check:
```typescript
import { canViewRecalbox } from '@/lib/auth/ownership'
// ...
	const user = await getUser()
	if (!user) return unauthorized()
	// ...after parsing id...
	if (!canViewRecalbox(user, parsed.data.id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })
```

- [ ] **Step 6: Run tests, verify pass**

```bash
pnpm --filter @recalbox/dashboard exec vitest run app/api/recalboxes/[id]/__tests__/route.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/lib/auth/require-user.ts apps/dashboard/app/api/recalboxes
git commit -m "feat(saas): enforce view/control on recalbox detail and active routes"
```

---

## Task 7: Enforce `canControlRecalbox` on action routes

Control routes act on the *active* recalbox (resolved via `getActiveRecalboxId`, now user-scoped, so it is always viewable — but viewable ≠ controllable for admins). Each must additionally assert control on the resolved id.

**Control routes to update:** `system/power`, `collection/launch`, `play-tonight/launch`, `collection/sync`, `m3u/generate`, `media`, `game-media`, `system-logo`. (Pure-read routes like `system-stats`, `monitoring`, `collection` GET, `collection/health` keep only the existing auth guard — `getActiveRecalboxId` already scopes them to a viewable machine.)

**Files:**
- Modify: each control route listed above
- Test: `apps/dashboard/app/api/system/power/__tests__/route.test.ts` (create, worked example)

- [ ] **Step 1: Write the failing test for `system/power`**

First open `apps/dashboard/app/api/system/power/route.ts` to see its exported handler(s) and how it resolves the recalbox id (via `getActiveRecalboxId`). Create `apps/dashboard/app/api/system/power/__tests__/route.test.ts` mirroring its actual handler signature:
```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const canControl = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/recalbox/active', () => ({ getActiveRecalboxId: () => getActiveRecalboxId() }))
vi.mock('@/lib/auth/ownership', () => ({ canControlRecalbox: (...a: unknown[]) => canControl(...a) }))

import { POST } from '../route'

afterEach(() => {
	getUser.mockReset()
	getActiveRecalboxId.mockReset()
	canControl.mockReset()
})

describe('POST /api/system/power', () => {
	it('403s when the user does not own the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'admin' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const req = new Request('http://x/api/system/power', {
			method: 'POST',
			body: JSON.stringify({ action: 'reboot' }),
			headers: { 'content-type': 'application/json' },
		})
		const res = await POST(req as never)
		expect(res.status).toBe(403)
	})
})
```
Note: if `power/route.ts` validates the body before anything else, adjust the test body to a valid payload so the request reaches the control check. The point is: a valid request to control a non-owned active machine returns 403.

- [ ] **Step 2: Run it, verify failure**

```bash
pnpm --filter @recalbox/dashboard exec vitest run app/api/system/power/__tests__/route.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Add the control check to `system/power`**

In `apps/dashboard/app/api/system/power/route.ts`: capture the user (`const user = await getUser(); if (!user) return unauthorized()`), and after resolving the active id (`const id = await getActiveRecalboxId()`), add:
```typescript
import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
// ...
	if (!id) return NextResponse.json({ error: 'No active Recalbox' }, { status: 400 })
	if (!canControlRecalbox(user, id)) return forbidden()
```
(Adapt to the existing variable name for the active id; if the route already early-returns on missing id, just add the `canControlRecalbox` line right after.)

- [ ] **Step 4: Run it, verify pass**

```bash
pnpm --filter @recalbox/dashboard exec vitest run app/api/system/power/__tests__/route.test.ts
```
Expected: PASS.

- [ ] **Step 5: Apply the same pattern to the remaining control routes**

For each of `collection/launch`, `play-tonight/launch`, `collection/sync`, `m3u/generate`, `media`, `game-media`, `system-logo`: capture the user, resolve the target recalbox id the route already uses (active id, or the `recalboxId`/`path` it operates on), and add `if (!canControlRecalbox(user, id)) return forbidden()` immediately after the id is known and validated as present. Do not change the route's other logic. For `media`/`game-media` (which take a `path` and resolve a recalbox via the active id), use the active id for the control check.

- [ ] **Step 6: Full dashboard test suite + lint**

```bash
pnpm --filter @recalbox/dashboard exec vitest run
pnpm lint
```
Expected: all tests pass; fix any Biome issues you introduced.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/app/api
git commit -m "feat(saas): require ownership to control a recalbox (power/launch/sync/media)"
```

---

## Task 8: Pass a `canControl` flag to the UI and hide action buttons

So a viewing-only admin doesn't see buttons that would 403.

**Files:**
- Modify: `apps/dashboard/app/[locale]/layout.tsx` (compute flag for active recalbox)
- Modify: the components rendering control actions (e.g. `components/now-playing.tsx`, the power/launch controls, the recalbox management page) — gate the action UI on the flag.

- [ ] **Step 1: Compute `canControl` for the active recalbox in the layout**

In `apps/dashboard/app/[locale]/layout.tsx`, after resolving the user and active recalbox id, compute:
```typescript
import { canControlRecalbox } from '@/lib/auth/ownership'
// ...
const activeId = await getActiveRecalboxId()
const canControl = user && activeId ? canControlRecalbox(user, activeId) : false
```
Pass `canControl` down to whatever provider/component tree renders machine actions (follow the existing prop/context pattern in the layout — if there is a context provider wrapping children, add `canControl` to it; otherwise pass as a prop to the relevant component).

- [ ] **Step 2: Gate the action controls**

In each component that renders a control affordance (power off/reboot, launch game, sync collection, edit/delete recalbox), accept the `canControl` boolean and render the action `null`/disabled when it is false. Example shape:
```tsx
{canControl && <PowerButton ... />}
```
Identify these components by searching for the control API calls:
```bash
grep -rln "api/system/power\|collection/launch\|play-tonight/launch\|collection/sync" apps/dashboard/components apps/dashboard/app | grep -v __tests__
```
Gate each found control. Read-only displays (stats, now-playing info text) stay visible.

- [ ] **Step 3: Manual verification (deferred to end-to-end), type-check now**

```bash
pnpm --filter @recalbox/dashboard exec tsc --noEmit
pnpm lint
```
Expected: no new type/lint errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/[locale]/layout.tsx apps/dashboard/components
git commit -m "feat(saas): hide control actions when the user cannot control the active recalbox"
```

---

## Task 9: Ownership on create + backfill/claim script

**Files:**
- Modify: `apps/dashboard/app/api/recalboxes/route.ts` (POST sets owner to the creator)
- Create: `apps/dashboard/scripts/assign-recalbox-owner.ts`

- [ ] **Step 1: Set owner on create**

In `apps/dashboard/app/api/recalboxes/route.ts`, in `POST`, capture the user and pass the id to `addRecalbox`. Change:
```typescript
	const rb = configStore.addRecalbox({
		...parsed.data,
		color: parsed.data.color ?? null,
		iconEmoji: parsed.data.iconEmoji ?? null,
	})
```
to:
```typescript
	const user = await getUser()
	if (!user) return unauthorized()
	const rb = configStore.addRecalbox(
		{
			...parsed.data,
			color: parsed.data.color ?? null,
			iconEmoji: parsed.data.iconEmoji ?? null,
		},
		user.id,
	)
```
(The `if (!(await getUser()))` guard at the top of POST can be replaced by this captured-user version; don't call `getUser()` twice.)

- [ ] **Step 2: Create the claim script**

Create `apps/dashboard/scripts/assign-recalbox-owner.ts`:
```typescript
import { db } from '@/lib/db'
import { recalboxes } from '@/lib/db/schema'
import { user as userTable } from '@/lib/auth/auth-schema'
import { eq, isNull } from 'drizzle-orm'

async function main() {
	const [email, recalboxId] = process.argv.slice(2)
	if (!email) {
		console.error('Usage: tsx scripts/assign-recalbox-owner.ts <email> [recalboxId]')
		console.error('Without a recalboxId, assigns ALL currently-unowned recalboxes to the user.')
		process.exit(1)
	}
	const owner = db.select().from(userTable).where(eq(userTable.email, email)).get()
	if (!owner) {
		console.error(`No user found with email ${email}`)
		process.exit(1)
	}
	if (recalboxId) {
		db.update(recalboxes).set({ ownerUserId: owner.id }).where(eq(recalboxes.id, recalboxId)).run()
		console.log(`Assigned recalbox ${recalboxId} to ${email}`)
	} else {
		const res = db
			.update(recalboxes)
			.set({ ownerUserId: owner.id })
			.where(isNull(recalboxes.ownerUserId))
			.run()
		console.log(`Assigned ${res.changes} unowned recalbox(es) to ${email}`)
	}
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
```

- [ ] **Step 3: Verify the script end-to-end on the dev DB**

Requires a user to exist. From `apps/dashboard/`:
```bash
pnpm exec tsx scripts/create-user.ts owner-test@example.com 'owner-pass-123' admin
pnpm exec tsx scripts/assign-recalbox-owner.ts owner-test@example.com
node -e "const D=require('better-sqlite3'); const db=new D('./recalbox.db'); console.log(db.prepare('SELECT id, owner_user_id FROM recalboxes').all())"
```
Expected: previously-unowned recalboxes now show the test user's id in `owner_user_id`. Then clean up (reset owners to NULL and delete the test user) so the dev DB is left as found:
```bash
node -e "const D=require('better-sqlite3'); const db=new D('./recalbox.db'); const u=db.prepare('SELECT id FROM user WHERE email=?').get('owner-test@example.com'); if(u){db.prepare('UPDATE recalboxes SET owner_user_id=NULL WHERE owner_user_id=?').run(u.id); db.prepare('DELETE FROM session WHERE user_id=?').run(u.id); db.prepare('DELETE FROM account WHERE user_id=?').run(u.id); db.prepare('DELETE FROM user WHERE id=?').run(u.id);} console.log('cleaned')"
```

- [ ] **Step 4: Lint and commit**

```bash
pnpm lint
git add apps/dashboard/app/api/recalboxes/route.ts apps/dashboard/scripts/assign-recalbox-owner.ts
git commit -m "feat(saas): set recalbox owner on create + add ownership backfill script"
```

---

## End-to-end verification

Run a two-user scenario against a running dev server (`pnpm dev`), creating then deleting the test data:

1. **Setup:** create an admin and a member; create/claim one recalbox owned by the member.
```bash
cd apps/dashboard
pnpm exec tsx scripts/create-user.ts e2e-admin@example.com 'pw-admin-123' admin
pnpm exec tsx scripts/create-user.ts e2e-member@example.com 'pw-member-123' member
pnpm exec tsx scripts/assign-recalbox-owner.ts e2e-member@example.com <some-recalbox-id>
```
2. **Member sees only their machine:** sign in as the member (cookie jar), `GET /api/recalboxes` → returns only the claimed recalbox.
3. **Admin sees all:** sign in as admin, `GET /api/recalboxes` → returns every recalbox.
4. **Admin cannot control member's machine:** as admin, set active to the member's recalbox (`PUT /api/recalboxes/active`), then `POST /api/system/power` (valid body) → **403**.
5. **Member can control own machine:** as member, `POST /api/system/power` against their own active recalbox → not 403 (200/expected app response).
6. **Member cannot view others:** as member, `GET /api/recalboxes/<admin-owned-id>` → **404**.
7. **Unit tests:** `pnpm --filter @recalbox/dashboard exec vitest run` → all pass.
8. **Cleanup:** delete the two e2e users and reset any owners set during the test (as in Task 9 Step 3), leaving the dev DB as found.

---

## Self-review notes

- **Spec coverage:** Implements PRD §4 (`owner_user_id`, transitive scoping, user-aware `getActiveRecalboxId`, viewable list, switcher shows only viewable), §5 (read filter `getViewableRecalboxIds`; control `canControlRecalbox` on power/launch/sync/media/recalbox-edit; `canControl` UI flag), §7 (single SQLite, no driver change), §6/§9 role split (admin reads all, controls only own). Data tables (`sessions`, `games`, etc.) need no change — they are reached only through a now-scoped active recalbox id.
- **Type consistency:** `AuthedUser` (from Plan 1) is the input to all ownership functions. `getViewableRecalboxIds(user) → string[]`, `canViewRecalbox(user, id) → boolean`, `canControlRecalbox(user, id) → boolean` are used identically across Tasks 4-9. `RecalboxInstance.ownerUserId: string \| null` and `RecalboxRow.ownerUserId` (auto via `$inferSelect`) align. `forbidden()` added in Task 6 is reused in Task 7.
- **Deferred to later plans:** SSH credential encryption (Plan 3/Phase 4), admin read-only aggregate view across users (Phase 3), connectivity/deploy (Phases 5-6). N-to-N sharing remains out of scope (PRD §3).
- **Assumption made explicit:** existing recalboxes are "unowned" (`owner_user_id IS NULL`) until claimed via `assign-recalbox-owner.ts`. While unowned: admins can view them (admin-sees-all), members cannot, and nobody can control them. The admin runs the claim script once after deploying this plan.
