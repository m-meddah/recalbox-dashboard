# Super Retrogamers Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete Super Retrogamers cross-project integration to the dashboard — slug generation, mock API client, DB cache, proxy routes, and all UI touchpoints — with the API client hardcoded to return `{ exists: false }` (Phase 1 / mock mode).

**Architecture:** New `lib/super-retrogamers/` module (slug, client, cache, region). Four proxy API routes under `app/api/super-retrogamers/`. UI components (`<SuperRetrogamersLink>`, `<SuperRetrogamersPreview>`) wired into GameCard, NowPlaying, TopGames, and Settings. Feature flag `superRetrogamers.enabled` gates all UI surfaces.

**Tech Stack:** Next.js App Router, Drizzle ORM + SQLite, shadcn/ui, next-intl, Vitest, Zod, Tailwind CSS v4.

---

## File Map

**Create:**
- `apps/dashboard/lib/super-retrogamers/slug.ts`
- `apps/dashboard/lib/super-retrogamers/region.ts`
- `apps/dashboard/lib/super-retrogamers/client.ts`
- `apps/dashboard/lib/super-retrogamers/cache.ts`
- `apps/dashboard/lib/super-retrogamers/__tests__/slug.test.ts`
- `apps/dashboard/lib/super-retrogamers/__tests__/client.test.ts`
- `apps/dashboard/app/api/super-retrogamers/test-connection/route.ts`
- `apps/dashboard/app/api/super-retrogamers/lookup/route.ts`
- `apps/dashboard/app/api/super-retrogamers/games/[slug]/route.ts`
- `apps/dashboard/app/api/super-retrogamers/game-info/route.ts`
- `apps/dashboard/app/api/super-retrogamers/enrich-collection/route.ts`
- `apps/dashboard/components/super-retrogamers-link.tsx`
- `apps/dashboard/components/super-retrogamers-preview.tsx`
- `docs/super-retrogamers-api-spec.md`

**Modify:**
- `apps/dashboard/lib/db/schema.ts` — add `srSlug/srHasPage/srUrl/srCheckedAt` to `games`; add `srCache` table
- `apps/dashboard/lib/db/queries.ts` — add SR queries
- `apps/dashboard/lib/settings/schemas.ts` — add `superRetrogamersConfigSchema`
- `apps/dashboard/lib/settings/defaults.ts` — add SR defaults
- `apps/dashboard/app/api/settings/route.ts` — accept SR fields in PUT body
- `apps/dashboard/components/game-card.tsx` — add SR chip in meta row
- `apps/dashboard/components/now-playing.tsx` — add SR icon button
- `apps/dashboard/components/stats/top-games.tsx` — add SR icon link
- `apps/dashboard/app/[locale]/settings/page.tsx` — add Integrations tab (5th)
- `apps/dashboard/messages/en.json`
- `apps/dashboard/messages/fr.json`

---

## Task 1: DB Schema — games columns + sr_cache table

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts`

- [ ] **Step 1: Add SR columns to games table and sr_cache table in schema.ts**

Open `apps/dashboard/lib/db/schema.ts`. Add these columns to the `games` table (after `updatedAt`):

```typescript
srSlug: text('sr_slug'),
srHasPage: int('sr_has_page'),   // NULL = unchecked, 0 = no page, 1 = has page
srUrl: text('sr_url'),
srCheckedAt: int('sr_checked_at', { mode: 'timestamp' }),
```

And add the new `srCache` table at the end of the file:

```typescript
export const srCache = sqliteTable('sr_cache', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
})
```

- [ ] **Step 2: Generate and run the migration**

```bash
cd apps/dashboard
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

Expected: two new files in `drizzle/` (or `migrations/`), migration succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(sr): add sr_* columns to games and sr_cache table"
```

---

## Task 2: Settings schema — add superRetrogamers config

**Files:**
- Modify: `apps/dashboard/lib/settings/schemas.ts`
- Modify: `apps/dashboard/lib/settings/defaults.ts`
- Modify: `apps/dashboard/app/api/settings/route.ts`

- [ ] **Step 1: Add schema to schemas.ts**

In `apps/dashboard/lib/settings/schemas.ts`, add after `retroachievementsConfigSchema`:

```typescript
export const superRetrogamersConfigSchema = z.object({
	enabled: z.boolean(),
	apiUrl: z.string().max(256),
	preferredRegion: z.enum(['US', 'EU', 'JP', '']),
})
export type SuperRetrogamersConfig = z.infer<typeof superRetrogamersConfigSchema>
```

Update `appConfigSchema` to include the new field:

```typescript
export const appConfigSchema = z.object({
	recalbox: recalboxConfigSchema,
	scrobble: scrobbleConfigSchema,
	ui: uiConfigSchema,
	retroachievements: retroachievementsConfigSchema,
	superRetrogamers: superRetrogamersConfigSchema,
})
```

- [ ] **Step 2: Add defaults**

In `apps/dashboard/lib/settings/defaults.ts`, add to the returned object:

```typescript
superRetrogamers: {
	enabled: false,
	apiUrl: '',
	preferredRegion: '',
},
```

- [ ] **Step 3: Accept SR fields in PUT /api/settings**

In `apps/dashboard/app/api/settings/route.ts`, add to `putBodySchema`:

```typescript
superRetrogamers: z
	.object({
		enabled: z.boolean().optional(),
		apiUrl: z.string().max(256).optional(),
		preferredRegion: z.enum(['US', 'EU', 'JP', '']).optional(),
	})
	.optional(),
```

- [ ] **Step 4: Verify the app still starts**

```bash
pnpm --filter @recalbox/dashboard build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/settings/ apps/dashboard/app/api/settings/route.ts
git commit -m "feat(sr): add superRetrogamers config schema and defaults"
```

---

## Task 3: slug.ts — gameToSlug with tests (TDD)

**Files:**
- Create: `apps/dashboard/lib/super-retrogamers/__tests__/slug.test.ts`
- Create: `apps/dashboard/lib/super-retrogamers/slug.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/dashboard/lib/super-retrogamers/__tests__/slug.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { SR_SYSTEM_SLUGS, gameToSlug, gameToSlugVariants, slugToParts } from '../slug'

describe('SR_SYSTEM_SLUGS', () => {
	it('maps snes to super-nintendo', () => {
		expect(SR_SYSTEM_SLUGS.snes).toBe('super-nintendo')
	})
	it('maps psx to playstation', () => {
		expect(SR_SYSTEM_SLUGS.psx).toBe('playstation')
	})
	it('maps gb to game-boy', () => {
		expect(SR_SYSTEM_SLUGS.gb).toBe('game-boy')
	})
})

describe('gameToSlug', () => {
	it('basic game name + system', () => {
		expect(gameToSlug('Super Mario World (USA).smc', 'snes')).toBe(
			'super-mario-world-console-super-nintendo',
		)
	})
	it('strips region tags', () => {
		expect(gameToSlug('Mega Man 7 (USA).smc', 'snes')).toBe(
			'mega-man-7-console-super-nintendo',
		)
	})
	it('strips [!] quality tag', () => {
		expect(gameToSlug('Castlevania - Symphony of the Night (USA) [!].bin', 'psx')).toBe(
			'castlevania-symphony-of-the-night-console-playstation',
		)
	})
	it('strips version tags', () => {
		expect(gameToSlug('Some Game (v1.0) (USA).nes', 'nes')).toBe(
			'some-game-console-nes',
		)
	})
	it('strips Rev tags', () => {
		expect(gameToSlug('Sonic the Hedgehog (Rev A) (USA).md', 'megadrive')).toBe(
			'sonic-the-hedgehog-console-megadrive',
		)
	})
	it('normalises accents', () => {
		expect(gameToSlug('Alerte à Malibu (France).nes', 'nes')).toBe(
			'alerte-a-malibu-console-nes',
		)
	})
	it('handles apostrophes', () => {
		expect(gameToSlug("Yoshi's Island - Super Mario World 2 (USA).smc", 'snes')).toBe(
			'yoshis-island-super-mario-world-2-console-super-nintendo',
		)
	})
	it('collapses multiple dashes from hyphens in title', () => {
		expect(gameToSlug('Street Fighter II - The World Warrior (USA).smc', 'snes')).toBe(
			'street-fighter-ii-the-world-warrior-console-super-nintendo',
		)
	})
	it('returns null for unmapped system', () => {
		expect(gameToSlug('Pac-Man.zip', 'mame')).toBeNull()
	})
	it('returns null for fbneo', () => {
		expect(gameToSlug('1942.zip', 'fbneo')).toBeNull()
	})
	it('handles number-only prefix', () => {
		expect(gameToSlug('007 Agent Under Fire (USA).iso', 'ps2')).toBe(
			'007-agent-under-fire-console-playstation-2',
		)
	})
	it('handles colons', () => {
		expect(gameToSlug('Metroid Prime: Hunters (USA).nds', 'nds')).toBe(
			'metroid-prime-hunters-console-nintendo-ds',
		)
	})
	it('handles .cue extension', () => {
		expect(gameToSlug('Final Fantasy VII (USA).cue', 'psx')).toBe(
			'final-fantasy-vii-console-playstation',
		)
	})
	it('handles gba system', () => {
		expect(gameToSlug('Pokemon Fire Red (USA).gba', 'gba')).toBe(
			'pokemon-fire-red-console-game-boy-advance',
		)
	})
	it('handles n64 system', () => {
		expect(gameToSlug('The Legend of Zelda - Ocarina of Time (USA).z64', 'n64')).toBe(
			'the-legend-of-zelda-ocarina-of-time-console-nintendo-64',
		)
	})
})

describe('gameToSlugVariants', () => {
	it('returns single variant when name does not start with the-', () => {
		const variants = gameToSlugVariants('Super Mario World (USA).smc', 'snes')
		expect(variants).toEqual(['super-mario-world-console-super-nintendo'])
	})
	it('returns two variants when name starts with the-', () => {
		const variants = gameToSlugVariants(
			'The Legend of Zelda - A Link to the Past (USA).smc',
			'snes',
		)
		expect(variants).toHaveLength(2)
		expect(variants[0]).toBe('the-legend-of-zelda-a-link-to-the-past-console-super-nintendo')
		expect(variants[1]).toBe('legend-of-zelda-a-link-to-the-past-the-console-super-nintendo')
	})
	it('returns empty array for unmapped system', () => {
		expect(gameToSlugVariants('Game.zip', 'mame')).toEqual([])
	})
})

describe('slugToParts', () => {
	it('extracts name and system from slug', () => {
		const result = slugToParts('super-mario-world-console-super-nintendo')
		expect(result).toEqual({ name: 'super-mario-world', system: 'snes' })
	})
	it('returns null for unrecognised console slug', () => {
		expect(slugToParts('some-game-console-unknown-system')).toBeNull()
	})
	it('returns null for malformed slug', () => {
		expect(slugToParts('no-console-here')).toBeNull()
	})
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/super-retrogamers/__tests__/slug.test.ts
```

Expected: all tests fail with "Cannot find module '../slug'".

- [ ] **Step 3: Implement slug.ts**

Create `apps/dashboard/lib/super-retrogamers/slug.ts`:

```typescript
export const SR_SYSTEM_SLUGS: Record<string, string> = {
	snes: 'super-nintendo',
	nes: 'nes',
	megadrive: 'megadrive',
	gb: 'game-boy',
	gbc: 'game-boy-color',
	gba: 'game-boy-advance',
	psx: 'playstation',
	ps2: 'playstation-2',
	ps3: 'playstation-3',
	psp: 'psp',
	gc: 'gamecube',
	n64: 'nintendo-64',
	nds: 'nintendo-ds',
	wii: 'wii',
	dreamcast: 'dreamcast',
	saturn: 'saturn',
	segacd: 'mega-cd',
	megadrive32x: 'megadrive-32x',
	gamegear: 'game-gear',
	mastersystem: 'master-system',
	neogeo: 'neo-geo',
	neogeocd: 'neo-geo-cd',
	neogeopocket: 'neo-geo-pocket',
	neogeopocketcolor: 'neo-geo-pocket-color',
	atari2600: 'atari-2600',
	atari5200: 'atari-5200',
	atari7800: 'atari-7800',
	lynx: 'lynx',
	jaguar: 'jaguar',
	jaguarcd: 'jaguar-cd',
	msx: 'msx',
	msx2: 'msx2',
	pcengine: 'pc-engine',
	pcenginecd: 'pc-engine-cd-rom',
	supergrafx: 'pc-engine-supergrafx',
	pcfx: 'pc-fx',
	fds: 'family-computer-disk-system',
	virtualboy: 'virtual-boy',
	wonderswan: 'wonderswan',
	wonderswancolor: 'wonderswan-color',
	xbox: 'xbox',
	xbox360: 'xbox-360',
	'3do': '3do',
	intellivision: 'intellivision',
	colecovision: 'colecovision',
	vectrex: 'vectrex',
	channelf: 'channel-f',
	amigacd32: 'amiga-cd32',
	amigacdtv: 'amiga-cdtv',
	gx4000: 'gx4000',
	'msx-turbo-r': 'msx-turbo-r',
}

function normaliseName(raw: string): string {
	return (
		raw
			// Remove file extension
			.replace(/\.[a-zA-Z0-9]{1,5}$/, '')
			// Remove anything in (...) or [...]
			.replace(/\s*\([^)]*\)\s*/g, ' ')
			.replace(/\s*\[[^\]]*\]\s*/g, ' ')
			.trim()
			// Decompose accents → strip diacritics
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			// Remove apostrophes and selected punctuation
			.replace(/[''`]/g, '')
			.replace(/[:.!?,;]/g, '')
			// Hyphens, underscores, spaces → single dash
			.replace(/[-_\s]+/g, '-')
			// Strip anything that's not alphanumeric or dash
			.replace(/[^a-z0-9-]/g, '')
			// Collapse repeated dashes, trim edges
			.replace(/-+/g, '-')
			.replace(/^-+|-+$/g, '')
	)
}

export function gameToSlug(name: string, system: string): string | null {
	const consoleSlug = SR_SYSTEM_SLUGS[system]
	if (!consoleSlug) return null
	const normalised = normaliseName(name)
	if (!normalised) return null
	return `${normalised}-console-${consoleSlug}`
}

export function gameToSlugVariants(name: string, system: string): string[] {
	const primary = gameToSlug(name, system)
	if (!primary) return []
	const consoleSlug = SR_SYSTEM_SLUGS[system] as string
	const namePart = primary.slice(0, primary.length - `-console-${consoleSlug}`.length)
	const variants: string[] = [primary]
	if (namePart.startsWith('the-')) {
		const withoutThe = namePart.slice(4)
		variants.push(`${withoutThe}-the-console-${consoleSlug}`)
	}
	return variants
}

export function slugToParts(slug: string): { name: string; system: string } | null {
	const idx = slug.lastIndexOf('-console-')
	if (idx === -1) return null
	const namePart = slug.slice(0, idx)
	const consoleSlug = slug.slice(idx + '-console-'.length)
	const system = Object.entries(SR_SYSTEM_SLUGS).find(([, v]) => v === consoleSlug)?.[0]
	if (!system) return null
	return { name: namePart, system }
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/super-retrogamers/__tests__/slug.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/super-retrogamers/
git commit -m "feat(sr): add gameToSlug with variants and slugToParts"
```

---

## Task 4: region.ts — ROM region detection

**Files:**
- Create: `apps/dashboard/lib/super-retrogamers/region.ts`

- [ ] **Step 1: Create region.ts**

```typescript
const REGION_TAGS: Array<[RegExp, string]> = [
	[/\(USA\)/i, 'US'],
	[/\(U\)/, 'US'],
	[/\(Europe\)/i, 'EU'],
	[/\(E\)/, 'EU'],
	[/\(Japan\)/i, 'JP'],
	[/\(J\)/, 'JP'],
	[/\(Australia\)/i, 'AU'],
	[/\(Korea\)/i, 'KR'],
	[/\(China\)/i, 'CN'],
	[/\(Brazil\)/i, 'BR'],
	[/\(World\)/i, 'US'],
]

export function regionFromRomName(romName: string): string | null {
	for (const [pattern, region] of REGION_TAGS) {
		if (pattern.test(romName)) return region
	}
	return null
}

export function resolveRegion(romName: string, preferredRegion: string): string | null {
	return regionFromRomName(romName) ?? (preferredRegion || null)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/lib/super-retrogamers/region.ts
git commit -m "feat(sr): add region detection from ROM name"
```

---

## Task 5: client.ts — mock client + tests (TDD)

**Files:**
- Create: `apps/dashboard/lib/super-retrogamers/__tests__/client.test.ts`
- Create: `apps/dashboard/lib/super-retrogamers/client.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/dashboard/lib/super-retrogamers/__tests__/client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { SuperRetrogamersClient } from '../client'

describe('SuperRetrogamersClient (mock mode)', () => {
	const client = new SuperRetrogamersClient()

	it('checkExists always returns { exists: false }', async () => {
		const result = await client.checkExists('super-mario-world-console-super-nintendo')
		expect(result).toEqual({ exists: false })
	})

	it('getGame always returns null', async () => {
		const result = await client.getGame('super-mario-world-console-super-nintendo')
		expect(result).toBeNull()
	})

	it('bulkLookup returns empty record', async () => {
		const result = await client.bulkLookup([
			'super-mario-world-console-super-nintendo',
			'mega-man-7-console-super-nintendo',
		])
		expect(result).toEqual({})
	})

	it('listSystems returns empty array', async () => {
		const result = await client.listSystems()
		expect(result).toEqual([])
	})

	it('checkExists never throws', async () => {
		await expect(client.checkExists('')).resolves.not.toThrow()
	})
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/super-retrogamers/__tests__/client.test.ts
```

Expected: fails with "Cannot find module '../client'".

- [ ] **Step 3: Implement client.ts (Phase 1 mock)**

Create `apps/dashboard/lib/super-retrogamers/client.ts`:

```typescript
export type SrGame = {
	slug: string
	name: string
	consoleSlug: string
	score: number | null
	summary: string | null
	specs: Record<string, string>
	characters: string[]
	url: string
}

export type SrSystem = {
	slug: string
	name: string
}

export type BulkLookupResult = Record<string, { exists: boolean; url?: string }>

export class SuperRetrogamersClient {
	async checkExists(_slug: string): Promise<{ exists: boolean; url?: string }> {
		return { exists: false }
	}

	async getGame(_slug: string): Promise<SrGame | null> {
		return null
	}

	async bulkLookup(_slugs: string[]): Promise<BulkLookupResult> {
		return {}
	}

	async listSystems(): Promise<SrSystem[]> {
		return []
	}
}

export const srClient = new SuperRetrogamersClient()
```

- [ ] **Step 4: Run tests — all pass**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/super-retrogamers/__tests__/client.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/super-retrogamers/
git commit -m "feat(sr): add Phase 1 mock SuperRetrogamersClient"
```

---

## Task 6: cache.ts — sr_cache read/write

**Files:**
- Create: `apps/dashboard/lib/super-retrogamers/cache.ts`

- [ ] **Step 1: Create cache.ts**

```typescript
import { db } from '@/lib/db'
import { srCache } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const TTL_MS = {
	exists: 24 * 60 * 60 * 1000,
	game: 12 * 60 * 60 * 1000,
	systems: 7 * 24 * 60 * 60 * 1000,
} as const

function ttlFor(key: string): number {
	if (key.startsWith('exists:')) return TTL_MS.exists
	if (key.startsWith('game:')) return TTL_MS.game
	return TTL_MS.systems
}

export function getCached<T>(key: string): T | null {
	const row = db.select().from(srCache).where(eq(srCache.key, key)).get()
	if (!row) return null
	if (row.expiresAt < new Date()) return null
	try {
		return JSON.parse(row.value) as T
	} catch {
		return null
	}
}

export function getCachedStale<T>(key: string): { value: T; stale: boolean } | null {
	const row = db.select().from(srCache).where(eq(srCache.key, key)).get()
	if (!row) return null
	try {
		return { value: JSON.parse(row.value) as T, stale: row.expiresAt < new Date() }
	} catch {
		return null
	}
}

export function setCached(key: string, value: unknown): void {
	const expiresAt = new Date(Date.now() + ttlFor(key))
	db.insert(srCache)
		.values({ key, value: JSON.stringify(value), expiresAt })
		.onConflictDoUpdate({
			target: srCache.key,
			set: { value: JSON.stringify(value), expiresAt },
		})
		.run()
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/lib/super-retrogamers/cache.ts
git commit -m "feat(sr): add sr_cache read/write helpers"
```

---

## Task 7: SR queries in queries.ts

**Files:**
- Modify: `apps/dashboard/lib/db/queries.ts`

- [ ] **Step 1: Add SR query functions**

Add at the end of `apps/dashboard/lib/db/queries.ts`:

```typescript
// ─── Super Retrogamers ────────────────────────────────────────────────────────

import { srCache } from '@/lib/db/schema'

export function updateGameSrInfo(
	romPath: string,
	srSlug: string,
	srHasPage: boolean,
	srUrl: string | null,
): void {
	db.update(games)
		.set({
			srSlug,
			srHasPage: srHasPage ? 1 : 0,
			srUrl: srUrl ?? null,
			srCheckedAt: new Date(),
		})
		.where(eq(games.romPath, romPath))
		.run()
}

export function getGameSrInfo(
	romPath: string,
): { srHasPage: number | null; srUrl: string | null } | null {
	const row = db
		.select({ srHasPage: games.srHasPage, srUrl: games.srUrl })
		.from(games)
		.where(eq(games.romPath, romPath))
		.get()
	return row ?? null
}

export function countSrStats(): { total: number; matched: number } {
	const total = db.select({ count: count() }).from(games).get()?.count ?? 0
	const matched =
		db
			.select({ count: count() })
			.from(games)
			.where(eq(games.srHasPage, 1))
			.get()?.count ?? 0
	return { total, matched }
}

export function listUncheckedGames(limit: number): Array<{
	romPath: string
	name: string
	system: string
}> {
	return db
		.select({ romPath: games.romPath, name: games.name, system: games.system })
		.from(games)
		.where(isNull(games.srCheckedAt))
		.limit(limit)
		.all()
}
```

Note: `count` is already imported from `drizzle-orm` in this file. `isNull` is also already imported.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @recalbox/dashboard build 2>&1 | grep -E "error|Error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/db/queries.ts
git commit -m "feat(sr): add SR query helpers to queries.ts"
```

---

## Task 8: API route — POST /api/super-retrogamers/test-connection

**Files:**
- Create: `apps/dashboard/app/api/super-retrogamers/test-connection/route.ts`

- [ ] **Step 1: Create route**

```typescript
import { srClient } from '@/lib/super-retrogamers/client'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	const t0 = Date.now()
	try {
		await srClient.listSystems()
		return NextResponse.json({ ok: true, latencyMs: Date.now() - t0 })
	} catch (err) {
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
			{ status: 502 },
		)
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/api/super-retrogamers/
git commit -m "feat(sr): add test-connection API route"
```

---

## Task 9: API route — POST /api/super-retrogamers/lookup

**Files:**
- Create: `apps/dashboard/app/api/super-retrogamers/lookup/route.ts`

- [ ] **Step 1: Create route**

```typescript
import { updateGameSrInfo } from '@/lib/db/queries'
import { srClient } from '@/lib/super-retrogamers/client'
import { setCached } from '@/lib/super-retrogamers/cache'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
	slugs: z.array(z.string()).min(1).max(100),
	romPaths: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}
	const parsed = bodySchema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
	}
	const { slugs, romPaths } = parsed.data

	const results = await srClient.bulkLookup(slugs)

	// Persist results: update games table and cache
	for (let i = 0; i < slugs.length; i++) {
		const slug = slugs[i] as string
		const romPath = romPaths?.[i]
		const result = results[slug] ?? { exists: false }

		setCached(`exists:${slug}`, result.exists)

		if (romPath) {
			updateGameSrInfo(romPath, slug, result.exists, result.url ?? null)
		}
	}

	return NextResponse.json({ results })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/api/super-retrogamers/lookup/
git commit -m "feat(sr): add bulk lookup API route"
```

---

## Task 10: API route — GET /api/super-retrogamers/games/[slug]

**Files:**
- Create: `apps/dashboard/app/api/super-retrogamers/games/[slug]/route.ts`

- [ ] **Step 1: Create route**

```typescript
import { srClient } from '@/lib/super-retrogamers/client'
import { getCachedStale, setCached } from '@/lib/super-retrogamers/cache'
import type { SrGame } from '@/lib/super-retrogamers/client'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
	const { slug } = params
	const cacheKey = `game:${slug}`

	// Try cache first (fresh)
	const cached = getCachedStale<SrGame>(cacheKey)
	if (cached && !cached.stale) {
		return NextResponse.json(cached.value)
	}

	// Fetch from SR
	try {
		const game = await srClient.getGame(slug)
		if (game) {
			setCached(cacheKey, game)
			return NextResponse.json(game)
		}
		// Not found on SR
		if (cached?.stale) {
			return NextResponse.json({ ...cached.value, stale: true })
		}
		return NextResponse.json(null)
	} catch {
		// SR down: return stale cache if available
		if (cached) {
			return NextResponse.json({ ...cached.value, stale: true })
		}
		return NextResponse.json(null)
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/api/super-retrogamers/games/
git commit -m "feat(sr): add game detail proxy route with stale-while-revalidate cache"
```

---

## Task 11: API route — GET /api/super-retrogamers/game-info + enrich-collection

**Files:**
- Create: `apps/dashboard/app/api/super-retrogamers/game-info/route.ts`
- Create: `apps/dashboard/app/api/super-retrogamers/enrich-collection/route.ts`

- [ ] **Step 1: Create game-info route**

```typescript
import { getGameSrInfo } from '@/lib/db/queries'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
	const romPath = req.nextUrl.searchParams.get('romPath')
	if (!romPath) {
		return NextResponse.json({ error: 'romPath required' }, { status: 400 })
	}
	const info = getGameSrInfo(romPath)
	return NextResponse.json(info ?? { srHasPage: null, srUrl: null })
}
```

- [ ] **Step 2: Create enrich-collection route**

```typescript
import { listUncheckedGames, updateGameSrInfo } from '@/lib/db/queries'
import { srClient } from '@/lib/super-retrogamers/client'
import { gameToSlugVariants } from '@/lib/super-retrogamers/slug'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type EnrichEvent =
	| { type: 'start'; total: number }
	| { type: 'progress'; done: number; total: number }
	| { type: 'complete'; matched: number; total: number }
	| { type: 'error'; message: string }

function ndjson(e: EnrichEvent): string {
	return JSON.stringify(e) + '\n'
}

const BATCH = 100

export async function POST() {
	const encoder = new TextEncoder()
	const stream = new ReadableStream({
		async start(controller) {
			const write = (e: EnrichEvent) => controller.enqueue(encoder.encode(ndjson(e)))
			try {
				const allUnchecked = listUncheckedGames(10_000)
				write({ type: 'start', total: allUnchecked.length })
				let done = 0
				let matched = 0

				for (let i = 0; i < allUnchecked.length; i += BATCH) {
					const batch = allUnchecked.slice(i, i + BATCH)
					const slugEntries: Array<{ romPath: string; slug: string }> = []

					for (const game of batch) {
						const variants = gameToSlugVariants(game.name, game.system)
						if (variants[0]) {
							slugEntries.push({ romPath: game.romPath, slug: variants[0] })
						}
					}

					const slugs = slugEntries.map((e) => e.slug)
					const romPaths = slugEntries.map((e) => e.romPath)
					const results = await srClient.bulkLookup(slugs)

					for (let j = 0; j < slugEntries.length; j++) {
						const entry = slugEntries[j]!
						const result = results[entry.slug] ?? { exists: false }
						updateGameSrInfo(entry.romPath, entry.slug, result.exists, result.url ?? null)
						if (result.exists) matched++
					}

					done += batch.length
					write({ type: 'progress', done, total: allUnchecked.length })
				}

				write({ type: 'complete', matched, total: allUnchecked.length })
			} catch (err) {
				write({ type: 'error', message: err instanceof Error ? err.message : String(err) })
			} finally {
				controller.close()
			}
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Cache-Control': 'no-cache',
			'X-Content-Type-Options': 'nosniff',
		},
	})
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/api/super-retrogamers/
git commit -m "feat(sr): add game-info and enrich-collection API routes"
```

---

## Task 12: SuperRetrogamersLink component

**Files:**
- Create: `apps/dashboard/components/super-retrogamers-link.tsx`

- [ ] **Step 1: Create component**

```typescript
'use client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type Props = {
	srHasPage: number | null
	srUrl: string | null
	variant?: 'button' | 'icon' | 'badge'
	romPath?: string
}

export function SuperRetrogamersLink({ srHasPage, srUrl, variant = 'button', romPath }: Props) {
	const t = useTranslations('superRetrogamers')
	const [checking, setChecking] = useState(false)

	async function handleCheck() {
		if (!romPath) return
		setChecking(true)
		try {
			await fetch('/api/super-retrogamers/lookup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slugs: [], romPaths: [romPath] }),
			})
			window.location.reload()
		} catch {
			// silently fail
		} finally {
			setChecking(false)
		}
	}

	if (srHasPage === 1 && srUrl) {
		if (variant === 'badge') {
			return (
				<a
					href={srUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
				>
					SR ✓
				</a>
			)
		}
		if (variant === 'icon') {
			return (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<a
								href={srUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center text-violet-400 hover:text-violet-300 transition-colors"
							>
								<ExternalLink className="h-3.5 w-3.5" />
							</a>
						</TooltipTrigger>
						<TooltipContent>{t('viewOnSr')}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)
		}
		return (
			<Button variant="outline" size="sm" asChild>
				<a href={srUrl} target="_blank" rel="noopener noreferrer">
					{t('viewOnSr')}
					<ExternalLink className="ml-1.5 h-3.5 w-3.5" />
				</a>
			</Button>
		)
	}

	if (srHasPage === 0) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex items-center gap-1 rounded border border-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground cursor-default select-none">
							SR
						</span>
					</TooltipTrigger>
					<TooltipContent>{t('noPage')}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	// null — never checked
	if (variant === 'badge' && romPath) {
		return (
			<button
				onClick={handleCheck}
				disabled={checking}
				className="inline-flex items-center gap-1 rounded border border-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:border-violet-500/40 hover:text-violet-400 transition-colors disabled:opacity-50"
			>
				{checking ? '…' : t('check')}
			</button>
		)
	}

	return null
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/components/super-retrogamers-link.tsx
git commit -m "feat(sr): add SuperRetrogamersLink component (3 variants)"
```

---

## Task 13: SuperRetrogamersPreview component

**Files:**
- Create: `apps/dashboard/components/super-retrogamers-preview.tsx`

- [ ] **Step 1: Create component**

```typescript
'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { SrGame } from '@/lib/super-retrogamers/client'
import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type State =
	| { status: 'loading' }
	| { status: 'not-found' }
	| { status: 'error' }
	| { status: 'loaded'; game: SrGame & { stale?: boolean } }

type Props = {
	slug: string | null
}

export function SuperRetrogamersPreview({ slug }: Props) {
	const t = useTranslations('superRetrogamers.preview')
	const [state, setState] = useState<State>({ status: 'loading' })

	useEffect(() => {
		if (!slug) {
			setState({ status: 'not-found' })
			return
		}
		setState({ status: 'loading' })
		fetch(`/api/super-retrogamers/games/${encodeURIComponent(slug)}`)
			.then((r) => r.json())
			.then((data: SrGame | null) => {
				if (data) setState({ status: 'loaded', game: data })
				else setState({ status: 'not-found' })
			})
			.catch(() => setState({ status: 'error' }))
	}, [slug])

	if (state.status === 'loading') {
		return (
			<div className="space-y-3 p-4">
				<Skeleton className="h-6 w-1/3" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-4/5" />
			</div>
		)
	}

	if (state.status === 'not-found') {
		return (
			<div className="p-4 text-center text-sm text-muted-foreground">
				{t('notFound')}
			</div>
		)
	}

	if (state.status === 'error') {
		return (
			<div className="p-4 space-y-2 text-center">
				<p className="text-sm text-destructive">{t('error')}</p>
				<Button variant="outline" size="sm" onClick={() => setState({ status: 'loading' })}>
					{t('retry')}
				</Button>
			</div>
		)
	}

	const { game } = state
	return (
		<div className="p-4 space-y-4">
			{game.stale && (
				<p className="text-xs text-muted-foreground">{t('stale')}</p>
			)}
			{game.score !== null && (
				<div className="flex items-center gap-2">
					<span className="text-2xl font-bold">{game.score}</span>
					<span className="text-sm text-muted-foreground">/100</span>
				</div>
			)}
			{game.summary && (
				<p className="text-sm text-muted-foreground leading-relaxed">{game.summary}</p>
			)}
			{Object.keys(game.specs).length > 0 && (
				<div className="grid grid-cols-2 gap-1 text-xs">
					{Object.entries(game.specs).map(([k, v]) => (
						<div key={k} className="flex gap-1">
							<span className="text-muted-foreground capitalize">{k}:</span>
							<span>{v}</span>
						</div>
					))}
				</div>
			)}
			{game.characters.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{game.characters.map((c) => (
						<span key={c} className="rounded bg-muted px-1.5 py-0.5 text-xs">{c}</span>
					))}
				</div>
			)}
			<Button variant="outline" size="sm" asChild>
				<a href={game.url} target="_blank" rel="noopener noreferrer">
					{t('readFull')}
					<ExternalLink className="ml-1.5 h-3.5 w-3.5" />
				</a>
			</Button>
		</div>
	)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/components/super-retrogamers-preview.tsx
git commit -m "feat(sr): add SuperRetrogamersPreview component"
```

---

## Task 14: GameCard — SR chip in meta row

**Files:**
- Modify: `apps/dashboard/components/game-card.tsx`

- [ ] **Step 1: Add SR chip to GameCard**

In `apps/dashboard/components/game-card.tsx`:

1. Add import after existing imports:
```typescript
import { SuperRetrogamersLink } from '@/components/super-retrogamers-link'
```

2. Update `Props` type:
```typescript
type Props = {
	game: Game
	hasAchievements?: boolean
}
```
(unchanged — `Game` type will now include `srHasPage` and `srUrl` from schema)

3. In the JSX, find the `<div className="mt-1 flex items-center gap-1.5 flex-wrap">` block and add after the `playCount` span:

```tsx
{game.srHasPage === 1 && (
	<SuperRetrogamersLink
		srHasPage={game.srHasPage}
		srUrl={game.srUrl}
		variant="badge"
		romPath={game.romPath}
	/>
)}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/components/game-card.tsx
git commit -m "feat(sr): add SR chip to GameCard meta row"
```

---

## Task 15: NowPlaying — SR icon button

**Files:**
- Modify: `apps/dashboard/components/now-playing.tsx`

- [ ] **Step 1: Add SR button to NowPlaying GameCard**

In `apps/dashboard/components/now-playing.tsx`:

1. Add import:
```typescript
import { SuperRetrogamersLink } from '@/components/super-retrogamers-link'
```

2. Add state for SR info in the `GameCard` component (the local one inside now-playing.tsx):

Replace the `function GameCard({ game }: { game: GameStartEvent })` component with:

```typescript
function GameCard({ game }: { game: GameStartEvent }) {
	const elapsed = useElapsedTime(game.startedAt)
	const imageUrl = game.imagePath ? `/api/media?path=${encodeURIComponent(game.imagePath)}` : null
	const [srInfo, setSrInfo] = useState<{ srHasPage: number | null; srUrl: string | null }>({
		srHasPage: null,
		srUrl: null,
	})

	useEffect(() => {
		fetch(`/api/super-retrogamers/game-info?romPath=${encodeURIComponent(game.romPath)}`)
			.then((r) => r.json())
			.then((data: { srHasPage: number | null; srUrl: string | null }) => setSrInfo(data))
			.catch(() => {})
	}, [game.romPath])

	return (
		<Card className="overflow-hidden">
			<CardContent className="p-0">
				<div className="flex gap-4 p-4">
					<div className="shrink-0 w-24 h-24 rounded-md overflow-hidden bg-muted flex items-center justify-center">
						{imageUrl ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={imageUrl}
								alt={game.gameName}
								className="w-full h-full object-cover"
								onError={(e) => {
									e.currentTarget.style.display = 'none'
								}}
							/>
						) : (
							<Gamepad2 className="size-10 text-muted-foreground" />
						)}
					</div>
					<div className="flex flex-col justify-between min-w-0">
						<div className="space-y-1">
							<LiveBadge />
							<p className="font-semibold leading-tight truncate">{game.gameName}</p>
							<div className="flex items-center gap-2 flex-wrap">
								<Badge variant="secondary" className="text-xs">
									{game.systemFullName}
								</Badge>
								{game.emulator && (
									<span className="text-xs text-muted-foreground">{game.emulator}</span>
								)}
								{srInfo.srHasPage === 1 && (
									<SuperRetrogamersLink
										srHasPage={srInfo.srHasPage}
										srUrl={srInfo.srUrl}
										variant="icon"
									/>
								)}
							</div>
						</div>
						<p className="text-sm text-muted-foreground tabular-nums">{elapsed}</p>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/components/now-playing.tsx
git commit -m "feat(sr): add SR icon button to NowPlaying card"
```

---

## Task 16: TopGames — SR icon link

**Files:**
- Modify: `apps/dashboard/components/stats/top-games.tsx`

- [ ] **Step 1: Update TopGames GameEntry type and render SR link**

In `apps/dashboard/components/stats/top-games.tsx`:

1. Add import:
```typescript
import { SuperRetrogamersLink } from '@/components/super-retrogamers-link'
```

2. Update the `GameEntry` type:
```typescript
type GameEntry = {
	romPath: string
	gameName: string
	system: string
	playtimeSec: number
	sessionCount: number
	srHasPage?: number | null
	srUrl?: string | null
}
```

3. In the row JSX, after the `{game.system}` span, add:
```tsx
{game.srHasPage === 1 && (
	<SuperRetrogamersLink
		srHasPage={game.srHasPage}
		srUrl={game.srUrl ?? null}
		variant="icon"
	/>
)}
```

- [ ] **Step 2: Update the topGames query to include SR fields**

In `apps/dashboard/lib/db/queries.ts`, find the `topGamesRows` select (around line 434). The current select is:

```typescript
db
  .select({
    romPath: sessions.romPath,
    gameName: sql<string>`COALESCE(${games.name}, ${sessions.romPath})`,
    system: sessions.system,
    playtimeSec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)`,
    sessionCount: count(),
    lastPlayed: sql<number>`MAX(${sessions.startedAt})`,
  })
  .from(sessions)
  .leftJoin(games, eq(sessions.romPath, games.romPath))
```

Add two fields to the select:

```typescript
  srHasPage: games.srHasPage,
  srUrl: games.srUrl,
```

Then update the `.map()` call (around line 465) to include them:

```typescript
topGames: topGamesRows.map((r) => ({
  romPath: r.romPath,
  gameName: r.gameName,
  system: r.system,
  playtimeSec: r.playtimeSec,
  sessionCount: r.sessionCount,
  lastPlayed: new Date(r.lastPlayed * 1000),
  srHasPage: r.srHasPage ?? null,
  srUrl: r.srUrl ?? null,
})),
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/stats/top-games.tsx
git commit -m "feat(sr): add SR icon link to TopGames component"
```

---

## Task 17: Settings — Integrations tab

**Files:**
- Modify: `apps/dashboard/app/[locale]/settings/page.tsx`

- [ ] **Step 1: Add SR form schema and tab component**

In `apps/dashboard/app/[locale]/settings/page.tsx`:

1. Add schema after `raFormSchema`:
```typescript
const srFormSchema = z.object({
	enabled: z.boolean(),
	apiUrl: z.string().max(256),
	preferredRegion: z.enum(['US', 'EU', 'JP', '']),
})
type SrForm = z.infer<typeof srFormSchema>
```

2. Add a new `IntegrationsTab` component before the `SettingsPage` function:

```typescript
function IntegrationsTab({ config }: { config: AppConfig }) {
	const t = useTranslations('settings.integrations')
	const tc = useTranslations('common')
	const [testing, setTesting] = useState(false)
	const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)
	const [enriching, setEnriching] = useState(false)
	const [enrichProgress, setEnrichProgress] = useState<string | null>(null)

	const form = useForm<SrForm>({
		resolver: zodResolver(srFormSchema),
		defaultValues: {
			enabled: config.superRetrogamers.enabled,
			apiUrl: config.superRetrogamers.apiUrl,
			preferredRegion: config.superRetrogamers.preferredRegion,
		},
	})

	const isDirty = form.formState.isDirty

	async function onSave(values: SrForm) {
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ superRetrogamers: values }),
			})
			if (!res.ok) throw new Error()
			const updated: AppConfig = await res.json()
			form.reset({
				enabled: updated.superRetrogamers.enabled,
				apiUrl: updated.superRetrogamers.apiUrl,
				preferredRegion: updated.superRetrogamers.preferredRegion,
			})
			toast.success(t('saved'))
		} catch {
			toast.error(t('saveError'))
		}
	}

	async function handleTest() {
		setTesting(true)
		setTestResult(null)
		try {
			const res = await fetch('/api/super-retrogamers/test-connection', { method: 'POST' })
			const data = await res.json()
			setTestResult(data)
		} catch {
			setTestResult({ ok: false, error: 'Network error' })
		} finally {
			setTesting(false)
		}
	}

	async function handleEnrich() {
		setEnriching(true)
		setEnrichProgress(null)
		try {
			const res = await fetch('/api/super-retrogamers/enrich-collection', { method: 'POST' })
			if (!res.body) return
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const lines = decoder.decode(value).split('\n').filter(Boolean)
				for (const line of lines) {
					try {
						const event = JSON.parse(line)
						if (event.type === 'progress') {
							setEnrichProgress(`${event.done} / ${event.total}`)
						} else if (event.type === 'complete') {
							setEnrichProgress(`${t('enrichDone', { matched: event.matched, total: event.total })}`)
						}
					} catch {}
				}
			}
		} catch {
			toast.error(t('enrichError'))
		} finally {
			setEnriching(false)
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
				<FormField
					control={form.control}
					name="enabled"
					render={({ field }) => (
						<FormItem className="flex items-center justify-between rounded-lg border p-3">
							<div>
								<FormLabel>{t('enabled')}</FormLabel>
								<FormDescription>{t('enabledHint')}</FormDescription>
							</div>
							<FormControl>
								<Switch checked={field.value} onCheckedChange={field.onChange} />
							</FormControl>
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="preferredRegion"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('preferredRegion')}</FormLabel>
							<FormControl>
								<Select onValueChange={field.onChange} defaultValue={field.value}>
									<SelectTrigger>
										<SelectValue placeholder={t('regionDefault')} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="">{t('regionDefault')}</SelectItem>
										<SelectItem value="US">US</SelectItem>
										<SelectItem value="EU">EU</SelectItem>
										<SelectItem value="JP">JP</SelectItem>
									</SelectContent>
								</Select>
							</FormControl>
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="apiUrl"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{t('apiUrl')}</FormLabel>
							<FormControl>
								<Input placeholder="https://super-retrogamers.com/api/v1" {...field} />
							</FormControl>
							<FormDescription>{t('apiUrlHint')}</FormDescription>
						</FormItem>
					)}
				/>
				<div className="flex gap-2 flex-wrap">
					<Button type="button" variant="outline" onClick={() => form.reset()} disabled={!isDirty}>
						{tc('cancel')}
					</Button>
					<Button type="submit" disabled={!isDirty}>
						{tc('save')}
					</Button>
					<Button type="button" variant="secondary" onClick={handleTest} disabled={testing}>
						{testing ? t('testing') : t('testConnection')}
					</Button>
					<Button type="button" variant="secondary" onClick={handleEnrich} disabled={enriching}>
						{enriching ? (enrichProgress ?? t('enriching')) : t('enrich')}
					</Button>
				</div>
				{testResult?.ok === true && (
					<Alert>
						<AlertDescription className="text-green-600">
							{t('testOk', { ms: testResult.latencyMs ?? 0 })}
						</AlertDescription>
					</Alert>
				)}
				{testResult?.ok === false && (
					<Alert variant="destructive">
						<AlertDescription>{testResult.error ?? t('testFailed')}</AlertDescription>
					</Alert>
				)}
			</form>
		</Form>
	)
}
```

3. Update the `SettingsPage` `TabsList` to `grid-cols-5` and add the new tab:

Replace:
```tsx
<TabsList className="grid w-full grid-cols-4">
```
With:
```tsx
<TabsList className="grid w-full grid-cols-5">
```

Add new tab trigger:
```tsx
<TabsTrigger value="integrations">{t('tabs.integrations')}</TabsTrigger>
```

Add new tab content (after the retroachievements TabsContent):
```tsx
<TabsContent value="integrations" className="mt-6">
	<Card>
		<CardHeader>
			<CardTitle>{t('integrations.cardTitle')}</CardTitle>
			<CardDescription>{t('integrations.cardDescription')}</CardDescription>
		</CardHeader>
		<CardContent>
			<IntegrationsTab config={config} />
		</CardContent>
	</Card>
</TabsContent>
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/[locale]/settings/page.tsx
git commit -m "feat(sr): add Integrations settings tab"
```

---

## Task 18: Translations

**Files:**
- Modify: `apps/dashboard/messages/en.json`
- Modify: `apps/dashboard/messages/fr.json`

- [ ] **Step 1: Add English translations**

In `apps/dashboard/messages/en.json`, add a new top-level key `"superRetrogamers"` (before or after `"power"`):

```json
"superRetrogamers": {
  "viewOnSr": "View on Super Retrogamers ↗",
  "noPage": "No page on Super Retrogamers",
  "check": "Check",
  "preview": {
    "notFound": "No page found on Super Retrogamers",
    "error": "Could not load the page",
    "retry": "Retry",
    "stale": "Cached data — Super Retrogamers is unreachable",
    "readFull": "Read full article ↗"
  }
}
```

In the `"settings"` object, add `"integrations"` to the `"tabs"` sub-object:

```json
"tabs": {
  "recalbox": "Recalbox",
  "scrobble": "Scrobble",
  "interface": "Interface",
  "retroachievements": "RetroAchievements",
  "integrations": "Integrations"
}
```

Still in `"settings"`, add a new `"integrations"` sub-object (alongside `"recalbox"`, `"scrobble"`, etc.):

```json
"integrations": {
  "cardTitle": "Integrations",
  "cardDescription": "Connect the dashboard to Super Retrogamers encyclopedia",
  "enabled": "Enable Super Retrogamers integration",
  "enabledHint": "Show links and preview cards for games that have a page on Super Retrogamers",
  "preferredRegion": "Preferred region",
  "regionDefault": "No preference",
  "apiUrl": "API URL (optional)",
  "apiUrlHint": "Override the default Super Retrogamers API endpoint",
  "testConnection": "Test connection",
  "testing": "Testing…",
  "testOk": "Connected — {ms}ms",
  "testFailed": "Connection failed",
  "enrich": "Enrich collection",
  "enriching": "Enriching…",
  "enrichDone": "{matched} matched out of {total} games",
  "enrichError": "Enrichment failed",
  "saved": "Saved",
  "saveError": "Failed to save"
}
```

- [ ] **Step 2: Add French translations**

In `apps/dashboard/messages/fr.json`, add the same top-level key:

```json
"superRetrogamers": {
  "viewOnSr": "Voir sur Super Retrogamers ↗",
  "noPage": "Pas de fiche sur Super Retrogamers",
  "check": "Vérifier",
  "preview": {
    "notFound": "Aucune fiche trouvée sur Super Retrogamers",
    "error": "Impossible de charger la fiche",
    "retry": "Réessayer",
    "stale": "Données en cache — Super Retrogamers est inaccessible",
    "readFull": "Lire l’article complet ↗"
  }
}
```

Add `"integrations"` to `"settings.tabs"`:

```json
"integrations": "Intégrations"
```

Add `"settings.integrations"` sub-object:

```json
"integrations": {
  "cardTitle": "Intégrations",
  "cardDescription": "Connectez le dashboard à l’encyclopédie Super Retrogamers",
  "enabled": "Activer l’intégration Super Retrogamers",
  "enabledHint": "Affiche des liens et des aperçus pour les jeux disposant d’une fiche sur Super Retrogamers",
  "preferredRegion": "Région préférée",
  "regionDefault": "Aucune préférence",
  "apiUrl": "URL de l’API (optionnel)",
  "apiUrlHint": "Remplace l’URL par défaut de l’API Super Retrogamers",
  "testConnection": "Tester la connexion",
  "testing": "Test en cours…",
  "testOk": "Connecté — {ms}ms",
  "testFailed": "Connexion échouée",
  "enrich": "Enrichir la collection",
  "enriching": "Enrichissement…",
  "enrichDone": "{matched} jeux référencés sur {total}",
  "enrichError": "Enrichissement échoué",
  "saved": "Enregistré",
  "saveError": "Erreur lors de l’enregistrement"
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/messages/
git commit -m "feat(sr): add EN/FR translations for Super Retrogamers integration"
```

---

## Task 19: SR API spec doc

**Files:**
- Create: `docs/super-retrogamers-api-spec.md`

- [ ] **Step 1: Create API spec**

Create `docs/super-retrogamers-api-spec.md`:

```markdown
# Super Retrogamers Public API — Specification

Version: 1.0 (Draft)
Base URL: `https://super-retrogamers.com/api/v1`

## Requirements

- CORS: `Access-Control-Allow-Origin: *`
- Content-Type: `application/json`
- Cache-Control headers on all responses

## Game slug format

`{normalized-game-name}-console-{console-slug}`

Example: `super-mario-world-console-super-nintendo`

## Endpoints

### GET /games/exists?slug={slug}

Lightweight existence check. No body parsing, cacheable.

**Response 200:**
```json
{ "exists": true, "url": "https://super-retrogamers.com/games/super-mario-world-console-super-nintendo" }
```

**Response 200 (not found):**
```json
{ "exists": false }
```

Cache-Control: `public, max-age=86400` (24h)

---

### GET /games/:slug

Full game data.

**Response 200:**
```json
{
  "slug": "super-mario-world-console-super-nintendo",
  "name": "Super Mario World",
  "consoleSlug": "super-nintendo",
  "score": 95,
  "summary": "A platforming masterpiece...",
  "specs": {
    "release": "1990",
    "developer": "Nintendo",
    "genre": "Platformer"
  },
  "characters": ["Mario", "Yoshi", "Bowser"],
  "url": "https://super-retrogamers.com/games/super-mario-world-console-super-nintendo"
}
```

**Response 404:**
```json
{ "error": "Not found" }
```

Cache-Control: `public, max-age=43200` (12h)

---

### POST /games/lookup

Bulk existence check. Max 100 slugs per request.

**Request:**
```json
{ "slugs": ["super-mario-world-console-super-nintendo", "mega-man-7-console-super-nintendo"] }
```

**Response 200:**
```json
{
  "results": {
    "super-mario-world-console-super-nintendo": { "exists": true, "url": "..." },
    "mega-man-7-console-super-nintendo": { "exists": false }
  }
}
```

Cache-Control: `no-store` (results vary per slug set)

---

### GET /systems

List of all covered console systems.

**Response 200:**
```json
{
  "systems": [
    { "slug": "super-nintendo", "name": "Super Nintendo Entertainment System" },
    { "slug": "megadrive", "name": "Sega Mega Drive / Genesis" }
  ]
}
```

Cache-Control: `public, max-age=604800` (7 days)
```

- [ ] **Step 2: Commit**

```bash
git add docs/super-retrogamers-api-spec.md
git commit -m "docs(sr): add Super Retrogamers public API specification"
```

---

## Task 20: Final build verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: all existing tests pass + new slug and client tests pass.

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: zero TypeScript errors, build succeeds.

- [ ] **Step 3: Smoke test in dev**

```bash
pnpm dev
```

Open http://localhost:3000:
- Collection grid loads — SR chips absent (Phase 1, all `sr_has_page = NULL`)
- Settings → Integrations tab visible, toggle/save works
- "Test connection" returns `{ ok: true }` (mock client)
- "Enrichir la collection" streams progress to 0 matched (mock)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(integration): Super Retrogamers cross-project linking"
```
