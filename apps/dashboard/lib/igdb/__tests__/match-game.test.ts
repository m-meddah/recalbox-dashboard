import { describe, expect, it } from 'vitest'
import { buildMatchResult, scoreAndRankCandidates } from '../match-game'
import type { ScoredCandidate } from '../match-game'

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

describe('buildMatchResult', () => {
	function candidate(score: number): ScoredCandidate {
		return { id: 1, name: 'Test Game', score, matchedAltName: false }
	}

	it('returns not_found when best score < 0.65', () => {
		const result = buildMatchResult([candidate(0.5)], false)
		expect(result.igdbId).toBeNull()
		expect(result.method).toBe('not_found')
		expect(result.candidates).toEqual([])
	})

	it('returns not_found for empty scored array', () => {
		const result = buildMatchResult([], false)
		expect(result.igdbId).toBeNull()
		expect(result.method).toBe('not_found')
	})

	it('auto-confirms at score >= 0.92 (with platform)', () => {
		const result = buildMatchResult([candidate(0.95)], false)
		expect(result.igdbId).toBe(1)
		expect(result.needsReview).toBe(false)
		expect(result.method).toBe('exact_name')
		expect(result.confidence).toBeCloseTo(0.95)
	})

	it('flags for review at score 0.65–0.91', () => {
		const result = buildMatchResult([candidate(0.80)], false)
		expect(result.igdbId).toBe(1)
		expect(result.needsReview).toBe(true)
		expect(result.method).toBe('fuzzy')
	})

	it('uses alt_name method when matchedAltName is true and score >= 0.92', () => {
		const scored: ScoredCandidate[] = [{ id: 1, name: 'Castlevania', score: 0.97, matchedAltName: true }]
		const result = buildMatchResult(scored, false)
		expect(result.method).toBe('alt_name')
		expect(result.needsReview).toBe(false)
	})

	it('applies 0.7 multiplier for noPlatform — never auto-confirms', () => {
		// score 1.0 * 0.7 = 0.70, which is below 0.92 threshold
		const result = buildMatchResult([candidate(1.0)], true)
		expect(result.confidence).toBeCloseTo(0.7)
		expect(result.needsReview).toBe(true)
		expect(result.method).toBe('fuzzy')
	})

	it('applies noPlatform multiplier to candidates confidence too', () => {
		const result = buildMatchResult([candidate(0.9)], true)
		expect(result.candidates[0]?.confidence).toBeCloseTo(0.63)
	})

	it('only includes candidates with score >= 0.65 (pre-multiplier)', () => {
		const scored: ScoredCandidate[] = [
			{ id: 1, name: 'Good', score: 0.9, matchedAltName: false },
			{ id: 2, name: 'Low', score: 0.5, matchedAltName: false },
		]
		const result = buildMatchResult(scored, false)
		expect(result.candidates).toHaveLength(1)
		expect(result.candidates[0]?.igdbId).toBe(1)
	})
})
