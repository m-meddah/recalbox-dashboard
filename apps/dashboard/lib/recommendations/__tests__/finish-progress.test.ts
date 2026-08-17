import type { GamePlayStats } from '@/lib/games/play-stats'
import { describe, expect, it } from 'vitest'
import { assessFinishCandidate, formatDuration } from '../finish-progress'

const HOUR = 3600
const NOW = new Date('2026-08-17T12:00:00Z').getTime()
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000)

function makeStats(overrides: Partial<GamePlayStats> = {}): GamePlayStats {
	return {
		gameId: 1,
		totalSessions: 1,
		measuredSessions: 1,
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
		lastMeaningfulPlayAt: daysAgo(10),
		inherited: null,
		calibration: null,
		...overrides,
	}
}

const hltb = (mainStory: number | null) => ({
	mainStory,
	mainExtras: null,
	completionist: null,
})

describe('assessFinishCandidate', () => {
	describe('engagement floor', () => {
		it('rejects a game with no play stats at all', () => {
			expect(assessFinishCandidate(null, hltb(5 * HOUR), 60, NOW)).toEqual({ eligible: false })
		})

		it('rejects a game merely launched for three minutes', () => {
			// The old `playCount >= 2` rule with no time floor labelled these "in
			// progress": Top Hunter had 3 minutes on the clock and scored +60.
			const tried = makeStats({
				totalPlaytimeSeconds: 180,
				inherited: { playCount: 4, playTimeSeconds: 0, lastPlayedAt: daysAgo(10) },
			})
			expect(assessFinishCandidate(tried, hltb(2 * HOUR), 60, NOW)).toEqual({ eligible: false })
		})

		it('accepts a game at the 15-minute floor', () => {
			const stats = makeStats({ totalPlaytimeSeconds: 15 * 60 })
			expect(assessFinishCandidate(stats, hltb(2 * HOUR), 60, NOW).eligible).toBe(true)
		})

		it('accepts a short-but-significant session below the time floor', () => {
			const stats = makeStats({ totalPlaytimeSeconds: 300, significantSessions: 1 })
			expect(assessFinishCandidate(stats, hltb(2 * HOUR), 60, NOW).eligible).toBe(true)
		})

		it('counts inherited gamelist playtime towards the floor', () => {
			const stats = makeStats({
				totalPlaytimeSeconds: 0,
				inherited: { playCount: 3, playTimeSeconds: 40 * 60, lastPlayedAt: daysAgo(10) },
			})
			expect(assessFinishCandidate(stats, hltb(2 * HOUR), 60, NOW).eligible).toBe(true)
		})
	})

	describe('time fit on the time remaining', () => {
		it('ranks on what is left, not on the game total', () => {
			// A 5h game with 4h35 on the clock has 25 minutes left: finishable
			// tonight, even though its total length is five times the evening.
			const stats = makeStats({ totalPlaytimeSeconds: 16500, significantSessions: 1 })
			const result = assessFinishCandidate(stats, hltb(5 * HOUR), 60, NOW)
			if (!result.eligible) throw new Error('expected an eligible candidate')

			expect(result.breakdown.hltbTimeFit).toBe(40)
			expect(result.reasons).toContainEqual({
				key: 'finishableTonight',
				params: { duration: '25min' },
			})
		})

		it('demotes rather than drops a game far too long for tonight', () => {
			// The old rule returned null above 4×, which excluded every RPG by
			// construction and is what left only arcade shmups in the pool.
			const stats = makeStats({ totalPlaytimeSeconds: HOUR, significantSessions: 1 })
			const result = assessFinishCandidate(stats, hltb(100 * HOUR), 60, NOW)

			expect(result.eligible).toBe(true)
			if (!result.eligible) return
			expect(result.breakdown.hltbTimeFit).toBe(-15)
		})

		it('stays eligible with no HLTB reference at all', () => {
			// Dated past the 3-month mark so the recency rule leaves the generic
			// headline in place — this case is about the missing HLTB, nothing else.
			const stats = makeStats({
				totalPlaytimeSeconds: HOUR,
				significantSessions: 1,
				lastMeaningfulPlayAt: daysAgo(200),
			})
			const result = assessFinishCandidate(stats, null, 60, NOW)

			expect(result.eligible).toBe(true)
			if (!result.eligible) return
			expect(result.breakdown.finishMode).toBe(30)
			expect(result.breakdown.hltbTimeFit).toBeUndefined()
			expect(result.reasons).toContainEqual({ key: 'inProgress' })
		})

		it('falls back to mainExtras then completionist', () => {
			const stats = makeStats({ totalPlaytimeSeconds: HOUR, significantSessions: 1 })
			const extras = assessFinishCandidate(
				stats,
				{ mainStory: null, mainExtras: 90 * 60, completionist: null },
				60,
				NOW,
			)
			const completionist = assessFinishCandidate(
				stats,
				{ mainStory: null, mainExtras: null, completionist: 90 * 60 },
				60,
				NOW,
			)
			if (!extras.eligible || !completionist.eligible) throw new Error('expected eligible')
			expect(extras.breakdown.hltbTimeFit).toBe(40)
			expect(completionist.breakdown.hltbTimeFit).toBe(40)
		})
	})

	describe('progress bonus', () => {
		it('peaks across the 20-80% band', () => {
			const stats = makeStats({ totalPlaytimeSeconds: 5 * HOUR, significantSessions: 1 })
			const result = assessFinishCandidate(stats, hltb(10 * HOUR), 60, NOW)
			if (!result.eligible) throw new Error('expected an eligible candidate')
			expect(result.breakdown.finishProgress).toBe(20)
		})

		it('gives nothing to a barely-started game', () => {
			const stats = makeStats({ totalPlaytimeSeconds: 20 * 60, significantSessions: 1 })
			const result = assessFinishCandidate(stats, hltb(100 * HOUR), 60, NOW)
			if (!result.eligible) throw new Error('expected an eligible candidate')
			expect(result.breakdown.finishProgress).toBeUndefined()
		})

		it('announces a game past 90% and caps the displayed percentage at 99', () => {
			const stats = makeStats({ totalPlaytimeSeconds: 5 * HOUR - 60, significantSessions: 1 })
			const result = assessFinishCandidate(stats, hltb(5 * HOUR), 60, NOW)
			if (!result.eligible) throw new Error('expected an eligible candidate')
			expect(result.reasons).toContainEqual({ key: 'almostDone', params: { pct: 99 } })
		})

		it('stays quiet just under 90%', () => {
			// 4h20 of a 5h game — 86%, in progress but not "almost done".
			const stats = makeStats({ totalPlaytimeSeconds: 15600, significantSessions: 1 })
			const result = assessFinishCandidate(stats, hltb(5 * HOUR), 60, NOW)
			if (!result.eligible) throw new Error('expected an eligible candidate')
			expect(result.reasons.some((r) => r.key === 'almostDone')).toBe(false)
		})
	})

	describe('recency', () => {
		it('replaces the generic headline for a game touched in the last 3 months', () => {
			const stats = makeStats({
				totalPlaytimeSeconds: HOUR,
				significantSessions: 1,
				lastMeaningfulPlayAt: daysAgo(20),
			})
			const result = assessFinishCandidate(stats, hltb(2 * HOUR), 60, NOW)
			if (!result.eligible) throw new Error('expected an eligible candidate')

			expect(result.breakdown.finishRecent).toBe(10)
			expect(result.reasons[0]).toEqual({ key: 'resumeWhereYouLeftOff' })
			expect(result.reasons.some((r) => r.key === 'inProgress')).toBe(false)
		})

		it('keeps a game abandoned eight months ago — the whole point of the mood', () => {
			// The old hard cut at 6 months dropped exactly these.
			const stats = makeStats({
				totalPlaytimeSeconds: HOUR,
				significantSessions: 1,
				lastMeaningfulPlayAt: daysAgo(240),
			})
			const result = assessFinishCandidate(stats, hltb(2 * HOUR), 60, NOW)

			expect(result.eligible).toBe(true)
			if (!result.eligible) return
			expect(result.breakdown.finishRecent).toBeUndefined()
			expect(result.breakdown.finishStale).toBeUndefined()
			expect(result.reasons[0]).toEqual({ key: 'inProgress' })
		})

		it('proposes a three-year-old save, ranked last', () => {
			const stats = makeStats({
				totalPlaytimeSeconds: HOUR,
				significantSessions: 1,
				lastMeaningfulPlayAt: daysAgo(3 * 365),
			})
			const result = assessFinishCandidate(stats, hltb(2 * HOUR), 60, NOW)

			expect(result.eligible).toBe(true)
			if (!result.eligible) return
			expect(result.breakdown.finishStale).toBe(-10)
		})
	})
})

describe('formatDuration', () => {
	it('uses minutes below the hour and rounded hours above', () => {
		expect(formatDuration(25 * 60)).toBe('25min')
		expect(formatDuration(90 * 60)).toBe('~2h')
		expect(formatDuration(5 * HOUR)).toBe('~5h')
	})
})
