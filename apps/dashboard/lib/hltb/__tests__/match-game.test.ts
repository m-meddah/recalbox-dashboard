import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HowLongToBeatEntry } from 'howlongtobeat'

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }))
vi.mock('howlongtobeat', () => ({
	HowLongToBeatService: vi.fn().mockImplementation(() => ({ search: mockSearch })),
}))

import { matchGameToHltb } from '../match-game'

function mockEntry(overrides: Partial<HowLongToBeatEntry> = {}): HowLongToBeatEntry {
	return {
		id: '123',
		name: 'Super Mario World',
		similarity: 0.95,
		gameplayMain: 1.5,
		gameplayMainExtra: 3.0,
		gameplayCompletionist: 5.0,
		imageUrl: '',
		searchTerm: '',
		timeLabels: [],
		description: '',
		platforms: [],
		playableOn: [],
		...overrides,
	} as HowLongToBeatEntry
}

beforeEach(() => mockSearch.mockReset())
afterEach(() => mockSearch.mockReset())

describe('matchGameToHltb', () => {
	it('returns not_found when search returns null', async () => {
		mockSearch.mockResolvedValue(null)
		const result = await matchGameToHltb('Unknown Game 9999')
		expect(result.method).toBe('not_found')
		expect(result.hltbId).toBeNull()
		expect(result.durations).toBeUndefined()
	})

	it('returns not_found when search returns empty array', async () => {
		mockSearch.mockResolvedValue([])
		const result = await matchGameToHltb('Unknown Game 9999')
		expect(result.method).toBe('not_found')
	})

	it('returns exact method when similarity >= 0.9', async () => {
		mockSearch.mockResolvedValue([mockEntry({ similarity: 0.95 })])
		const result = await matchGameToHltb('Super Mario World')
		expect(result.method).toBe('exact')
		expect(result.hltbId).toBe(123)
		expect(result.needsReview).toBe(false)
	})

	it('converts hours to seconds correctly', async () => {
		mockSearch.mockResolvedValue([mockEntry({ gameplayMain: 1.5, gameplayMainExtra: 3.0, gameplayCompletionist: 5.0 })])
		const result = await matchGameToHltb('Super Mario World')
		expect(result.durations?.mainStory).toBe(5400)
		expect(result.durations?.mainExtras).toBe(10800)
		expect(result.durations?.completionist).toBe(18000)
	})

	it('stores null when gameplay duration is 0 (unknown)', async () => {
		mockSearch.mockResolvedValue([mockEntry({ gameplayMain: 0, gameplayMainExtra: 0 })])
		const result = await matchGameToHltb('Obscure Game')
		expect(result.durations?.mainStory).toBeNull()
		expect(result.durations?.mainExtras).toBeNull()
	})

	it('returns fuzzy method and needsReview when similarity < 0.7', async () => {
		mockSearch.mockResolvedValue([mockEntry({ similarity: 0.5 })])
		const result = await matchGameToHltb('Some Game')
		expect(result.method).toBe('fuzzy')
		expect(result.needsReview).toBe(true)
	})

	it('returns not_found when similarity < 0.4', async () => {
		mockSearch.mockResolvedValue([mockEntry({ similarity: 0.2 })])
		const result = await matchGameToHltb('Some Game')
		expect(result.method).toBe('not_found')
		expect(result.hltbId).toBeNull()
	})

	it('returns not_found when search throws', async () => {
		mockSearch.mockImplementation(() => { throw new Error('network error') })
		const result = await matchGameToHltb('Super Mario World')
		expect(result.method).toBe('not_found')
	})
})
