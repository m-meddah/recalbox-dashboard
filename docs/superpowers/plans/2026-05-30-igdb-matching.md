# IGDB Matching Algorithm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-attempt IGDB matching pipeline with a single query that scores against `alternative_names`, stores top-5 candidates, and shows them in the review UI for 1-click selection.

**Architecture:** One IGDB `search` query per game fetching `alternative_names.name`; pure Levenshtein scoring against all name variants (ROM and IGDB alt names); thresholds 0.92 auto-confirm / 0.65–0.91 review / <0.65 not_found; `candidates` JSON column on `gameIgdbMapping` feeds a multi-candidate review UI.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), Next.js App Router, React, shadcn/ui, IGDB Apicalypse API, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/db/schema.ts` | Modify | Add `candidates` column + `alt_name` to enum |
| `drizzle/migrations/` | Generate | Additive migration for new column |
| `lib/igdb/match-game.ts` | Rewrite | Single-query pipeline, scoring, `IgdbCandidate` type |
| `lib/igdb/__tests__/match-game.test.ts` | Create | Unit tests for pure scoring functions |
| `lib/igdb/batch-match.ts` | Modify | Persist `candidates` JSON + update `NOT_FOUND_RESULT` |
| `lib/igdb/match-single.ts` | Modify | Persist `candidates` JSON |
| `app/api/igdb/review/route.ts` | Modify | Return parsed `candidates` in response |
| `app/[locale]/settings/igdb/review/page.tsx` | Rewrite | Multi-candidate selection UI |

---

## Task 1: Schema — add `candidates` column and `alt_name` method

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts:385-406`

- [ ] **Step 1: Add `candidates` column and `alt_name` to enum in schema**

In `apps/dashboard/lib/db/schema.ts`, find the `gameIgdbMapping` table definition and replace it:

```ts
export const gameIgdbMapping = sqliteTable(
	'game_igdb_mapping',
	{
		gameId: int('game_id').primaryKey(),
		igdbId: int('igdb_id'),
		igdbName: text('igdb_name'),
		matchConfidence: real('match_confidence'),
		matchMethod: text('match_method', {
			enum: ['exact_name', 'alt_name', 'cleaned_name', 'fuzzy', 'manual', 'not_found'],
		}),
		matchedAt: int('matched_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		needsReview: int('needs_review', { mode: 'boolean' }).notNull().default(false),
		candidates: text('candidates'),
	},
	(t) => ({
		igdbIdIdx: index('game_igdb_mapping_igdb_idx').on(t.igdbId),
		reviewIdx: index('game_igdb_mapping_review_idx').on(t.needsReview),
	}),
)
```

- [ ] **Step 2: Generate the Drizzle migration**

```bash
pnpm --filter @recalbox/dashboard drizzle-kit generate
```

Expected: a new file `apps/dashboard/drizzle/migrations/0016_*.sql` containing `ALTER TABLE game_igdb_mapping ADD COLUMN candidates text;`

- [ ] **Step 3: Apply the migration**

```bash
pnpm --filter @recalbox/dashboard drizzle-kit migrate
```

Expected: `✓ done` with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(igdb): add candidates column and alt_name method to schema"
```

---

## Task 2: Pure scoring functions — tests first

**Files:**
- Create: `apps/dashboard/lib/igdb/__tests__/match-game.test.ts`
- Modify: `apps/dashboard/lib/igdb/match-game.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/dashboard/lib/igdb/__tests__/match-game.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { scoreAndRankCandidates } from '../match-game'

describe('scoreAndRankCandidates', () => {
	it('scores an exact name match at 1.0', () => {
		const results = [{ id: 1, name: 'Street Fighter II' }]
		const scored = scoreAndRankCandidates(['Street Fighter II'], results)
		expect(scored[0]?.score).toBe(1)
		expect(scored[0]?.matchedAltName).toBe(false)
	})

	it('matches via alternative_names when main name differs', () => {
		const results = [
			{
				id: 1,
				name: 'Castlevania',
				alternative_names: [{ name: 'Akumajou Dracula' }],
			},
		]
		const scored = scoreAndRankCandidates(['Akumajou Dracula'], results)
		expect(scored[0]?.score).toBe(1)
		expect(scored[0]?.matchedAltName).toBe(true)
	})

	it('ranks the closest candidate first', () => {
		const results = [
			{ id: 1, name: 'Super Mario Bros 3' },
			{ id: 2, name: 'Mario Bros' },
		]
		const scored = scoreAndRankCandidates(['Mario Bros'], results)
		expect(scored[0]?.id).toBe(2)
	})

	it('uses the best score across multiple ROM variants', () => {
		const results = [{ id: 1, name: 'Street Fighter II' }]
		// variant with arabic numeral matches better than roman
		const scored = scoreAndRankCandidates(['Street Fighter 2', 'Street Fighter II'], results)
		expect(scored[0]?.score).toBe(1)
	})

	it('returns empty array for no results', () => {
		expect(scoreAndRankCandidates(['Sonic'], [])).toEqual([])
	})

	it('handles missing alternative_names gracefully', () => {
		const results = [{ id: 1, name: 'Pac-Man' }]
		const scored = scoreAndRankCandidates(['Pac-Man'], results)
		expect(scored[0]?.score).toBe(1)
	})
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/igdb/__tests__/match-game.test.ts
```

Expected: FAIL — `scoreAndRankCandidates is not a function` (not exported yet).

- [ ] **Step 3: Add types and export `scoreAndRankCandidates` to `match-game.ts`**

Replace the entire contents of `apps/dashboard/lib/igdb/match-game.ts` with:

```ts
import { db } from '@/lib/db'
import { igdbPlatformMapping } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generateNameVariants } from './clean-rom-name'
import { igdbQuery } from './client'

type IgdbGameSearchResult = {
	id: number
	name: string
	platforms?: number[]
	alternative_names?: { name: string }[]
}

export type IgdbCandidate = {
	igdbId: number
	igdbName: string
	confidence: number
}

export type MatchResult = {
	igdbId: number | null
	igdbName: string | null
	confidence: number
	method: 'exact_name' | 'alt_name' | 'cleaned_name' | 'fuzzy' | 'manual' | 'not_found'
	needsReview: boolean
	candidates: IgdbCandidate[]
}

type ScoredCandidate = {
	id: number
	name: string
	score: number
	matchedAltName: boolean
}

const EMPTY_RESULT: MatchResult = {
	igdbId: null,
	igdbName: null,
	confidence: 0,
	method: 'not_found',
	needsReview: false,
	candidates: [],
}

export async function matchGameToIgdb(params: {
	romName: string
	recalboxSystem: string
}): Promise<MatchResult> {
	const variants = generateNameVariants(params.romName)
	const primaryVariant = variants[0]
	if (!primaryVariant) return EMPTY_RESULT

	const platformMapping = await db
		.select()
		.from(igdbPlatformMapping)
		.where(eq(igdbPlatformMapping.recalboxSystem, params.recalboxSystem))
		.get()

	if (platformMapping) {
		const results = await searchWithAltNames(primaryVariant, platformMapping.igdbPlatformId)
		const scored = scoreAndRankCandidates(variants, results)
		return buildMatchResult(scored, false)
	}

	const results = await searchWithAltNamesNoPlatform(primaryVariant)
	const scored = scoreAndRankCandidates(variants, results)
	return buildMatchResult(scored, true)
}

export function scoreAndRankCandidates(
	variants: string[],
	results: IgdbGameSearchResult[],
): ScoredCandidate[] {
	return results
		.map((r) => {
			let best = Math.max(...variants.map((v) => similarity(v, r.name)))
			let matchedAltName = false

			for (const alt of r.alternative_names ?? []) {
				const altScore = Math.max(...variants.map((v) => similarity(v, alt.name)))
				if (altScore > best) {
					best = altScore
					matchedAltName = true
				}
			}

			return { id: r.id, name: r.name, score: best, matchedAltName }
		})
		.sort((a, b) => b.score - a.score)
}

function buildMatchResult(scored: ScoredCandidate[], noPlatform: boolean): MatchResult {
	const candidates: IgdbCandidate[] = scored
		.filter((s) => s.score >= 0.65)
		.slice(0, 5)
		.map((s) => ({ igdbId: s.id, igdbName: s.name, confidence: s.score }))

	const best = scored[0]
	if (!best || best.score < 0.65) return EMPTY_RESULT

	const confidence = noPlatform ? best.score * 0.7 : best.score

	if (confidence >= 0.92) {
		return {
			igdbId: best.id,
			igdbName: best.name,
			confidence,
			method: best.matchedAltName ? 'alt_name' : 'exact_name',
			needsReview: false,
			candidates,
		}
	}

	return {
		igdbId: best.id,
		igdbName: best.name,
		confidence,
		method: 'fuzzy',
		needsReview: true,
		candidates,
	}
}

async function searchWithAltNames(name: string, platformId: number): Promise<IgdbGameSearchResult[]> {
	const escaped = name.replace(/"/g, '\\"')
	const query = `
    fields id, name, platforms, alternative_names.name;
    search "${escaped}";
    where platforms = (${platformId});
    limit 10;
  `
	const result = await igdbQuery<IgdbGameSearchResult[]>('games', query)
	return result.ok ? result.data : []
}

async function searchWithAltNamesNoPlatform(name: string): Promise<IgdbGameSearchResult[]> {
	const escaped = name.replace(/"/g, '\\"')
	const query = `
    fields id, name, alternative_names.name;
    search "${escaped}";
    limit 5;
  `
	const result = await igdbQuery<IgdbGameSearchResult[]>('games', query)
	return result.ok ? result.data : []
}

function similarity(a: string, b: string): number {
	const la = a.toLowerCase()
	const lb = b.toLowerCase()
	if (la === lb) return 1
	const distance = levenshtein(la, lb)
	const maxLen = Math.max(la.length, lb.length)
	return maxLen === 0 ? 1 : 1 - distance / maxLen
}

function levenshtein(a: string, b: string): number {
	if (a.length === 0) return b.length
	if (b.length === 0) return a.length
	const prev = Array.from({ length: a.length + 1 }, (_, i) => i)
	const curr = new Array<number>(a.length + 1).fill(0)
	for (let i = 1; i <= b.length; i++) {
		curr[0] = i
		for (let j = 1; j <= a.length; j++) {
			const p = prev[j - 1] ?? 0
			const c = curr[j - 1] ?? 0
			const pj = prev[j] ?? 0
			curr[j] = b.charAt(i - 1) === a.charAt(j - 1) ? p : Math.min(p + 1, c + 1, pj + 1)
		}
		prev.splice(0, prev.length, ...curr)
	}
	return prev[a.length] ?? 0
}
```

- [ ] **Step 4: Run the tests again to confirm they pass**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/igdb/__tests__/match-game.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/igdb/match-game.ts apps/dashboard/lib/igdb/__tests__/match-game.test.ts
git commit -m "feat(igdb): rewrite match-game with alt_names scoring and candidates"
```

---

## Task 3: Update `batch-match.ts` and `match-single.ts` to persist candidates

**Files:**
- Modify: `apps/dashboard/lib/igdb/batch-match.ts`
- Modify: `apps/dashboard/lib/igdb/match-single.ts`

- [ ] **Step 1: Update `NOT_FOUND_RESULT` and the two insert calls in `batch-match.ts`**

In `apps/dashboard/lib/igdb/batch-match.ts`:

Replace `NOT_FOUND_RESULT`:
```ts
const NOT_FOUND_RESULT: MatchResult = {
	igdbId: null,
	igdbName: null,
	confidence: 0,
	method: 'not_found',
	needsReview: false,
	candidates: [],
}
```

In `runBatch`, find the `.values({...})` inside `db.insert(gameIgdbMapping)` and add the `candidates` field to both the `values` and `set` objects:

```ts
await db
  .insert(gameIgdbMapping)
  .values({
    gameId: game.id,
    igdbId: result.igdbId,
    igdbName: result.igdbName,
    matchConfidence: result.confidence,
    matchMethod: result.method,
    needsReview: result.needsReview,
    candidates: result.candidates.length > 0 ? JSON.stringify(result.candidates) : null,
  })
  .onConflictDoUpdate({
    target: gameIgdbMapping.gameId,
    set: {
      igdbId: result.igdbId,
      igdbName: result.igdbName,
      matchConfidence: result.confidence,
      matchMethod: result.method,
      needsReview: result.needsReview,
      candidates: result.candidates.length > 0 ? JSON.stringify(result.candidates) : null,
      matchedAt: new Date(),
    },
  })
```

- [ ] **Step 2: Update the insert in `match-single.ts`**

In `apps/dashboard/lib/igdb/match-single.ts`, find the `.values({...})` inside `db.insert(gameIgdbMapping)` and add:

```ts
await db
  .insert(gameIgdbMapping)
  .values({
    gameId,
    igdbId: result.igdbId,
    igdbName: result.igdbName,
    matchConfidence: result.confidence,
    matchMethod: result.method,
    needsReview: result.needsReview,
    candidates: result.candidates.length > 0 ? JSON.stringify(result.candidates) : null,
  })
  .onConflictDoNothing()
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/lib/igdb/batch-match.ts apps/dashboard/lib/igdb/match-single.ts
git commit -m "feat(igdb): persist top-5 candidates JSON in batch and async matchers"
```

---

## Task 4: Update the review GET API to return candidates

**Files:**
- Modify: `apps/dashboard/app/api/igdb/review/route.ts`

- [ ] **Step 1: Rewrite the review route to select and parse `candidates`**

Replace the entire file `apps/dashboard/app/api/igdb/review/route.ts`:

```ts
import { db } from '@/lib/db'
import { gameIgdbMapping, games } from '@/lib/db/schema'
import type { IgdbCandidate } from '@/lib/igdb/match-game'
import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const rows = await db
		.select({
			gameId: gameIgdbMapping.gameId,
			gameName: games.name,
			system: games.system,
			igdbId: gameIgdbMapping.igdbId,
			igdbName: gameIgdbMapping.igdbName,
			confidence: gameIgdbMapping.matchConfidence,
			method: gameIgdbMapping.matchMethod,
			candidatesRaw: gameIgdbMapping.candidates,
		})
		.from(gameIgdbMapping)
		.innerJoin(games, eq(games.id, gameIgdbMapping.gameId))
		.where(eq(gameIgdbMapping.needsReview, true))
		.orderBy(desc(gameIgdbMapping.matchConfidence))
		.all()

	const items = rows.map(({ candidatesRaw, ...row }) => ({
		...row,
		candidates: candidatesRaw
			? (JSON.parse(candidatesRaw) as IgdbCandidate[])
			: [],
	}))

	return NextResponse.json({ items })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/api/igdb/review/route.ts
git commit -m "feat(igdb): return candidates array from review GET endpoint"
```

---

## Task 5: Rewrite the review UI with multi-candidate selection

**Files:**
- Modify: `apps/dashboard/app/[locale]/settings/igdb/review/page.tsx`

- [ ] **Step 1: Rewrite the review page**

Replace the entire file `apps/dashboard/app/[locale]/settings/igdb/review/page.tsx`:

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type IgdbCandidate = {
	igdbId: number
	igdbName: string
	confidence: number
}

type ReviewItem = {
	gameId: number
	gameName: string
	system: string
	igdbId: number | null
	igdbName: string | null
	confidence: number | null
	method: string | null
	candidates: IgdbCandidate[]
}

export default function IgdbReviewPage() {
	const t = useTranslations('settings')
	const router = useRouter()
	const [items, setItems] = useState<ReviewItem[]>([])
	const [loading, setLoading] = useState(true)
	const [acting, setActing] = useState<number | null>(null)

	useEffect(() => {
		fetch('/api/igdb/review')
			.then((r) => r.json())
			.then((data: { items: ReviewItem[] }) => {
				setItems(data.items)
				setLoading(false)
			})
			.catch(() => setLoading(false))
	}, [])

	async function handleSelect(gameId: number, candidate: IgdbCandidate) {
		setActing(gameId)
		await fetch('/api/igdb/review/confirm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				gameId,
				action: 'manual',
				igdbId: candidate.igdbId,
				igdbName: candidate.igdbName,
			}),
		})
		setItems((prev) => prev.filter((item) => item.gameId !== gameId))
		setActing(null)
	}

	async function handleReject(gameId: number) {
		setActing(gameId)
		await fetch('/api/igdb/review/confirm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ gameId, action: 'reject' }),
		})
		setItems((prev) => prev.filter((item) => item.gameId !== gameId))
		setActing(null)
	}

	return (
		<div className="container max-w-4xl mx-auto p-6 space-y-6">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" onClick={() => router.back()}>
					<ArrowLeft className="w-4 h-4 mr-1" />
					{t('igdbReview.back')}
				</Button>
				<div>
					<h1 className="text-2xl font-bold">{t('igdbReview.title')}</h1>
					<p className="text-sm text-muted-foreground">{t('igdbReview.subtitle')}</p>
				</div>
			</div>

			{loading && <p className="text-muted-foreground text-sm">{t('igdbReview.loading')}</p>}

			{!loading && items.length === 0 && (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground text-sm">
						{t('igdbReview.allGood')}
					</CardContent>
				</Card>
			)}

			{!loading && items.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>{t('igdbReview.pendingTitle', { count: items.length })}</CardTitle>
					</CardHeader>
					<CardContent className="p-0">
						<div className="divide-y">
							{items.map((item) => (
								<div key={item.gameId} className="px-4 py-4 space-y-3">
									<div>
										<p className="font-medium text-sm">{item.gameName}</p>
										<p className="text-xs text-muted-foreground">{item.system}</p>
									</div>

									{item.candidates.length > 0 ? (
										<div className="space-y-1.5">
											{item.candidates.map((candidate, i) => (
												<div
													key={candidate.igdbId}
													className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
												>
													<div className="flex-1 min-w-0">
														<span className="truncate">{candidate.igdbName}</span>
													</div>
													<Badge variant={i === 0 ? 'default' : 'secondary'} className="text-xs shrink-0">
														{Math.round(candidate.confidence * 100)}%
													</Badge>
													<Button
														size="sm"
														variant={i === 0 ? 'default' : 'outline'}
														disabled={acting === item.gameId}
														onClick={() => handleSelect(item.gameId, candidate)}
													>
														<Check className="w-3.5 h-3.5" />
													</Button>
												</div>
											))}
											<Button
												size="sm"
												variant="ghost"
												className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
												disabled={acting === item.gameId}
												onClick={() => handleReject(item.gameId)}
											>
												<X className="w-3.5 h-3.5 mr-1" />
												{t('igdbReview.none')}
											</Button>
										</div>
									) : (
										<div className="flex items-center gap-3 text-sm">
											<span className="flex-1 text-muted-foreground truncate">
												{item.igdbName ?? '—'}
												{item.confidence != null && (
													<span className="text-xs ml-1">
														({Math.round(item.confidence * 100)}%)
													</span>
												)}
											</span>
											<Button
												size="sm"
												variant="outline"
												className="text-green-600 border-green-200 hover:bg-green-50"
												disabled={acting === item.gameId}
												onClick={() =>
													item.igdbId && item.igdbName
														? handleSelect(item.gameId, { igdbId: item.igdbId, igdbName: item.igdbName, confidence: item.confidence ?? 0 })
														: handleReject(item.gameId)
												}
											>
												<Check className="w-3.5 h-3.5" />
											</Button>
											<Button
												size="sm"
												variant="outline"
												className="text-red-600 border-red-200 hover:bg-red-50"
												disabled={acting === item.gameId}
												onClick={() => handleReject(item.gameId)}
											>
												<X className="w-3.5 h-3.5" />
											</Button>
										</div>
									)}
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
```

- [ ] **Step 2: Check that `igdbReview.none` key exists in translation files**

```bash
grep -n "none\|igdbReview" apps/dashboard/messages/en.json | head -20
grep -n "none\|igdbReview" apps/dashboard/messages/fr.json | head -20
```

If `igdbReview.none` is missing, add it to both files. In `en.json` inside the `igdbReview` object: `"none": "None / not found"`. In `fr.json`: `"none": "Aucun / non trouvé"`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @recalbox/dashboard tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: all existing tests pass, new match-game tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/[locale]/settings/igdb/review/page.tsx apps/dashboard/messages/
git commit -m "feat(igdb): multi-candidate selection in review UI"
```
