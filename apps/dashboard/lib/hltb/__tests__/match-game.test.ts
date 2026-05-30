import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HltbSearchEntry } from '../hltb-client'

const { mockSearchHltb } = vi.hoisted(() => ({ mockSearchHltb: vi.fn() }))
vi.mock('../hltb-client', () => ({ searchHltb: mockSearchHltb }))

import { matchGameToHltb } from '../match-game'

function mockEntry(overrides: Partial<HltbSearchEntry> = {}): HltbSearchEntry {
	return {
		id: 123,
		name: 'Super Mario World',
		similarity: 0.95,
		mainStorySeconds: 5400,
		mainExtrasSeconds: 10800,
		completionistSeconds: 18000,
		...overrides,
	}
}

beforeEach(() => mockSearchHltb.mockReset())
afterEach(() => mockSearchHltb.mockReset())

describe('matchGameToHltb', () => {
	it('returns not_found when search returns empty array', async () => {
		mockSearchHltb.mockResolvedValue([])
		const result = await matchGameToHltb('Unknown Game 9999')
		expect(result.method).toBe('not_found')
		expect(result.hltbId).toBeNull()
		expect(result.durations).toBeUndefined()
	})

	it('returns exact method when similarity >= 0.9', async () => {
		mockSearchHltb.mockResolvedValue([mockEntry({ similarity: 0.95 })])
		const result = await matchGameToHltb('Super Mario World')
		expect(result.method).toBe('exact')
		expect(result.hltbId).toBe(123)
		expect(result.needsReview).toBe(false)
	})

	it('passes durations through as-is (already in seconds)', async () => {
		mockSearchHltb.mockResolvedValue([
			mockEntry({ mainStorySeconds: 5400, mainExtrasSeconds: 10800, completionistSeconds: 18000 }),
		])
		const result = await matchGameToHltb('Super Mario World')
		expect(result.durations?.mainStory).toBe(5400)
		expect(result.durations?.mainExtras).toBe(10800)
		expect(result.durations?.completionist).toBe(18000)
	})

	it('passes null durations through when unknown', async () => {
		mockSearchHltb.mockResolvedValue([
			mockEntry({ mainStorySeconds: null, mainExtrasSeconds: null }),
		])
		const result = await matchGameToHltb('Obscure Game')
		expect(result.durations?.mainStory).toBeNull()
		expect(result.durations?.mainExtras).toBeNull()
	})

	it('returns fuzzy method and needsReview when similarity < 0.7', async () => {
		mockSearchHltb.mockResolvedValue([mockEntry({ similarity: 0.5 })])
		const result = await matchGameToHltb('Some Game')
		expect(result.method).toBe('fuzzy')
		expect(result.needsReview).toBe(true)
	})

	it('returns not_found when similarity < 0.4', async () => {
		mockSearchHltb.mockResolvedValue([mockEntry({ similarity: 0.2 })])
		const result = await matchGameToHltb('Some Game')
		expect(result.method).toBe('not_found')
		expect(result.hltbId).toBeNull()
	})

	it('returns not_found when search throws', async () => {
		mockSearchHltb.mockImplementation(() => {
			throw new Error('network error')
		})
		const result = await matchGameToHltb('Super Mario World')
		expect(result.method).toBe('not_found')
	})

	it('tries name variants when primary returns no match', async () => {
		// 'Zelda II (USA).nes' → primary='Zelda II', second variant='Zelda 2'
		mockSearchHltb
			.mockResolvedValueOnce([mockEntry({ similarity: 0.2 })]) // primary fails
			.mockResolvedValueOnce([mockEntry({ similarity: 0.85, name: 'Zelda 2' })]) // arabic variant matches
		const result = await matchGameToHltb('Zelda II (USA).nes')
		expect(result.method).toBe('cleaned')
		expect(result.hltbId).toBe(123)
	})
})
