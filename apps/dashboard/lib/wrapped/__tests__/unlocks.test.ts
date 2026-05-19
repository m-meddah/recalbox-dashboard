import { describe, expect, it } from 'vitest'
import type { WrappedRawData } from '../types'
import { computeUnlocks } from '../unlocks'

function baseData(overrides: Partial<WrappedRawData> = {}): WrappedRawData {
	return {
		year: 2026,
		totalSessions: 50,
		totalDurationSec: 100 * 3600,
		uniqueGamesCount: 20,
		uniqueSystemsCount: 5,
		topGames: [
			{
				gameName: 'Zelda',
				system: 'snes',
				playtimeSec: 40 * 3600,
				sessionCount: 20,
				imagePath: null,
			},
			{
				gameName: 'Mario',
				system: 'nes',
				playtimeSec: 30 * 3600,
				sessionCount: 15,
				imagePath: null,
			},
			{
				gameName: 'Sonic',
				system: 'megadrive',
				playtimeSec: 30 * 3600,
				sessionCount: 15,
				imagePath: null,
			},
		],
		bySystem: [
			{ system: 'snes', playtimeSec: 40 * 3600 },
			{ system: 'nes', playtimeSec: 30 * 3600 },
			{ system: 'megadrive', playtimeSec: 30 * 3600 },
		],
		longestSession: { gameName: 'Zelda', durationSec: 3 * 3600, startedAt: new Date('2026-03-10') },
		busiestDay: { dateStr: '2026-03-10', totalSec: 6 * 3600, sessionCount: 3 },
		activeDays: ['2026-03-10', '2026-03-11'],
		shortSessionCount: 5,
		nightPlaySec: 5 * 3600,
		earlyBirdSec: 5 * 3600,
		weekendSec: 50 * 3600,
		throwbackGameSec: 10 * 3600,
		raAchievements: null,
		userPseudo: undefined,
		...overrides,
	}
}

describe('computeUnlocks', () => {
	it('returns empty array when totalDurationSec is 0', () => {
		const result = computeUnlocks(baseData({ totalDurationSec: 0, totalSessions: 0 }))
		expect(result).toEqual([])
	})

	it('unlocks night-owl when > 10% playtime is between 00:00–03:59', () => {
		const data = baseData({ nightPlaySec: 11 * 3600, totalDurationSec: 100 * 3600 })
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).toContain('night-owl')
	})

	it('does NOT unlock night-owl when <= 10% nighttime', () => {
		const data = baseData({ nightPlaySec: 9 * 3600, totalDurationSec: 100 * 3600 })
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).not.toContain('night-owl')
	})

	it('unlocks speedrunner when > 30 short sessions', () => {
		const ids = computeUnlocks(baseData({ shortSessionCount: 31 })).map((u) => u.id)
		expect(ids).toContain('speedrunner')
	})

	it('does NOT unlock speedrunner at exactly 30 short sessions', () => {
		const ids = computeUnlocks(baseData({ shortSessionCount: 30 })).map((u) => u.id)
		expect(ids).not.toContain('speedrunner')
	})

	it('unlocks marathon-man when longest session > 5h', () => {
		const data = baseData({
			longestSession: { gameName: 'Zelda', durationSec: 5 * 3600 + 1, startedAt: new Date() },
		})
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).toContain('marathon-man')
	})

	it('does NOT unlock marathon-man when no session > 5h', () => {
		const data = baseData({
			longestSession: { gameName: 'Zelda', durationSec: 5 * 3600, startedAt: new Date() },
		})
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).not.toContain('marathon-man')
	})

	it('unlocks diversified when > 15 different systems', () => {
		const ids = computeUnlocks(baseData({ uniqueSystemsCount: 16 })).map((u) => u.id)
		expect(ids).toContain('diversified')
	})

	it('unlocks monogame when top game > 50% of total time', () => {
		const data = baseData({
			totalDurationSec: 100 * 3600,
			topGames: [
				{
					gameName: 'Zelda',
					system: 'snes',
					playtimeSec: 51 * 3600,
					sessionCount: 30,
					imagePath: null,
				},
			],
		})
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).toContain('monogame')
	})

	it('unlocks completionist when > 100 unique games', () => {
		const ids = computeUnlocks(baseData({ uniqueGamesCount: 101 })).map((u) => u.id)
		expect(ids).toContain('completionist')
	})

	it('unlocks early-bird when > 30% playtime 05:00–08:59', () => {
		const data = baseData({ earlyBirdSec: 31 * 3600, totalDurationSec: 100 * 3600 })
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).toContain('early-bird')
	})

	it('unlocks weekend-warrior when > 70% playtime on Sat/Sun', () => {
		const data = baseData({ weekendSec: 71 * 3600, totalDurationSec: 100 * 3600 })
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).toContain('weekend-warrior')
	})

	it('unlocks throwback when > 20% playtime on games > 20 years old', () => {
		const data = baseData({ throwbackGameSec: 21 * 3600, totalDurationSec: 100 * 3600 })
		const ids = computeUnlocks(data).map((u) => u.id)
		expect(ids).toContain('throwback')
	})

	it('does NOT unlock achievement-hunter when RA disabled (raAchievements is null)', () => {
		const ids = computeUnlocks(baseData({ raAchievements: null })).map((u) => u.id)
		expect(ids).not.toContain('achievement-hunter')
		expect(ids).not.toContain('hardcore')
	})

	it('unlocks achievement-hunter when > 100 RA achievements', () => {
		const achievements = Array.from({ length: 101 }, (_, i) => ({
			title: `Ach ${i}`,
			points: 10,
			imageUrl: '',
			isHardcore: false,
		}))
		const ids = computeUnlocks(baseData({ raAchievements: achievements })).map((u) => u.id)
		expect(ids).toContain('achievement-hunter')
	})

	it('unlocks hardcore when > 80% of RA achievements are hardcore', () => {
		const achievements = [
			...Array.from({ length: 81 }, () => ({
				title: 'h',
				points: 10,
				imageUrl: '',
				isHardcore: true,
			})),
			...Array.from({ length: 19 }, () => ({
				title: 'n',
				points: 10,
				imageUrl: '',
				isHardcore: false,
			})),
		]
		const ids = computeUnlocks(baseData({ raAchievements: achievements })).map((u) => u.id)
		expect(ids).toContain('hardcore')
	})

	it('each unlock has required fields', () => {
		const unlocks = computeUnlocks(
			baseData({
				nightPlaySec: 15 * 3600,
				shortSessionCount: 35,
				longestSession: { gameName: 'X', durationSec: 6 * 3600, startedAt: new Date() },
				uniqueSystemsCount: 20,
				uniqueGamesCount: 110,
				earlyBirdSec: 35 * 3600,
				weekendSec: 75 * 3600,
				throwbackGameSec: 25 * 3600,
				totalDurationSec: 100 * 3600,
			}),
		)
		for (const u of unlocks) {
			expect(u.id).toBeTruthy()
			expect(u.title).toBeTruthy()
			expect(u.description).toBeTruthy()
			expect(['common', 'uncommon', 'rare', 'legendary']).toContain(u.rarity)
		}
	})
})
