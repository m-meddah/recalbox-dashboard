import { describe, expect, it } from 'vitest'
import { buildSlides } from '../generator'
import type { WrappedRawData, WrappedUnlock } from '../types'

function emptyData(year = 2026): WrappedRawData {
	return {
		year,
		totalSessions: 0,
		totalDurationSec: 0,
		uniqueGamesCount: 0,
		uniqueSystemsCount: 0,
		topGames: [],
		bySystem: [],
		longestSession: null,
		busiestDay: null,
		activeDays: [],
		shortSessionCount: 0,
		nightPlaySec: 0,
		earlyBirdSec: 0,
		weekendSec: 0,
		throwbackGameSec: 0,
		raAchievements: null,
		userPseudo: undefined,
	}
}

function richData(): WrappedRawData {
	return {
		year: 2026,
		totalSessions: 100,
		totalDurationSec: 127 * 3600,
		uniqueGamesCount: 23,
		uniqueSystemsCount: 8,
		topGames: [
			{ gameName: 'Mario', system: 'nes', playtimeSec: 40 * 3600, sessionCount: 30, imagePath: '/games/mario.png' },
			{ gameName: 'Zelda', system: 'snes', playtimeSec: 30 * 3600, sessionCount: 20, imagePath: null },
			{ gameName: 'Sonic', system: 'megadrive', playtimeSec: 20 * 3600, sessionCount: 15, imagePath: null },
		],
		bySystem: [
			{ system: 'nes', playtimeSec: 40 * 3600 },
			{ system: 'snes', playtimeSec: 30 * 3600 },
		],
		longestSession: { gameName: 'Mario', durationSec: 4 * 3600 + 12 * 60, startedAt: new Date('2026-02-14') },
		busiestDay: { dateStr: '2026-02-14', totalSec: 8 * 3600, sessionCount: 5 },
		activeDays: ['2026-02-14', '2026-02-15', '2026-02-16'],
		shortSessionCount: 10,
		nightPlaySec: 5 * 3600,
		earlyBirdSec: 5 * 3600,
		weekendSec: 40 * 3600,
		throwbackGameSec: 10 * 3600,
		raAchievements: null,
		userPseudo: 'Madjid',
	}
}

describe('buildSlides', () => {
	it('returns only [intro, outro] for 0 sessions', () => {
		const slides = buildSlides(emptyData(), [])
		const types = slides.map((s) => s.type)
		expect(types).toEqual(['intro', 'outro'])
	})

	it('always includes intro as first slide', () => {
		const slides = buildSlides(richData(), [])
		expect(slides[0].type).toBe('intro')
	})

	it('always includes outro as last slide', () => {
		const slides = buildSlides(richData(), [])
		expect(slides.at(-1)!.type).toBe('outro')
	})

	it('includes total-time slide with correct hours', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'total-time')
		expect(slide).toBeDefined()
		if (slide?.type === 'total-time') {
			expect(slide.totalHours).toBe(127)
			expect(slide.totalSessions).toBe(100)
			expect(slide.comparisonMovies).toBe(Math.round(127 * 60 / 120))
		}
	})

	it('includes most-played-game slide', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'most-played-game')
		expect(slide).toBeDefined()
		if (slide?.type === 'most-played-game') {
			expect(slide.gameName).toBe('Mario')
			expect(slide.playtimeHours).toBe(40)
		}
	})

	it('includes top-games-list with up to 5 games', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'top-games-list')
		expect(slide).toBeDefined()
		if (slide?.type === 'top-games-list') {
			expect(slide.games.length).toBeGreaterThanOrEqual(1)
			expect(slide.games.length).toBeLessThanOrEqual(5)
			expect(slide.games[0].rank).toBe(1)
		}
	})

	it('includes longest-session slide', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'longest-session')
		expect(slide).toBeDefined()
		if (slide?.type === 'longest-session') {
			expect(slide.gameName).toBe('Mario')
			expect(slide.durationHours).toBe(4)
			expect(slide.durationMinutes).toBe(12)
		}
	})

	it('includes busiest-day slide', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'busiest-day')
		expect(slide).toBeDefined()
		if (slide?.type === 'busiest-day') {
			expect(slide.dateStr).toBe('2026-02-14')
			expect(slide.totalHours).toBe(8)
		}
	})

	it('includes streak slide when activeDays.length >= 2', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'streak')
		expect(slide).toBeDefined()
	})

	it('omits streak slide when activeDays.length < 2', () => {
		const data = richData()
		data.activeDays = ['2026-02-14']
		const slides = buildSlides(data, [])
		const slide = slides.find((s) => s.type === 'streak')
		expect(slide).toBeUndefined()
	})

	it('omits achievements-summary when raAchievements is null', () => {
		const data = richData()
		data.raAchievements = null
		const slides = buildSlides(data, [])
		const slide = slides.find((s) => s.type === 'achievements-summary')
		expect(slide).toBeUndefined()
	})

	it('includes achievements-summary when raAchievements is non-empty', () => {
		const data = richData()
		data.raAchievements = [{ title: 'Ach', points: 10, imageUrl: 'img.png', isHardcore: false }]
		const slides = buildSlides(data, [])
		const slide = slides.find((s) => s.type === 'achievements-summary')
		expect(slide).toBeDefined()
	})

	it('omits unlocks slide when unlocks array is empty', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'unlocks')
		expect(slide).toBeUndefined()
	})

	it('includes unlocks slide before outro when unlocks are non-empty', () => {
		const unlock = { id: 'marathon-man', title: 'Marathon Man', description: 'x', rarity: 'rare' as const }
		const slides = buildSlides(richData(), [unlock])
		const unlockIdx = slides.findIndex((s) => s.type === 'unlocks')
		const outroIdx = slides.findIndex((s) => s.type === 'outro')
		expect(unlockIdx).toBeGreaterThan(-1)
		expect(unlockIdx).toBeLessThan(outroIdx)
	})

	it('includes comparison-vs-others with correct percentile for 127h', () => {
		const slides = buildSlides(richData(), [])
		const slide = slides.find((s) => s.type === 'comparison-vs-others')
		expect(slide).toBeDefined()
		if (slide?.type === 'comparison-vs-others') {
			expect(slide.percentile).toBeLessThanOrEqual(15)
		}
	})

	it('outro has correct year and totalHours', () => {
		const slides = buildSlides(richData(), [])
		const outro = slides.find((s) => s.type === 'outro')
		if (outro?.type === 'outro') {
			expect(outro.year).toBe(2026)
			expect(outro.totalHours).toBe(127)
		}
	})

	it('top-games-list omitted when < 2 games played', () => {
		const data = richData()
		data.topGames = [{ gameName: 'Mario', system: 'nes', playtimeSec: 100, sessionCount: 1, imagePath: null }]
		const slides = buildSlides(data, [])
		expect(slides.find((s) => s.type === 'top-games-list')).toBeUndefined()
	})
})
