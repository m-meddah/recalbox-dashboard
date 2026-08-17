import type { ScoredGame } from './types'

const TARGET = 3

export function selectFinalists(scored: ScoredGame[]): ScoredGame[] {
	if (scored.length === 0) return []
	const sorted = dedupeByIdentity(scored.toSorted((a, b) => b.score - a.score))
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
 * Collapse duplicate ROM rows: the collection can hold several entries for one game
 * (regional variants, redumps, the same arcade board under two emulators), which
 * would otherwise let it fill two finalist slots. Keeping only (name, system) missed
 * the cross-emulator case — Top Hunter on `neogeo` and on `fbneo` are one game, not
 * two choices — so this dedupes on the identity key instead. The input is already
 * sorted by score, so the survivor is the highest-scored copy.
 */
function dedupeByIdentity(sorted: ScoredGame[]): ScoredGame[] {
	const seen = new Set<string>()
	const deduped: ScoredGame[] = []
	for (const g of sorted) {
		if (seen.has(g.identityKey)) continue
		seen.add(g.identityKey)
		deduped.push(g)
	}
	return deduped
}
