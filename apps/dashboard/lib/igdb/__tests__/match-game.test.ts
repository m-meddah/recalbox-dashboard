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
