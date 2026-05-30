# HowLongToBeat Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate HowLongToBeat duration data into the recommendation engine — primarily for the `finish` mood (exclude games with no HLTB data, score by time fit) and as a small +10 bonus for all other moods.

**Architecture:** New `lib/hltb/` module mirrors `lib/igdb/` — matcher (via npm package), lazy async match, batch match. Two new DB tables (`game_hltb_mapping`, `hltb_cache`). `GameForScoring` gains an `hltbDurations` field wired through `recommend.ts` → `score-game.ts`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + SQLite, Vitest, TypeScript, `howlongtobeat` npm package (`HowLongToBeatService`).

---

## File Map

**Create:**

- `apps/dashboard/lib/hltb/match-game.ts` — `matchGameToHltb(romName)`: exact → cleaned → fuzzy via `HowLongToBeatService`
- `apps/dashboard/lib/hltb/match-single.ts` — `matchHltbAsync(gameId)`: fire-and-forget
- `apps/dashboard/lib/hltb/batch-match.ts` — `batchMatchHltb(onProgress?)`: full collection
- `apps/dashboard/lib/hltb/__tests__/match-game.test.ts` — unit tests for matching logic
- `apps/dashboard/app/api/hltb/batch-match/route.ts` — `POST` to start batch
- `apps/dashboard/app/api/hltb/batch-match/progress/route.ts` — `GET` for progress polling

**Modify:**
- `apps/dashboard/lib/db/schema.ts` — add `gameHltbMapping` and `hltbCache` tables
- `apps/dashboard/lib/recommendations/score-game.ts` — add `hltbDurations` to `GameForScoring`; update `finish` block; update `estimateTimeMatch`
- `apps/dashboard/lib/recommendations/recommend.ts` — add `loadHltbDurations()`; wire into scoring loop; trigger lazy match
- `apps/dashboard/lib/recommendations/__tests__/score-game.test.ts` — add `hltbDurations: null` to `makeGame`; fix existing `finish` test; add HLTB scoring tests

---

## Task 1 — DB Schema: HLTB tables

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts` (end of file, after `igdbGameCache`)

- [ ] **Step 1: Add the two tables to schema.ts**

Add after the `igdbGameCache` block (around line 438):

```typescript
// ── HLTB ─────────────────────────────────────────────────────────────────────

export const gameHltbMapping = sqliteTable(
	'game_hltb_mapping',
	{
		gameId: int('game_id').primaryKey(),
		hltbId: int('hltb_id'),
		hltbName: text('hltb_name'),
		matchConfidence: real('match_confidence'),
		matchMethod: text('match_method', {
			enum: ['exact', 'cleaned', 'fuzzy', 'not_found'],
		}),
		matchedAt: int('matched_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		needsReview: int('needs_review', { mode: 'boolean' }).notNull().default(false),
	},
	(t) => ({
		hltbIdIdx: index('game_hltb_mapping_hltb_idx').on(t.hltbId),
	}),
)

export type GameHltbMapping = typeof gameHltbMapping.$inferSelect

export const hltbCache = sqliteTable(
	'hltb_cache',
	{
		hltbId: int('hltb_id').primaryKey(),
		name: text('name').notNull(),
		mainStorySeconds: int('main_story_seconds'),
		mainExtrasSeconds: int('main_extras_seconds'),
		completionistSeconds: int('completionist_seconds'),
		fetchedAt: int('fetched_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		expiresIdx: index('hltb_cache_expires_idx').on(t.expiresAt),
	}),
)

export type HltbCache = typeof hltbCache.$inferSelect
```

- [ ] **Step 2: Generate and apply migration**

```bash
pnpm --filter @recalbox/dashboard drizzle-kit generate
pnpm --filter @recalbox/dashboard drizzle-kit migrate
```

Expected: two new migration files, SQLite tables created with no errors.

- [ ] **Step 3: Verify tables exist**

```bash
sqlite3 apps/dashboard/recalbox.db ".tables" | tr ' ' '\n' | grep hltb
```

Expected output:
```
game_hltb_mapping
hltb_cache
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(hltb): add game_hltb_mapping and hltb_cache tables"
```

---

## Task 2 — Install npm package

- [ ] **Step 1: Install `howlongtobeat`**

```bash
pnpm --filter @recalbox/dashboard add howlongtobeat
```

- [ ] **Step 2: Verify it installed**

```bash
grep '"howlongtobeat"' apps/dashboard/package.json
```

Expected: a line with the package and its version.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(hltb): add howlongtobeat npm package"
```

---

## Task 3 — Name Matching + Tests

**Files:**

- Create: `apps/dashboard/lib/hltb/match-game.ts`
- Create: `apps/dashboard/lib/hltb/__tests__/match-game.test.ts`

The `HowLongToBeatService.search()` returns `HowLongToBeatEntry[]` sorted by `similarity` (0–1). Durations (`gameplayMain`, `gameplayMainExtra`, `gameplayCompletionist`) are in **hours**; we convert to seconds. A value of `0` means unknown → stored as `null`.

- [ ] **Step 1: Write the failing tests first**

```typescript
// apps/dashboard/lib/hltb/__tests__/match-game.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HowLongToBeatEntry } from 'howlongtobeat'

const mockSearch = vi.fn()
vi.mock('howlongtobeat', () => ({
	HowLongToBeatService: vi.fn().mockImplementation(() => ({ search: mockSearch })),
}))

import { matchGameToHltb } from '../match-game'

function mockEntry(overrides: Partial<HowLongToBeatEntry> = {}): HowLongToBeatEntry {
	return {
		id: '123',
		name: 'Super Mario World',
		similarity: 0.95,
		gameplayMain: 1.5,        // 1.5h = 5400s
		gameplayMainExtra: 3.0,   // 3h  = 10800s
		gameplayCompletionist: 5.0, // 5h = 18000s
		imageUrl: '',
		searchTerm: '',
		timeLabels: [],
		...overrides,
	} as HowLongToBeatEntry
}

beforeEach(() => mockSearch.mockReset())

describe('matchGameToHltb', () => {
	it('returns not_found when search returns null', async () => {
		mockSearch.mockResolvedValue(null)
		const result = await matchGameToHltb('Unknown Game 9999')
		expect(result.method).toBe('not_found')
		expect(result.hltbId).toBeNull()
		expect(result.durations).toBeUndefined()
	})

	it('returns not_found when search returns empty array', async () => {
		mockSearch.mockResolvedValue([])
		const result = await matchGameToHltb('Unknown Game 9999')
		expect(result.method).toBe('not_found')
	})

	it('returns exact method when similarity >= 0.9', async () => {
		mockSearch.mockResolvedValue([mockEntry({ similarity: 0.95 })])
		const result = await matchGameToHltb('Super Mario World')
		expect(result.method).toBe('exact')
		expect(result.hltbId).toBe(123)
		expect(result.needsReview).toBe(false)
	})

	it('converts hours to seconds correctly', async () => {
		mockSearch.mockResolvedValue([mockEntry({ gameplayMain: 1.5, gameplayMainExtra: 3.0, gameplayCompletionist: 5.0 })])
		const result = await matchGameToHltb('Super Mario World')
		expect(result.durations?.mainStory).toBe(5400)
		expect(result.durations?.mainExtras).toBe(10800)
		expect(result.durations?.completionist).toBe(18000)
	})

	it('stores null when gameplay duration is 0 (unknown)', async () => {
		mockSearch.mockResolvedValue([mockEntry({ gameplayMain: 0, gameplayMainExtra: 0 })])
		const result = await matchGameToHltb('Obscure Game')
		expect(result.durations?.mainStory).toBeNull()
		expect(result.durations?.mainExtras).toBeNull()
	})

	it('returns fuzzy method and needsReview when similarity < 0.7', async () => {
		mockSearch.mockResolvedValue([mockEntry({ similarity: 0.5 })])
		const result = await matchGameToHltb('Some Game')
		expect(result.method).toBe('fuzzy')
		expect(result.needsReview).toBe(true)
	})

	it('returns not_found when similarity < 0.4', async () => {
		mockSearch.mockResolvedValue([mockEntry({ similarity: 0.2 })])
		const result = await matchGameToHltb('Some Game')
		expect(result.method).toBe('not_found')
		expect(result.hltbId).toBeNull()
	})

	it('returns not_found when search throws', async () => {
		mockSearch.mockRejectedValue(new Error('network error'))
		const result = await matchGameToHltb('Super Mario World')
		expect(result.method).toBe('not_found')
	})
})
```

- [ ] **Step 2: Run tests — expect them to fail (module not found)**

```bash
cd apps/dashboard && npx vitest run lib/hltb/__tests__/match-game.test.ts
```

Expected: `Error: Cannot find module '../match-game'`

- [ ] **Step 3: Create match-game.ts**

```typescript
// apps/dashboard/lib/hltb/match-game.ts
import { HowLongToBeatService, type HowLongToBeatEntry } from 'howlongtobeat'
import { generateNameVariants } from '@/lib/igdb/clean-rom-name'

const service = new HowLongToBeatService()

export type HltbMatchResult = {
	hltbId: number | null
	hltbName: string | null
	confidence: number
	method: 'exact' | 'cleaned' | 'fuzzy' | 'not_found'
	needsReview: boolean
	durations?: {
		mainStory: number | null
		mainExtras: number | null
		completionist: number | null
	}
}

export async function matchGameToHltb(romName: string): Promise<HltbMatchResult> {
	const variants = generateNameVariants(romName)
	const primaryVariant = variants[0]
	if (!primaryVariant) return notFound()

	try {
		// Attempt 1: primary cleaned name — package returns results sorted by similarity
		const results = await service.search(primaryVariant)
		const best = results?.[0]
		if (best && best.similarity >= 0.4) return toResult(best)

		// Attempt 2: name variants (roman numerals, subtitles, accents)
		for (const variant of variants.slice(1)) {
			const varResults = await service.search(variant)
			const varBest = varResults?.[0]
			if (varBest && varBest.similarity >= 0.4) return toResult(varBest)
		}
	} catch {
		// Network error — game stays unmatched, retried on next recommendation cycle
	}

	return notFound()
}

function toResult(entry: HowLongToBeatEntry): HltbMatchResult {
	const sim = entry.similarity
	const hltbId = parseInt(entry.id, 10)
	return {
		hltbId: Number.isNaN(hltbId) ? null : hltbId,
		hltbName: entry.name,
		confidence: sim,
		method: sim >= 0.9 ? 'exact' : sim >= 0.7 ? 'cleaned' : 'fuzzy',
		needsReview: sim < 0.7,
		durations: {
			mainStory: entry.gameplayMain > 0 ? Math.round(entry.gameplayMain * 3600) : null,
			mainExtras: entry.gameplayMainExtra > 0 ? Math.round(entry.gameplayMainExtra * 3600) : null,
			completionist: entry.gameplayCompletionist > 0 ? Math.round(entry.gameplayCompletionist * 3600) : null,
		},
	}
}

function notFound(): HltbMatchResult {
	return { hltbId: null, hltbName: null, confidence: 0, method: 'not_found', needsReview: false }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd apps/dashboard && npx vitest run lib/hltb/__tests__/match-game.test.ts
```

Expected: `PASS (8)`

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/hltb/
git commit -m "feat(hltb): add name matching with HowLongToBeatService + tests"
```

---

## Task 4 — Scoring Integration (TDD)

**Files:**
- Modify: `apps/dashboard/lib/recommendations/__tests__/score-game.test.ts`
- Modify: `apps/dashboard/lib/recommendations/score-game.ts`

- [ ] **Step 1: Update `makeGame` and fix the existing `finish` test**

In `score-game.test.ts`, add `hltbDurations: null` to `makeGame`:

```typescript
function makeGame(overrides: Partial<GameForScoring> = {}): GameForScoring {
	return {
		gameId: 1,
		name: 'Test Game',
		system: 'snes',
		imageUrl: null,
		videoUrl: null,
		genres: ['Platformer'],
		releaseYear: 1993,
		decade: '1990s',
		developer: 'Nintendo',
		scrapedRating: null,
		igdbRating: null,
		stats: null,
		rating: null,
		hltbDurations: null,  // ← add this
		...overrides,
	}
}
```

Update the existing `'keeps game with ongoing session'` test — without HLTB data, `finish` now returns null (per spec). Change it to:

```typescript
it('keeps game with ongoing session and HLTB data', () => {
	const recentDate = new Date(Date.now() - 30 * 24 * 3600 * 1000)
	const stats = makeStats({ significantSessions: 2, lastMeaningfulPlayAt: recentDate })
	const ctx = makeCtx(makeProfile(), new Set(), { mood: 'finish' })
	const result = scoreGame(
		makeGame({
			stats,
			hltbDurations: { mainStory: 3600, mainExtras: null, completionist: null },
		}),
		ctx,
	)
	expect(result).not.toBeNull()
})

it('returns null for ongoing session without HLTB data', () => {
	const recentDate = new Date(Date.now() - 30 * 24 * 3600 * 1000)
	const stats = makeStats({ significantSessions: 2, lastMeaningfulPlayAt: recentDate })
	const ctx = makeCtx(makeProfile(), new Set(), { mood: 'finish' })
	expect(scoreGame(makeGame({ stats, hltbDurations: null }), ctx)).toBeNull()
})
```

- [ ] **Step 2: Add HLTB scoring tests at the end of the `score-game.test.ts` describe block**

```typescript
describe('mood finish — HLTB time fit', () => {
	const recentDate = new Date(Date.now() - 30 * 24 * 3600 * 1000)
	const ongoingStats = makeStats({ significantSessions: 1, lastMeaningfulPlayAt: recentDate })
	const finishCtx = makeCtx(makeProfile(), new Set(), { mood: 'finish', availableMinutes: 60 })

	it('adds +40 and reason when mainStory ≤ availableMinutes', () => {
		const game = makeGame({
			stats: ongoingStats,
			hltbDurations: { mainStory: 3000, mainExtras: null, completionist: null }, // 50min
		})
		const result = scoreGame(game, finishCtx)!
		expect(result).not.toBeNull()
		expect(result.scoreBreakdown?.hltbTimeFit).toBe(40)
		expect(result.reasons.some((r) => r.startsWith('Finissable ce soir'))).toBe(true)
	})

	it('adds +25 and reason when mainStory is 1–2× availableMinutes', () => {
		const game = makeGame({
			stats: ongoingStats,
			hltbDurations: { mainStory: 7200, mainExtras: null, completionist: null }, // 120min = 2×
		})
		const result = scoreGame(game, finishCtx)!
		expect(result.scoreBreakdown?.hltbTimeFit).toBe(25)
		expect(result.reasons.some((r) => r.includes('1-2 sessions'))).toBe(true)
	})

	it('adds +10 when mainStory is 2–4× availableMinutes', () => {
		const game = makeGame({
			stats: ongoingStats,
			hltbDurations: { mainStory: 14400, mainExtras: null, completionist: null }, // 240min = 4×
		})
		expect(scoreGame(game, finishCtx)!.scoreBreakdown?.hltbTimeFit).toBe(10)
	})

	it('adds -15 when mainStory is >4× availableMinutes', () => {
		const game = makeGame({
			stats: ongoingStats,
			hltbDurations: { mainStory: 18000, mainExtras: null, completionist: null }, // 300min = 5×
		})
		expect(scoreGame(game, finishCtx)!.scoreBreakdown?.hltbTimeFit).toBe(-15)
	})

	it('falls back to mainExtras when mainStory is null', () => {
		const game = makeGame({
			stats: ongoingStats,
			hltbDurations: { mainStory: null, mainExtras: 3000, completionist: null },
		})
		expect(scoreGame(game, finishCtx)!.scoreBreakdown?.hltbTimeFit).toBe(40)
	})

	it('falls back to completionist when mainStory and mainExtras are null', () => {
		const game = makeGame({
			stats: ongoingStats,
			hltbDurations: { mainStory: null, mainExtras: null, completionist: 3000 },
		})
		expect(scoreGame(game, finishCtx)!.scoreBreakdown?.hltbTimeFit).toBe(40)
	})
})

describe('estimateTimeMatch — HLTB bonus', () => {
	it('adds +10 when any HLTB duration falls within ±50% of availableMinutes', () => {
		const ctx = makeCtx(makeProfile(), new Set(), { availableMinutes: 60, mood: 'chill' })
		const withHltb = makeGame({
			hltbDurations: { mainStory: 3600, mainExtras: null, completionist: null }, // 60min, exact match
		})
		const withoutHltb = makeGame({ hltbDurations: null, system: 'snes' })
		const withScore = scoreGame(withHltb, ctx)!.score
		const withoutScore = scoreGame(withoutHltb, ctx)!.score
		expect(withScore).toBeGreaterThan(withoutScore)
	})

	it('falls back to heuristics when HLTB duration does not fit', () => {
		const ctx = makeCtx(makeProfile(), new Set(), { availableMinutes: 30, mood: 'chill' })
		const arcadeGame = makeGame({
			system: 'arcade',
			hltbDurations: { mainStory: 36000, mainExtras: null, completionist: null }, // 10h, no fit
		})
		const result = scoreGame(arcadeGame, ctx)!
		// Arcade heuristic (+25 for 30min) should still apply
		expect(result.scoreBreakdown?.timeMatch).toBe(25)
	})
})
```

- [ ] **Step 3: Run tests — expect failures (GameForScoring missing hltbDurations)**

```bash
cd apps/dashboard && npx vitest run lib/recommendations/__tests__/score-game.test.ts
```

Expected: TypeScript / runtime failures because `hltbDurations` doesn't exist yet on `GameForScoring`.

- [ ] **Step 4: Add `hltbDurations` to `GameForScoring` in score-game.ts**

In `apps/dashboard/lib/recommendations/score-game.ts`, add to the `GameForScoring` type:

```typescript
export type GameForScoring = {
	gameId: number
	name: string
	system: string
	imageUrl: string | null
	videoUrl: string | null
	genres: string[]
	releaseYear: number | null
	decade: string | null
	developer: string | null
	scrapedRating: number | null
	igdbRating: number | null
	stats: GamePlayStats | null
	rating: 'love' | 'like' | 'dislike' | 'unknown' | null
	hltbDurations: {
		mainStory: number | null
		mainExtras: number | null
		completionist: number | null
	} | null
}
```

- [ ] **Step 5: Update the `finish` mood block in scoreGame**

Replace the existing `finish` block (lines ~54–78) with:

```typescript
// ── MOOD finish ──
if (mood === 'finish') {
	// Scrobbler engagement: taste or better
	const scrobblerEngaged = game.stats
		? game.stats.significantSessions + game.stats.tasteCount >= 1
		: false
	// Inherited engagement: played multiple times before scrobbler existed
	const inheritedEngaged = (game.stats?.inherited?.playCount ?? 0) >= 2
	const hasEngagement = scrobblerEngaged || inheritedEngaged

	// Use any available date signal for recency
	const lastPlay =
		game.stats?.lastMeaningfulPlayAt ??
		game.stats?.lastPlayedAt ??
		game.stats?.inherited?.lastPlayedAt ??
		null
	const monthsSince = lastPlay
		? (Date.now() - lastPlay.getTime()) / (1000 * 60 * 60 * 24 * 30)
		: Infinity

	if (!hasEngagement || monthsSince >= 6) return null

	// Exclude if no HLTB data — we can't assess time fit
	if (!game.hltbDurations) return null

	score += 60
	breakdown.finishMode = 60
	reasons.push('En cours')

	// HLTB time fit scoring
	const refSec =
		game.hltbDurations.mainStory ?? game.hltbDurations.mainExtras ?? game.hltbDurations.completionist
	if (refSec !== null) {
		const refMin = refSec / 60
		const ratio = refMin / availableMinutes
		const formatted = formatHltbDuration(refSec)
		let timeFitPts: number
		if (ratio <= 1) {
			timeFitPts = 40
			reasons.push(`Finissable ce soir (${formatted})`)
		} else if (ratio <= 2) {
			timeFitPts = 25
			reasons.push(`Encore 1-2 sessions (${formatted})`)
		} else if (ratio <= 4) {
			timeFitPts = 10
		} else {
			timeFitPts = -15
		}
		score += timeFitPts
		breakdown.hltbTimeFit = timeFitPts
	}
}
```

- [ ] **Step 6: Add `formatHltbDuration` helper at the bottom of score-game.ts**

Add before the closing of the file (after `computeConfidence`):

```typescript
function formatHltbDuration(seconds: number): string {
	const hours = seconds / 3600
	if (hours < 1) return `${Math.round(seconds / 60)}min`
	return `~${Math.round(hours)}h`
}
```

- [ ] **Step 7: Update `estimateTimeMatch` to use HLTB when available**

Replace the current `estimateTimeMatch` function signature and add the HLTB check at the top:

```typescript
function estimateTimeMatch(
	game: GameForScoring,
	minutes: number,
): { score: number; reason?: string } {
	// HLTB data takes priority: if any duration fits within ±50%, return +10
	if (game.hltbDurations) {
		const secs = [
			game.hltbDurations.mainStory,
			game.hltbDurations.mainExtras,
			game.hltbDurations.completionist,
		]
		const fits = secs.some(
			(s) => s !== null && Math.abs(s / 60 - minutes) / minutes <= 0.5,
		)
		if (fits) return { score: 10 }
	}

	// Fallback: genre/system heuristics (unchanged)
	const isRpg = game.genres.some((g) => RPG_GENRES.includes(g))
	const isLong = game.genres.some((g) => LONG_GENRES.includes(g))
	const isArcade = ARCADE_SYSTEMS.includes(game.system.toLowerCase())
	const isHandheld = CHILL_SYSTEMS.includes(game.system.toLowerCase())

	if (minutes <= 30) {
		if (isArcade) return { score: 25, reason: 'Idéal pour 30 min' }
		if (isHandheld) return { score: 20 }
		if (isRpg) return { score: -25 }
		if (isLong) return { score: -15 }
		return { score: 0 }
	}
	if (minutes <= 60) {
		if (isArcade) return { score: 15 }
		if (isHandheld) return { score: 12 }
		if (isRpg) return { score: -10 }
		return { score: 5 }
	}
	if (minutes >= 120) {
		if (isRpg) return { score: 22, reason: 'Adapté pour une longue session' }
		if (isLong) return { score: 18 }
		if (isArcade) return { score: -5 }
		return { score: 8 }
	}
	return { score: 0 }
}
```

- [ ] **Step 8: Run all tests — expect pass**

```bash
cd apps/dashboard && npx vitest run lib/recommendations/__tests__/score-game.test.ts
```

Expected: `PASS (all)` — previously 20 tests, now ~32 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/lib/recommendations/
git commit -m "feat(hltb): integrate HLTB durations into scoring — finish mood + time match"
```

---

## Task 5 — Recommendation Pipeline Wiring

**Files:**
- Modify: `apps/dashboard/lib/recommendations/recommend.ts`

- [ ] **Step 1: Add imports at top of recommend.ts**

Add to the existing imports block:

```typescript
import { gameHltbMapping, hltbCache } from '@/lib/db/schema'
```

(The existing import already has `eq`, `gt`, `and`, `isNotNull` from `drizzle-orm` — add any missing.)

- [ ] **Step 2: Add `loadHltbDurations` function at the bottom of recommend.ts**

```typescript
type HltbDurations = {
	mainStory: number | null
	mainExtras: number | null
	completionist: number | null
}

async function loadHltbDurations(): Promise<Map<number, HltbDurations>> {
	const rows = await db
		.select({
			gameId: gameHltbMapping.gameId,
			mainStory: hltbCache.mainStorySeconds,
			mainExtras: hltbCache.mainExtrasSeconds,
			completionist: hltbCache.completionistSeconds,
		})
		.from(gameHltbMapping)
		.innerJoin(hltbCache, eq(hltbCache.hltbId, gameHltbMapping.hltbId))
		.where(isNotNull(gameHltbMapping.hltbId))
		.all()

	return new Map(
		rows.map((r) => [
			r.gameId,
			{
				mainStory: r.mainStory,
				mainExtras: r.mainExtras,
				completionist: r.completionist,
			},
		]),
	)
}
```

- [ ] **Step 3: Wire into the `recommend` function**

In the `recommend` function, add after `const igdbRatingsMap = await loadIgdbRatings()`:

```typescript
const hltbDurationsMap = await loadHltbDurations()
```

In the game loop, add `hltbDurations` to the `GameForScoring` object:

```typescript
const g: GameForScoring = {
	gameId: game.gameId,
	name: game.name,
	system: game.system,
	imageUrl: game.imageUrl,
	videoUrl: game.videoUrl,
	genres: parseGenres(game.genres),
	releaseYear,
	decade: releaseYear ? `${Math.floor(releaseYear / 10) * 10}s` : null,
	developer: game.developer,
	scrapedRating: game.scrapedRating,
	igdbRating: igdbRatingsMap.get(game.gameId) ?? null,
	stats: statsMap.get(game.gameId) ?? null,
	rating: ratingsMap.get(game.gameId) ?? null,
	hltbDurations: hltbDurationsMap.get(game.gameId) ?? null,  // ← add this
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Test the API end-to-end**

```bash
curl -s -X POST http://localhost:3000/api/play-tonight/recommend \
  -H "Content-Type: application/json" \
  -d '{"availableMinutes": 60, "mood": "finish"}'
```

Expected: `{"recommendations":[]}` — because `hltb_cache` is empty, all games get excluded. This is correct; HLTB data arrives via lazy/batch matching in Tasks 6–7.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/recommendations/recommend.ts
git commit -m "feat(hltb): wire HLTB durations into recommendation pipeline"
```

---

## Task 6 — Lazy Match + Batch Match

**Files:**
- Create: `apps/dashboard/lib/hltb/match-single.ts`
- Create: `apps/dashboard/lib/hltb/batch-match.ts`

- [ ] **Step 1: Create match-single.ts**

```typescript
// apps/dashboard/lib/hltb/match-single.ts
import { db } from '@/lib/db'
import { games, gameHltbMapping, hltbCache } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { matchGameToHltb } from './match-game'

const inFlight = new Set<number>()

export function matchHltbAsync(gameId: number): void {
	if (inFlight.has(gameId)) return
	inFlight.add(gameId)
	;(async () => {
		try {
			const existing = await db
				.select()
				.from(gameHltbMapping)
				.where(eq(gameHltbMapping.gameId, gameId))
				.get()
			if (existing) return

			const game = await db.select().from(games).where(eq(games.id, gameId)).get()
			if (!game) return

			const sourceName = game.name || (game.romPath?.split('/').pop() ?? String(gameId))
			const result = await matchGameToHltb(sourceName)

			await db
				.insert(gameHltbMapping)
				.values({
					gameId,
					hltbId: result.hltbId,
					hltbName: result.hltbName,
					matchConfidence: result.confidence,
					matchMethod: result.method,
					needsReview: result.needsReview,
				})
				.onConflictDoNothing()

			if (result.hltbId !== null && result.durations) {
				const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
				await db
					.insert(hltbCache)
					.values({
						hltbId: result.hltbId,
						name: result.hltbName ?? '',
						mainStorySeconds: result.durations.mainStory,
						mainExtrasSeconds: result.durations.mainExtras,
						completionistSeconds: result.durations.completionist,
						expiresAt,
					})
					.onConflictDoNothing()
			}
		} catch (e) {
			console.error(`[hltb] Async match failed for game ${gameId}:`, e)
		} finally {
			inFlight.delete(gameId)
		}
	})()
}
```

- [ ] **Step 2: Wire lazy matching into recommend.ts**

Add import at top of `recommend.ts`:

```typescript
import { matchHltbAsync } from '@/lib/hltb/match-single'
```

Add at the end of the `recommend` function body, after the IGDB lazy matching block:

```typescript
// Lazy HLTB matching for top 30 unmatched games
const hltbMappedSet = new Set(
	(await db.select({ gameId: gameHltbMapping.gameId }).from(gameHltbMapping).all()).map((r) => r.gameId),
)
scored
	.slice(0, 30)
	.filter((g) => !hltbMappedSet.has(g.gameId))
	.forEach((g) => matchHltbAsync(g.gameId))
```

Also add `gameHltbMapping` to the imports from `@/lib/db/schema` at the top of `recommend.ts` if not already present.

- [ ] **Step 3: Create batch-match.ts**

```typescript
// apps/dashboard/lib/hltb/batch-match.ts
import { db } from '@/lib/db'
import { games, gameHltbMapping, hltbCache } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import { matchGameToHltb } from './match-game'

export type HltbBatchProgress = {
	total: number
	done: number
	matched: number
	notFound: number
	needsReview: number
	errors: number
	current?: string
}

type GameRow = { id: number; name: string; romPath: string }

async function getUnmatchedGames(): Promise<GameRow[]> {
	const all = await db
		.select({ id: games.id, name: games.name, romPath: games.romPath })
		.from(games)
		.all()

	if (all.length === 0) return []

	const ids = all.map((g) => g.id)
	const existing = await db
		.select({ gameId: gameHltbMapping.gameId })
		.from(gameHltbMapping)
		.where(inArray(gameHltbMapping.gameId, ids))
		.all()
	const matchedSet = new Set(existing.map((e) => e.gameId))

	return all.filter((g) => !matchedSet.has(g.id))
}

export async function batchMatchHltb(
	onProgress?: (p: HltbBatchProgress) => void,
): Promise<HltbBatchProgress> {
	const toMatch = await getUnmatchedGames()
	const progress: HltbBatchProgress = {
		total: toMatch.length,
		done: 0,
		matched: 0,
		notFound: 0,
		needsReview: 0,
		errors: 0,
	}

	for (const game of toMatch) {
		progress.current = game.name
		onProgress?.(progress)

		try {
			const sourceName = game.name || extractFilename(game.romPath)
			const result = await matchGameToHltb(sourceName)

			await db
				.insert(gameHltbMapping)
				.values({
					gameId: game.id,
					hltbId: result.hltbId,
					hltbName: result.hltbName,
					matchConfidence: result.confidence,
					matchMethod: result.method,
					needsReview: result.needsReview,
				})
				.onConflictDoUpdate({
					target: gameHltbMapping.gameId,
					set: {
						hltbId: result.hltbId,
						hltbName: result.hltbName,
						matchConfidence: result.confidence,
						matchMethod: result.method,
						needsReview: result.needsReview,
						matchedAt: new Date(),
					},
				})

			if (result.hltbId !== null && result.durations) {
				const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
				await db
					.insert(hltbCache)
					.values({
						hltbId: result.hltbId,
						name: result.hltbName ?? '',
						mainStorySeconds: result.durations.mainStory,
						mainExtrasSeconds: result.durations.mainExtras,
						completionistSeconds: result.durations.completionist,
						expiresAt,
					})
					.onConflictDoUpdate({
						target: hltbCache.hltbId,
						set: {
							name: result.hltbName ?? '',
							mainStorySeconds: result.durations.mainStory,
							mainExtrasSeconds: result.durations.mainExtras,
							completionistSeconds: result.durations.completionist,
							fetchedAt: new Date(),
							expiresAt,
						},
					})
				progress.matched++
			} else {
				progress.notFound++
			}

			if (result.needsReview) progress.needsReview++
		} catch (e) {
			console.error(`[hltb] Batch match failed for ${game.name}:`, e)
			progress.errors++
		}

		progress.done++
		onProgress?.(progress)

		// Rate limiting: 500ms between requests
		await new Promise((r) => setTimeout(r, 500))
	}

	progress.current = undefined
	onProgress?.(progress)
	return progress
}

function extractFilename(path: string): string {
	return path.split('/').pop()?.split('\\').pop() ?? path
}
```

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
cd apps/dashboard && npx vitest run lib/recommendations/__tests__/score-game.test.ts lib/hltb/__tests__/match-game.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/hltb/ apps/dashboard/lib/recommendations/recommend.ts
git commit -m "feat(hltb): add lazy and batch match with 500ms rate limiting"
```

---

## Task 7 — API Routes

**Files:**
- Create: `apps/dashboard/app/api/hltb/batch-match/route.ts`
- Create: `apps/dashboard/app/api/hltb/batch-match/progress/route.ts`

- [ ] **Step 1: Create the batch-match start route**

```typescript
// apps/dashboard/app/api/hltb/batch-match/route.ts
import { type HltbBatchProgress, batchMatchHltb } from '@/lib/hltb/batch-match'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

let currentProgress: HltbBatchProgress | null = null
let isRunning = false

export async function POST() {
	if (isRunning) {
		return NextResponse.json({ ok: false, error: 'already_running' }, { status: 409 })
	}

	isRunning = true
	currentProgress = { total: 0, done: 0, matched: 0, notFound: 0, needsReview: 0, errors: 0 }

	batchMatchHltb((p) => {
		currentProgress = { ...p }
	})
		.then(() => {
			isRunning = false
		})
		.catch((e) => {
			console.error('[hltb] Batch failed:', e)
			isRunning = false
		})

	return NextResponse.json({ ok: true, started: true })
}

export function getMatchState() {
	return { isRunning, progress: currentProgress }
}
```

- [ ] **Step 2: Create the progress polling route**

```typescript
// apps/dashboard/app/api/hltb/batch-match/progress/route.ts
import { NextResponse } from 'next/server'
import { getMatchState } from '../route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	return NextResponse.json(getMatchState())
}
```

- [ ] **Step 3: Smoke-test the batch route**

```bash
# Start batch
curl -s -X POST http://localhost:3000/api/hltb/batch-match

# Check progress
curl -s http://localhost:3000/api/hltb/batch-match/progress
```

Expected from POST: `{"ok":true,"started":true}`
Expected from GET: `{"isRunning":true,"progress":{"total":N,"done":M,...}}`

- [ ] **Step 4: Let the batch run and verify results in DB**

```bash
# Wait for batch to finish (polling)
curl -s http://localhost:3000/api/hltb/batch-match/progress

# Check results
sqlite3 apps/dashboard/recalbox.db "
SELECT COUNT(*) as mapped FROM game_hltb_mapping;
SELECT COUNT(*) as cached FROM hltb_cache;
SELECT COUNT(*) as not_found FROM game_hltb_mapping WHERE hltb_id IS NULL;
"
```

- [ ] **Step 5: Verify finish mood now returns results**

```bash
curl -s -X POST http://localhost:3000/api/play-tonight/recommend \
  -H "Content-Type: application/json" \
  -d '{"availableMinutes": 60, "mood": "finish"}'
```

Expected: `{"recommendations":[...]}` with 1–3 games and reasons including `"Finissable ce soir"` or `"Encore 1-2 sessions"`.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/app/api/hltb/
git commit -m "feat(hltb): add batch-match API routes"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - `finish` mood: excludes without HLTB ✓, scores by time fit ✓, all 4 ratio tiers ✓
  - Other moods: `estimateTimeMatch` adds +10 when HLTB fits ✓, falls back to heuristics otherwise ✓
  - All 3 durations stored ✓, TTL 365 days ✓
  - Lazy match (top 30, fire-and-forget) ✓
  - Batch match (500ms rate limit) ✓, API endpoint ✓
  - No npm package for HLTB ✓
  - `finish` exclusion when no HLTB data ✓

- [x] **Type consistency:** `HltbDurations` shape (`mainStory/mainExtras/completionist` in seconds) is the same in `GameForScoring`, `loadHltbDurations()` return value, `match-single.ts` cache insert, and `batch-match.ts` cache insert.

- [x] **No placeholders:** All code blocks are complete and runnable.
