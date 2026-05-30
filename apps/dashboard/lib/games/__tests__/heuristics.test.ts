import { describe, expect, it } from 'vitest'
import {
	hasBouncedWithoutCommitting,
	isComfortGame,
	isConfirmedTaste,
	isUntested,
	monthsSinceLastMeaningfulPlay,
} from '../heuristics'
import type { GamePlayStats } from '../play-stats'

function makeStats(overrides: Partial<GamePlayStats> = {}): GamePlayStats {
	return {
		gameId: 1,
		totalSessions: 0,
		measuredSessions: 0,
		totalPlaytimeSeconds: 0,
		noiseCount: 0,
		bounceCount: 0,
		tasteCount: 0,
		meaningfulCount: 0,
		marathonCount: 0,
		bounceRate: 0,
		significantSessions: 0,
		firstPlayedAt: null,
		lastPlayedAt: null,
		lastMeaningfulPlayAt: null,
		inherited: null,
		calibration: null,
		...overrides,
	}
}

describe('hasBouncedWithoutCommitting', () => {
	it('returns true with 2+ bounces and 0 significant sessions', () => {
		expect(hasBouncedWithoutCommitting(makeStats({ bounceCount: 2, significantSessions: 0 }))).toBe(
			true,
		)
	})

	it('returns false with 2 bounces but also a meaningful session', () => {
		expect(
			hasBouncedWithoutCommitting(
				makeStats({ bounceCount: 2, meaningfulCount: 1, significantSessions: 1 }),
			),
		).toBe(false)
	})

	it('returns false with only 1 bounce', () => {
		expect(hasBouncedWithoutCommitting(makeStats({ bounceCount: 1 }))).toBe(false)
	})
})

describe('isConfirmedTaste', () => {
	it('returns true with 3+ significant sessions', () => {
		expect(isConfirmedTaste(makeStats({ significantSessions: 3, meaningfulCount: 3 }))).toBe(true)
	})

	it('returns true with 1 marathon session', () => {
		expect(isConfirmedTaste(makeStats({ marathonCount: 1, significantSessions: 1 }))).toBe(true)
	})

	it('returns false with only 2 significant sessions and no marathon', () => {
		expect(isConfirmedTaste(makeStats({ significantSessions: 2, meaningfulCount: 2 }))).toBe(false)
	})
})

describe('isUntested', () => {
	it('returns true for null stats', () => {
		expect(isUntested(null)).toBe(true)
	})

	it('returns true when all measured sessions are noise', () => {
		expect(isUntested(makeStats({ measuredSessions: 3, noiseCount: 3 }))).toBe(true)
	})

	it('returns false when inherited playCount >= 3 and no measured sessions', () => {
		expect(isUntested(makeStats({ inherited: { playCount: 5, lastPlayedAt: new Date() } }))).toBe(
			false,
		)
	})

	it('returns true when inherited playCount < 3 and no real sessions', () => {
		expect(isUntested(makeStats({ inherited: { playCount: 2, lastPlayedAt: new Date() } }))).toBe(
			true,
		)
	})
})

describe('monthsSinceLastMeaningfulPlay', () => {
	it('returns Infinity when never played meaningfully', () => {
		expect(monthsSinceLastMeaningfulPlay(makeStats())).toBe(Infinity)
	})

	it('uses lastMeaningfulPlayAt when available', () => {
		const threeMonthsAgo = new Date()
		threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

		const months = monthsSinceLastMeaningfulPlay(
			makeStats({ lastMeaningfulPlayAt: threeMonthsAgo }),
		)
		expect(months).toBeGreaterThan(2.5)
		expect(months).toBeLessThan(3.5)
	})

	it('falls back to inherited lastPlayedAt', () => {
		const oneYearAgo = new Date()
		oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

		const months = monthsSinceLastMeaningfulPlay(
			makeStats({ inherited: { playCount: 5, lastPlayedAt: oneYearAgo } }),
		)
		expect(months).toBeGreaterThan(11)
		expect(months).toBeLessThan(13)
	})
})

describe('isComfortGame', () => {
	it('returns true with 5+ meaningful sessions', () => {
		expect(isComfortGame(makeStats({ meaningfulCount: 5 }))).toBe(true)
	})

	it('returns true with 2+ marathon sessions', () => {
		expect(isComfortGame(makeStats({ marathonCount: 2 }))).toBe(true)
	})

	it('returns false with 4 meaningful and 1 marathon', () => {
		expect(isComfortGame(makeStats({ meaningfulCount: 4, marathonCount: 1 }))).toBe(false)
	})
})
