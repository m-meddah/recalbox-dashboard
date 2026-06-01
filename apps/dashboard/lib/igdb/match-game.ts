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
	// 'cleaned_name' kept for backward compat with existing DB rows; no longer produced
	method: 'exact_name' | 'alt_name' | 'cleaned_name' | 'fuzzy' | 'manual' | 'not_found'
	needsReview: boolean
	candidates: IgdbCandidate[]
}

export type ScoredCandidate = {
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
	if (variants.length === 0) return []

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

export function buildMatchResult(scored: ScoredCandidate[], noPlatform: boolean): MatchResult {
	const multiplier = noPlatform ? 0.7 : 1

	const candidates: IgdbCandidate[] = scored
		.filter((s) => s.score >= 0.65)
		.slice(0, 5)
		.map((s) => ({ igdbId: s.id, igdbName: s.name, confidence: s.score * multiplier }))

	const best = scored[0]
	if (!best || best.score < 0.65) return EMPTY_RESULT

	// noPlatform applies a 0.7 multiplier (max confidence = 0.70), so the 0.90
	// threshold below is only reachable when platform is known.
	const confidence = best.score * multiplier

	if (confidence >= 0.90) {
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

async function searchWithAltNames(
	name: string,
	platformId: number,
): Promise<IgdbGameSearchResult[]> {
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
