# Admin Read-Only Aggregate View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `admin` role a read-only `/admin` page that lists every user with their aggregated playtime stats, top games, and registered machines — reusing the existing stats calculators without the ownership filter.

**Architecture:** A new server component page at `app/[locale]/admin/page.tsx`, gated to admins (non-admins are redirected home). Data comes from a new `getAdminOverview()` orchestrator in `lib/db/admin-queries.ts` that groups recalboxes by `owner_user_id`, then calls the existing `getSessionStats()` per user. `getSessionStats()` gains a `recalboxIds: string[]` filter so it can aggregate over the *set* of machines a user owns. The sidebar gets an admin-only nav link, driven by a `showAdmin` prop computed in the layout. This is Phase 3 of the SaaS multi-user work (Phases 1 & 2 done): it adds **only read** surface — no control paths change.

**Tech Stack:** Next.js 16 App Router (server components), Drizzle ORM (better-sqlite3), Better Auth `admin` plugin (`role` column), Vitest, next-intl, Biome (tabs, single quotes, no semicolons).

---

## File Structure

- **Modify** `apps/dashboard/lib/db/queries.ts` — add `recalboxIds?: string[]` filter to `getSessionStats` (IN clause; empty array → zeros).
- **Create** `apps/dashboard/lib/db/user-queries.ts` — `listUsers()` returning `{ id, email, role }[]`.
- **Create** `apps/dashboard/lib/db/admin-queries.ts` — `getAdminOverview()` orchestrator + types, dependency-injectable for testing.
- **Modify** `apps/dashboard/lib/auth/ownership.ts` — export the existing `isAdmin` helper.
- **Create** `apps/dashboard/app/[locale]/admin/page.tsx` — admin-only server component rendering the overview.
- **Modify** `apps/dashboard/components/app-sidebar.tsx` — accept `showAdmin?: boolean`, conditionally append an Admin nav item.
- **Modify** `apps/dashboard/app/[locale]/layout.tsx` — compute `isAdmin(user)` and pass `showAdmin` to `<AppSidebar />`.
- **Modify** `apps/dashboard/messages/en.json` + `fr.json` — `nav.admin` + an `admin.*` section.
- **Create** `apps/dashboard/lib/db/__tests__/session-stats-recalbox-ids.test.ts` — covers the new IN filter against an in-memory DB.
- **Create** `apps/dashboard/lib/db/__tests__/admin-queries.test.ts` — covers grouping/aggregation with mocked deps.

> **Test command (exact):** `pnpm --filter @recalbox/dashboard exec vitest run <path>` — the `exec` is required.
> **Lint/format:** `pnpm --filter @recalbox/dashboard exec biome check --write <path>` before committing.

---

### Task 1: Add `recalboxIds` set filter to `getSessionStats`

**Files:**
- Modify: `apps/dashboard/lib/db/queries.ts` (import line 6; `getSessionStats` at 428-437)
- Test: `apps/dashboard/lib/db/__tests__/session-stats-recalbox-ids.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/db/__tests__/session-stats-recalbox-ids.test.ts`. It mocks the DB singleton with an in-memory SQLite seeded with sessions across three recalboxes, then asserts the new `recalboxIds` filter sums only the requested machines.

```ts
import { describe, expect, it, vi } from 'vitest'

// Build an in-memory DB and seed it BEFORE the queries module imports the singleton.
const { db } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recalbox_id TEXT,
			game_id INTEGER,
			started_at INTEGER NOT NULL,
			ended_at INTEGER,
			duration_seconds INTEGER,
			system TEXT NOT NULL,
			rom_path TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'scrobbler'
		);
		CREATE TABLE games (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recalbox_id TEXT,
			rom_path TEXT,
			name TEXT,
			region TEXT,
			sr_has_page INTEGER,
			sr_url TEXT
		);
	`)
	const now = Math.floor(Date.now() / 1000)
	const ins = sqlite.prepare(
		`INSERT INTO sessions (recalbox_id, started_at, ended_at, duration_seconds, system, rom_path, source)
		 VALUES (?, ?, ?, ?, ?, ?, 'scrobbler')`,
	)
	ins.run('rb-a', now, now + 60, 60, 'snes', '/rom/a.zip')
	ins.run('rb-b', now, now + 120, 120, 'nes', '/rom/b.zip')
	ins.run('rb-c', now, now + 999, 999, 'gba', '/rom/c.zip')
	return { db: drizzle(sqlite) }
})

vi.mock('@/lib/db/index', () => ({ db }))

import { getSessionStats } from '@/lib/db/queries'

describe('getSessionStats recalboxIds filter', () => {
	it('sums only the requested recalbox set', async () => {
		const stats = await getSessionStats({ recalboxIds: ['rb-a', 'rb-b'] })
		expect(stats.totalPlaytimeSec).toBe(180)
		expect(stats.totalSessions).toBe(2)
	})

	it('returns zeros for an empty set (no machines owned)', async () => {
		const stats = await getSessionStats({ recalboxIds: [] })
		expect(stats.totalPlaytimeSec).toBe(0)
		expect(stats.totalSessions).toBe(0)
		expect(stats.topGames).toEqual([])
	})

	it('still aggregates everything when no filter is given', async () => {
		const stats = await getSessionStats({})
		expect(stats.totalPlaytimeSec).toBe(60 + 120 + 999)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/db/__tests__/session-stats-recalbox-ids.test.ts`
Expected: FAIL — the empty-set case returns 1179 instead of 0 (filter not yet implemented).

- [ ] **Step 3: Implement the filter**

In `apps/dashboard/lib/db/queries.ts`, add `inArray` to the drizzle import on line 6:

```ts
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, like, lte, max, sql } from 'drizzle-orm'
```

Extend the `getSessionStats` opts type and the condition builder. The opts object (currently lines 429-435) becomes:

```ts
export async function getSessionStats(
	opts: {
		recalboxId?: string
		recalboxIds?: string[]
		fromDate?: Date
		toDate?: Date
		topGamesLimit?: number
	} = {},
): Promise<SessionStats> {
	const { recalboxId, recalboxIds, fromDate, toDate, topGamesLimit = 10 } = opts
```

Then, immediately after the existing `if (recalboxId) baseConditions.push(...)` line, add:

```ts
	if (recalboxIds) {
		baseConditions.push(
			recalboxIds.length > 0 ? inArray(sessions.recalboxId, recalboxIds) : sql`1 = 0`,
		)
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/db/__tests__/session-stats-recalbox-ids.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write lib/db/queries.ts lib/db/__tests__/session-stats-recalbox-ids.test.ts
git add apps/dashboard/lib/db/queries.ts apps/dashboard/lib/db/__tests__/session-stats-recalbox-ids.test.ts
git commit -m "feat(saas): support recalboxIds set filter in getSessionStats"
```

---

### Task 2: `listUsers()` query

**Files:**
- Create: `apps/dashboard/lib/db/user-queries.ts`

> No dedicated unit test — this is a thin `select` over the Better Auth `user` table (same pattern as the un-unit-tested `lib/db/recalbox-queries.ts`). It is exercised by Task 3's tests via mocking and by the runtime check at the end.

- [ ] **Step 1: Create the file**

```ts
import { user as userTable } from '@/lib/auth/auth-schema'
import { db } from '@/lib/db/index'
import { asc } from 'drizzle-orm'

export type AppUser = { id: string; email: string; role: string }

/** All registered users, ordered by email. Role defaults to 'member' when unset. */
export function listUsers(): AppUser[] {
	try {
		const rows = db
			.select({ id: userTable.id, email: userTable.email, role: userTable.role })
			.from(userTable)
			.orderBy(asc(userTable.email))
			.all()
		return rows.map((r) => ({ id: r.id, email: r.email, role: r.role ?? 'member' }))
	} catch {
		return []
	}
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Format, commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write lib/db/user-queries.ts
git add apps/dashboard/lib/db/user-queries.ts
git commit -m "feat(saas): add listUsers query for admin overview"
```

---

### Task 3: `getAdminOverview()` orchestrator

**Files:**
- Create: `apps/dashboard/lib/db/admin-queries.ts`
- Test: `apps/dashboard/lib/db/__tests__/admin-queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/lib/db/__tests__/admin-queries.test.ts`. It injects fake `listUsers`, `listRecalboxes`, and `getStats` so the grouping/aggregation logic is tested in isolation (same style as `lib/auth/__tests__/ownership.test.ts`).

```ts
import { describe, expect, it, vi } from 'vitest'
import { getAdminOverview } from '../admin-queries'
import type { SessionStats } from '../queries'

function zeroStats(): SessionStats {
	return {
		totalPlaytimeSec: 0,
		totalSessions: 0,
		uniqueGames: 0,
		avgSessionSec: 0,
		byDay: [],
		bySystem: [],
		topGames: [],
	}
}

function statsWith(sec: number): SessionStats {
	return { ...zeroStats(), totalPlaytimeSec: sec, totalSessions: 1 }
}

const users = [
	{ id: 'u1', email: 'a@x.c', role: 'admin' },
	{ id: 'u2', email: 'b@x.c', role: 'member' },
	{ id: 'u3', email: 'c@x.c', role: 'member' },
]

const recalboxes = [
	{ id: 'rb1', name: 'Pi5', iconEmoji: '🎮', archived: false, ownerUserId: 'u1' },
	{ id: 'rb2', name: 'Pi4', iconEmoji: null, archived: false, ownerUserId: 'u2' },
	{ id: 'rb3', name: 'Pi3', iconEmoji: null, archived: true, ownerUserId: 'u2' },
	{ id: 'rb4', name: 'Spare', iconEmoji: null, archived: false, ownerUserId: null },
]

function makeDeps() {
	const getStats = vi.fn(async (ids: string[]) => statsWith(ids.length * 100))
	return {
		listUsers: () => users,
		// biome-ignore lint/suspicious/noExplicitAny: test fixture row shape
		listRecalboxes: () => recalboxes as any,
		getStats,
	}
}

describe('getAdminOverview', () => {
	it('returns one entry per user with their machines', async () => {
		const overview = await getAdminOverview(makeDeps())
		expect(overview.users.map((u) => u.user.id)).toEqual(['u1', 'u2', 'u3'])
		const u2 = overview.users.find((u) => u.user.id === 'u2')!
		expect(u2.machines.map((m) => m.id)).toEqual(['rb2', 'rb3'])
	})

	it('aggregates stats over the user-owned set', async () => {
		const overview = await getAdminOverview(makeDeps())
		const u2 = overview.users.find((u) => u.user.id === 'u2')!
		expect(u2.stats.totalPlaytimeSec).toBe(200) // 2 machines * 100
	})

	it('gives a user with no machines an empty stat block', async () => {
		const overview = await getAdminOverview(makeDeps())
		const u3 = overview.users.find((u) => u.user.id === 'u3')!
		expect(u3.machines).toEqual([])
		expect(u3.stats.totalPlaytimeSec).toBe(0)
	})

	it('groups unowned machines into the unassigned bucket', async () => {
		const overview = await getAdminOverview(makeDeps())
		expect(overview.unassigned).not.toBeNull()
		expect(overview.unassigned!.machines.map((m) => m.id)).toEqual(['rb4'])
		expect(overview.unassigned!.stats.totalPlaytimeSec).toBe(100)
	})

	it('returns null unassigned when every machine is owned', async () => {
		const deps = makeDeps()
		deps.listRecalboxes = () => [recalboxes[0], recalboxes[1]] as never
		const overview = await getAdminOverview(deps)
		expect(overview.unassigned).toBeNull()
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/db/__tests__/admin-queries.test.ts`
Expected: FAIL — `Cannot find module '../admin-queries'`.

- [ ] **Step 3: Implement `getAdminOverview`**

Create `apps/dashboard/lib/db/admin-queries.ts`:

```ts
import { listUsers } from '@/lib/db/user-queries'
import { type SessionStats, getSessionStats } from '@/lib/db/queries'
import { listRecalboxes } from '@/lib/db/recalbox-queries'

export type AdminMachine = {
	id: string
	name: string
	iconEmoji: string | null
	archived: boolean
}

export type AdminUserOverview = {
	user: { id: string; email: string; role: string }
	machines: AdminMachine[]
	stats: SessionStats
}

export type AdminOverview = {
	users: AdminUserOverview[]
	unassigned: { machines: AdminMachine[]; stats: SessionStats } | null
}

export type AdminOverviewDeps = {
	listUsers: typeof listUsers
	listRecalboxes: typeof listRecalboxes
	getStats: (recalboxIds: string[]) => Promise<SessionStats>
}

const defaultDeps: AdminOverviewDeps = {
	listUsers,
	listRecalboxes,
	getStats: (recalboxIds) => getSessionStats({ recalboxIds }),
}

function toMachine(r: {
	id: string
	name: string
	iconEmoji: string | null
	archived: boolean
}): AdminMachine {
	return { id: r.id, name: r.name, iconEmoji: r.iconEmoji, archived: r.archived }
}

/** Per-user aggregated playtime + machines for the admin read-only view. Admin-gated by the caller. */
export async function getAdminOverview(
	deps: AdminOverviewDeps = defaultDeps,
): Promise<AdminOverview> {
	const users = deps.listUsers()
	const all = deps.listRecalboxes()

	const byOwner = new Map<string, AdminMachine[]>()
	const unownedMachines: AdminMachine[] = []
	for (const r of all) {
		const machine = toMachine(r)
		if (r.ownerUserId == null) {
			unownedMachines.push(machine)
		} else {
			const list = byOwner.get(r.ownerUserId) ?? []
			list.push(machine)
			byOwner.set(r.ownerUserId, list)
		}
	}

	const userOverviews = await Promise.all(
		users.map(async (u) => {
			const machines = byOwner.get(u.id) ?? []
			const stats = await deps.getStats(machines.map((m) => m.id))
			return { user: u, machines, stats }
		}),
	)

	const unassigned =
		unownedMachines.length > 0
			? { machines: unownedMachines, stats: await deps.getStats(unownedMachines.map((m) => m.id)) }
			: null

	return { users: userOverviews, unassigned }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @recalbox/dashboard exec vitest run lib/db/__tests__/admin-queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write lib/db/admin-queries.ts lib/db/__tests__/admin-queries.test.ts
git add apps/dashboard/lib/db/admin-queries.ts apps/dashboard/lib/db/__tests__/admin-queries.test.ts
git commit -m "feat(saas): add getAdminOverview aggregator for admin view"
```

---

### Task 4: Export `isAdmin` from ownership

**Files:**
- Modify: `apps/dashboard/lib/auth/ownership.ts:4-6`

> Covered by the existing `ownership.test.ts` indirectly and by the layout/page usage. No new test (it's a one-word visibility change to already-tested logic).

- [ ] **Step 1: Make `isAdmin` exported**

In `apps/dashboard/lib/auth/ownership.ts`, change line 4 from:

```ts
function isAdmin(user: AuthedUser): boolean {
```

to:

```ts
export function isAdmin(user: AuthedUser): boolean {
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/auth/ownership.ts
git commit -m "refactor(saas): export isAdmin helper for admin gating"
```

---

### Task 5: i18n strings for the admin view

**Files:**
- Modify: `apps/dashboard/messages/en.json` (nav block ~line 10; add a top-level `admin` section)
- Modify: `apps/dashboard/messages/fr.json` (matching keys)

> No automated test; verified by the runtime render in Task 8. Keep `en.json` and `fr.json` key-for-key identical.

- [ ] **Step 1: Add the `nav.admin` key (en.json)**

In `apps/dashboard/messages/en.json`, inside the `"nav"` object, add after `"bios": "BIOS"` (add a comma to the BIOS line):

```json
		"bios": "BIOS",
		"admin": "Admin"
```

- [ ] **Step 2: Add the `admin` section (en.json)**

Add a new top-level section (e.g. right after the `"nav"` block closes):

```json
	"admin": {
		"title": "Admin — All Users",
		"subtitle": "Read-only view of every user's machines and playtime.",
		"machines": "Machines",
		"playtime": "Playtime",
		"sessions": "Sessions",
		"games": "Games",
		"topGames": "Top games",
		"unassigned": "Unassigned machines",
		"noUsers": "No users yet.",
		"noActivity": "No activity yet.",
		"archived": "archived"
	},
```

- [ ] **Step 3: Mirror both blocks in fr.json**

In `apps/dashboard/messages/fr.json`, add to `"nav"`:

```json
		"admin": "Admin"
```

and the matching section:

```json
	"admin": {
		"title": "Admin — Tous les utilisateurs",
		"subtitle": "Vue en lecture seule des machines et du temps de jeu de chaque utilisateur.",
		"machines": "Machines",
		"playtime": "Temps de jeu",
		"sessions": "Sessions",
		"games": "Jeux",
		"topGames": "Top jeux",
		"unassigned": "Machines non attribuées",
		"noUsers": "Aucun utilisateur pour l'instant.",
		"noActivity": "Aucune activité pour l'instant.",
		"archived": "archivée"
	},
```

- [ ] **Step 4: Validate JSON**

Run: `node -e "require('./apps/dashboard/messages/en.json'); require('./apps/dashboard/messages/fr.json'); console.log('ok')"`
Expected: prints `ok` (both files parse).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/fr.json
git commit -m "feat(saas): add i18n strings for admin overview"
```

---

### Task 6: Admin overview page (gated server component)

**Files:**
- Create: `apps/dashboard/app/[locale]/admin/page.tsx`

> Verified at runtime in Task 8 (admin sees the page; member is redirected). No isolated unit test — it's a server component composed of already-tested pieces (`getAdminOverview`, `isAdmin`, `formatDuration`).

- [ ] **Step 1: Create the page**

```tsx
import { isAdmin } from '@/lib/auth/ownership'
import { getUser } from '@/lib/auth/require-user'
import { getAdminOverview } from '@/lib/db/admin-queries'
import { formatDuration } from '@/lib/stats/formatters'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
	const user = await getUser()
	if (!user || !isAdmin(user)) redirect('/')

	const t = await getTranslations('admin')
	const overview = await getAdminOverview()

	const cards = [
		...overview.users.map((u) => ({
			key: u.user.id,
			title: u.user.email,
			role: u.user.role,
			machines: u.machines,
			stats: u.stats,
		})),
		...(overview.unassigned
			? [
					{
						key: '__unassigned__',
						title: t('unassigned'),
						role: null,
						machines: overview.unassigned.machines,
						stats: overview.unassigned.stats,
					},
				]
			: []),
	]

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-sm text-muted-foreground">{t('subtitle')}</p>
			</div>

			{overview.users.length === 0 && (
				<p className="text-sm text-muted-foreground">{t('noUsers')}</p>
			)}

			<div className="space-y-4">
				{cards.map((c) => (
					<div key={c.key} className="border rounded-lg p-4 space-y-3">
						<div className="flex items-center gap-2">
							<p className="font-medium">{c.title}</p>
							{c.role && (
								<span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
									{c.role}
								</span>
							)}
						</div>

						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
							<div>
								<p className="text-xs text-muted-foreground">{t('playtime')}</p>
								<p className="font-semibold">{formatDuration(c.stats.totalPlaytimeSec)}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">{t('sessions')}</p>
								<p className="font-semibold">{c.stats.totalSessions}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">{t('games')}</p>
								<p className="font-semibold">{c.stats.uniqueGames}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">{t('machines')}</p>
								<p className="font-semibold">{c.machines.length}</p>
							</div>
						</div>

						{c.machines.length > 0 && (
							<div className="flex flex-wrap gap-2">
								{c.machines.map((m) => (
									<span
										key={m.id}
										className="rounded border px-2 py-1 text-xs text-muted-foreground"
									>
										{m.iconEmoji ?? '🕹️'} {m.name}
										{m.archived ? ` (${t('archived')})` : ''}
									</span>
								))}
							</div>
						)}

						{c.stats.topGames.length > 0 ? (
							<div className="space-y-1">
								<p className="text-xs text-muted-foreground">{t('topGames')}</p>
								<ol className="space-y-0.5 text-sm">
									{c.stats.topGames.slice(0, 5).map((g) => (
										<li key={g.romPath} className="flex justify-between gap-4">
											<span className="truncate">{g.gameName}</span>
											<span className="shrink-0 text-muted-foreground">
												{formatDuration(g.playtimeSec)}
											</span>
										</li>
									))}
								</ol>
							</div>
						) : (
							<p className="text-xs text-muted-foreground">{t('noActivity')}</p>
						)}
					</div>
				))}
			</div>
		</div>
	)
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Format, lint, commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write app/[locale]/admin/page.tsx
git add apps/dashboard/app/[locale]/admin/page.tsx
git commit -m "feat(saas): add admin read-only overview page"
```

---

### Task 7: Admin-only sidebar link

**Files:**
- Modify: `apps/dashboard/components/app-sidebar.tsx`
- Modify: `apps/dashboard/app/[locale]/layout.tsx:74-88`

> Verified at runtime in Task 8 (link visible for admin, absent for member). No unit test — this is presentational wiring driven by the already-tested `isAdmin`.

- [ ] **Step 1: Accept `showAdmin` and append the nav item**

In `apps/dashboard/components/app-sidebar.tsx`:

Add `ShieldUser` to the lucide import (alongside the existing icons):

```ts
import {
	BarChart3,
	Gamepad2,
	Gift,
	LayoutDashboard,
	Library,
	MemoryStick,
	Settings,
	ShieldUser,
	Trophy,
	UserRound,
} from 'lucide-react'
```

Change the component signature and build the item list from the `showAdmin` flag. Replace `export function AppSidebar() {` and the `{NAV_ITEMS.map(...)}` usage:

```tsx
export function AppSidebar({ showAdmin = false }: { showAdmin?: boolean }) {
	const t = useTranslations('nav')
	const pathname = usePathname()
	const { isMobile, setOpenMobile } = useSidebar()

	const navItems = showAdmin
		? [...NAV_ITEMS, { href: '/admin', labelKey: 'admin', icon: ShieldUser } as const]
		: NAV_ITEMS
```

Then change the map from `{NAV_ITEMS.map((item) => {` to `{navItems.map((item) => {`.

- [ ] **Step 2: Pass `showAdmin` from the layout**

In `apps/dashboard/app/[locale]/layout.tsx`, update the import on line 20 to include `isAdmin`:

```ts
import { canControlRecalbox, getViewableRecalboxIds, isAdmin } from '@/lib/auth/ownership'
```

After the `canControl` computation (line 78), add:

```ts
	const showAdmin = user ? isAdmin(user) : false
```

Change the sidebar render (line 88) from `<AppSidebar />` to:

```tsx
										<AppSidebar showAdmin={showAdmin} />
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Format, lint, commit**

```bash
pnpm --filter @recalbox/dashboard exec biome check --write components/app-sidebar.tsx app/[locale]/layout.tsx
git add apps/dashboard/components/app-sidebar.tsx apps/dashboard/app/[locale]/layout.tsx
git commit -m "feat(saas): show admin nav link to admins only"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole dashboard test suite**

Run: `pnpm --filter @recalbox/dashboard exec vitest run`
Expected: all green, including the new `session-stats-recalbox-ids` (3) and `admin-queries` (5).

- [ ] **Step 2: Type-check the whole workspace**

Run: `pnpm --filter @recalbox/dashboard exec tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 3: Lint the whole workspace**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Manual runtime check (two roles)**

With the dev server running (`pnpm dev` on a free port) and a fresh DB:
1. Create an admin and a member: `pnpm --filter @recalbox/dashboard exec tsx scripts/create-user.ts admin@test.local pass admin` and `... member@test.local pass member`.
2. Assign at least one recalbox to the member via `scripts/assign-recalbox-owner.ts member@test.local <id>` and leave at least one unowned.
3. Log in as **admin** → `/admin` renders, sidebar shows the **Admin** link, page lists both users + an "Unassigned machines" card.
4. Log in as **member** → sidebar has **no** Admin link; visiting `/admin` directly redirects to `/`.

> ⚠️ Use a non-reachable / fake recalbox host for this check, or simply don't trigger any control action — this page is read-only and issues no SSH/MQTT, but avoid the earlier Phase 2 mistake of pointing tests at a live box.

5. Reset the dev DB to its prior state (remove the two test users; restore recalbox `owner_user_id` values) once done.

- [ ] **Step 5: Final commit (if any cleanup remains) and update memory**

Update `saas-multi-user.md` memory to mark Plan 3 done. No code commit needed if Steps 1-4 produced none.

---

## Verification

- `pnpm --filter @recalbox/dashboard exec vitest run` — all tests green (existing + 8 new).
- `pnpm --filter @recalbox/dashboard exec tsc --noEmit` — clean.
- `/admin` is reachable by an admin and redirects members to `/`.
- The **Admin** sidebar link appears only for admins.
- No control path (`canControlRecalbox`, power/launch/sync/m3u) was modified — Phase 3 is read-only.
