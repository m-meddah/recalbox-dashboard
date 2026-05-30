import { generateNameVariants } from '@/lib/igdb/clean-rom-name'
import { type HltbSearchEntry, searchHltb } from './hltb-client'

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
		const results = await searchHltb(primaryVariant)
		const best = results[0]
		if (best && best.similarity >= 0.4) return toResult(best)

		for (const variant of variants.slice(1)) {
			const varResults = await searchHltb(variant)
			const varBest = varResults[0]
			if (varBest && varBest.similarity >= 0.4) return toResult(varBest)
		}
	} catch (_e) {
		return notFound()
	}

	return notFound()
}

function toResult(entry: HltbSearchEntry): HltbMatchResult {
	const sim = entry.similarity
	return {
		hltbId: entry.id,
		hltbName: entry.name,
		confidence: sim,
		method: sim >= 0.9 ? 'exact' : sim >= 0.7 ? 'cleaned' : 'fuzzy',
		needsReview: sim < 0.7,
		durations: {
			mainStory: entry.mainStorySeconds,
			mainExtras: entry.mainExtrasSeconds,
			completionist: entry.completionistSeconds,
		},
	}
}

function notFound(): HltbMatchResult {
	return { hltbId: null, hltbName: null, confidence: 0, method: 'not_found', needsReview: false }
}
