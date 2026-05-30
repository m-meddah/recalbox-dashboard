import type { ScoredGame } from './types'

const TARGET = 3

export function selectFinalists(scored: ScoredGame[]): ScoredGame[] {
	if (scored.length === 0) return []
	const sorted = [...scored].sort((a, b) => b.score - a.score)
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
