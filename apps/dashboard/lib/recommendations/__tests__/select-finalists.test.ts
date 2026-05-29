import { describe, expect, it } from 'vitest'
import { selectFinalists } from '../select-finalists'
import type { ScoredGame } from '../types'

function makeScored(overrides: Partial<ScoredGame> & { gameId: number }): ScoredGame {
	return {
		name: `Game ${overrides.gameId}`,
		system: 'snes',
		imageUrl: null,
		videoUrl: null,
		genres: ['Platformer'],
		releaseYear: 1993,
		developer: 'Nintendo',
		score: 50,
		confidence: 'medium',
		reasons: [],
		lastPlayedAt: null,
		meaningfulSessionsCount: 0,
		...overrides,
	}
}

describe('selectFinalists', () => {
	it('returns empty for empty input', () => {
		expect(selectFinalists([])).toEqual([])
	})

	it('returns all when fewer than 3', () => {
		const input = [makeScored({ gameId: 1, score: 90 }), makeScored({ gameId: 2, score: 80 })]
		expect(selectFinalists(input)).toHaveLength(2)
	})

	it('picks top scorer first', () => {
		const input = [
			makeScored({ gameId: 1, score: 60 }),
			makeScored({ gameId: 2, score: 100 }),
			makeScored({ gameId: 3, score: 80 }),
			makeScored({ gameId: 4, score: 70 }),
		]
		const result = selectFinalists(input)
		expect(result[0]?.gameId).toBe(2)
	})

	it('diversifies by system on 2nd slot', () => {
		const input = [
			makeScored({ gameId: 1, score: 100, system: 'snes' }),
			makeScored({ gameId: 2, score: 90, system: 'snes' }),
			makeScored({ gameId: 3, score: 80, system: 'nes' }),
			makeScored({ gameId: 4, score: 70, system: 'gb' }),
		]
		const result = selectFinalists(input)
		expect(result[0]?.system).toBe('snes')
		expect(result[1]?.system).not.toBe('snes')
	})

	it('picks exploration card for 3rd slot when available', () => {
		const input = [
			makeScored({ gameId: 1, score: 100, system: 'snes', confidence: 'high' }),
			makeScored({ gameId: 2, score: 90, system: 'nes', confidence: 'high' }),
			makeScored({ gameId: 3, score: 60, system: 'gb', confidence: 'exploration' }),
			makeScored({ gameId: 4, score: 80, system: 'gb', confidence: 'medium' }),
		]
		const result = selectFinalists(input)
		expect(result[2]?.confidence).toBe('exploration')
	})

	it('returns exactly 3 when more than 3 candidates', () => {
		const input = Array.from({ length: 10 }, (_, i) =>
			makeScored({ gameId: i + 1, score: 100 - i }),
		)
		expect(selectFinalists(input)).toHaveLength(3)
	})
})
