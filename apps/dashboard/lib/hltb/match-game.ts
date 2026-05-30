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
		const results = await service.search(primaryVariant)
		const best = results?.[0]
		if (best && best.similarity >= 0.4) return toResult(best)

		for (const variant of variants.slice(1)) {
			const varResults = await service.search(variant)
			const varBest = varResults?.[0]
			if (varBest && varBest.similarity >= 0.4) return toResult(varBest)
		}
	} catch (_e) {
		return notFound()
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
