import { db } from '@/lib/db'
import { igdbPlatformMapping } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { cleanRomName, generateNameVariants } from './clean-rom-name'
import { igdbQuery } from './client'

type IgdbGameSearchResult = {
	id: number
	name: string
	platforms?: number[]
}

export type MatchResult = {
	igdbId: number | null
	igdbName: string | null
	confidence: number
	method: 'exact_name' | 'cleaned_name' | 'fuzzy' | 'not_found'
	needsReview: boolean
}

export async function matchGameToIgdb(params: {
	romName: string
	recalboxSystem: string
}): Promise<MatchResult> {
	const platformMapping = await db
		.select()
		.from(igdbPlatformMapping)
		.where(eq(igdbPlatformMapping.recalboxSystem, params.recalboxSystem))
		.get()

	if (!platformMapping) {
		return matchWithoutPlatform(params.romName)
	}

	const platformId = platformMapping.igdbPlatformId
	const variants = generateNameVariants(params.romName)
	const primaryVariant = variants[0]

	if (!primaryVariant) {
		return { igdbId: null, igdbName: null, confidence: 0, method: 'not_found', needsReview: false }
	}

	// Attempt 1: exact cleaned name + platform
	let results = await searchByName(primaryVariant, platformId)
	const first = results[0]
	if (results.length === 1 && first) {
		return { igdbId: first.id, igdbName: first.name, confidence: 1.0, method: 'exact_name', needsReview: false }
	}
	if (results.length > 1) {
		const sorted = results.sort((a, b) => a.name.length - b.name.length)
		const top = sorted[0]
		if (top) {
			return { igdbId: top.id, igdbName: top.name, confidence: 0.85, method: 'exact_name', needsReview: false }
		}
	}

	// Attempt 2: name variants (roman numerals, accents)
	for (const variant of variants.slice(1)) {
		results = await searchByName(variant, platformId)
		if (results.length >= 1) {
			const sorted = results.sort((a, b) => a.name.length - b.name.length)
			const top = sorted[0]
			if (top) {
				return { igdbId: top.id, igdbName: top.name, confidence: 0.8, method: 'cleaned_name', needsReview: false }
			}
		}
	}

	// Attempt 3: fuzzy search
	const fuzzy = await searchFuzzy(primaryVariant, platformId)
	if (fuzzy.length > 0) {
		const best = pickBestFuzzyMatch(primaryVariant, fuzzy)
		if (best) {
			return {
				igdbId: best.id,
				igdbName: best.name,
				confidence: best.confidence,
				method: 'fuzzy',
				needsReview: best.confidence < 0.7,
			}
		}
	}

	return { igdbId: null, igdbName: null, confidence: 0, method: 'not_found', needsReview: false }
}

async function searchByName(name: string, platformId: number): Promise<IgdbGameSearchResult[]> {
	const escaped = name.replace(/"/g, '\\"')
	const query = `
    fields id, name, platforms;
    where name ~ "${escaped}" & platforms = (${platformId});
    limit 10;
  `
	const result = await igdbQuery<IgdbGameSearchResult[]>('games', query)
	return result.ok ? result.data : []
}

async function searchFuzzy(name: string, platformId: number): Promise<IgdbGameSearchResult[]> {
	const escaped = name.replace(/"/g, '\\"')
	const query = `
    fields id, name, platforms;
    search "${escaped}";
    where platforms = (${platformId});
    limit 10;
  `
	const result = await igdbQuery<IgdbGameSearchResult[]>('games', query)
	return result.ok ? result.data : []
}

async function matchWithoutPlatform(romName: string): Promise<MatchResult> {
	const cleaned = cleanRomName(romName)
	const escaped = cleaned.replace(/"/g, '\\"')
	const query = `fields id, name; search "${escaped}"; limit 5;`
	const result = await igdbQuery<IgdbGameSearchResult[]>('games', query)

	if (!result.ok || result.data.length === 0) {
		return { igdbId: null, igdbName: null, confidence: 0, method: 'not_found', needsReview: false }
	}

	const best = pickBestFuzzyMatch(cleaned, result.data)
	if (!best) {
		return { igdbId: null, igdbName: null, confidence: 0, method: 'not_found', needsReview: false }
	}

	return {
		igdbId: best.id,
		igdbName: best.name,
		confidence: best.confidence * 0.7,
		method: 'fuzzy',
		needsReview: true,
	}
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

function pickBestFuzzyMatch(
	cleanedName: string,
	candidates: IgdbGameSearchResult[],
): { id: number; name: string; confidence: number } | null {
	if (candidates.length === 0) return null
	const scored = candidates
		.map((c) => ({ id: c.id, name: c.name, confidence: similarity(cleanedName, c.name) }))
		.sort((a, b) => b.confidence - a.confidence)
	const best = scored[0]
	if (!best || best.confidence < 0.5) return null
	return best
}
