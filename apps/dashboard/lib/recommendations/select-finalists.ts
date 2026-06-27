import type { ScoredGame } from './types'

const TARGET = 3

export function selectFinalists(scored: ScoredGame[]): ScoredGame[] {
	if (scored.length === 0) return []
	const sorted = dedupeByNameAndSystem(scored.toSorted((a, b) => b.score - a.score))
	if (sorted.length <= TARGET) return sorted

	const first = sorted[0]
	if (!first) return []

	const result: ScoredGame[] = [first]

	const second = sorted.find((g) => !result.includes(g) && g.system !== first.system)
	result.push(second ?? sorted[1] ?? first)

	const exploration = sorted.find((g) => !result.includes(g) && g.confidence === 'exploration')
	if (exploration) {
		result.push(exploration)
	} else {
		const knownGenres = new Set(result.flatMap((r) => r.genres))
		const diverse = sorted.find(
			(g) => !result.includes(g) && g.genres.some((ge) => !knownGenres.has(ge)),
		)
		const fallback = sorted.find((g) => !result.includes(g))
		const third = diverse ?? fallback
		if (third) result.push(third)
	}

	return result
}

/**
 * Collapse duplicate ROM rows: the collection can hold several entries with the same
 * name on the same system (regional variants, redumps), which would otherwise let the
 * same game fill two finalist slots. Keep the first of each (name, system) — the input
 * is already sorted by score, so that's the highest-scored copy. Same-name games on
 * different systems are kept (they're genuinely different choices).
 */
function dedupeByNameAndSystem(sorted: ScoredGame[]): ScoredGame[] {
	const seen = new Set<string>()
	const deduped: ScoredGame[] = []
	for (const g of sorted) {
		const key = `${g.name}\t${g.system}`
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(g)
	}
	return deduped
}
