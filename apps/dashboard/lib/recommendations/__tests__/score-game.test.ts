import type { UserProfile, WeightedItem } from '@/lib/db/schema'
import type { GamePlayStats } from '@/lib/games/play-stats'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type GameForScoring, type ScoringContext, scoreGame } from '../score-game'
import type { RecommendationContext } from '../types'

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

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
	return {
		id: 1,
		systemsWeights: [],
		genresWeights: [],
		decadesWeights: [],
		developersWeights: [],
		comfortGames: [],
		bouncerGames: [],
		totalSignalSessions: 10,
		profileMaturity: 0.5,
		computedAt: null,
		computeDurationMs: null,
		...overrides,
	}
}

function makeCtx(
	profile: UserProfile = makeProfile(),
	similarToComfortGames: Set<number> = new Set(),
	ctxOverrides: Partial<RecommendationContext> = {},
): ScoringContext {
	return {
		profile,
		similarToComfortGames,
		recommendationCtx: {
			availableMinutes: 60,
			mood: 'surprise',
			excludedGameIds: [],
			...ctxOverrides,
		},
	}
}

function makeGame(overrides: Partial<GameForScoring> = {}): GameForScoring {
	return {
		gameId: 1,
		name: 'Test Game',
		system: 'snes',
		imageUrl: null,
		videoUrl: null,
		genres: ['Platformer'],
		releaseYear: 1993,
		decade: '1990s',
		developer: 'Nintendo',
		scrapedRating: null,
		igdbRating: null,
		stats: null,
		rating: null,
		hltbDurations: null,
		...overrides,
	}
}

const w = (key: string, weight: number): WeightedItem => ({ key, weight, rawScore: weight * 10 })

describe('scoreGame', () => {
	beforeEach(() => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5)
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('hard exclusions', () => {
		it('returns null for dislike', () => {
			expect(scoreGame(makeGame({ rating: 'dislike' }), makeCtx())).toBeNull()
		})

		it('returns null for excluded game id', () => {
			const ctx = makeCtx(makeProfile(), new Set(), { excludedGameIds: [1] })
			expect(scoreGame(makeGame({ gameId: 1 }), ctx)).toBeNull()
		})

		it('returns null for bouncer game (not love)', () => {
			const profile = makeProfile({ bouncerGames: [1] })
			expect(scoreGame(makeGame({ gameId: 1, rating: null }), makeCtx(profile))).toBeNull()
		})

		it('keeps bouncer game if rating is love', () => {
			const profile = makeProfile({ bouncerGames: [1] })
			const result = scoreGame(makeGame({ gameId: 1, rating: 'love' }), makeCtx(profile))
			expect(result).not.toBeNull()
		})

		it('returns null for bounced stats (not love)', () => {
			const stats = makeStats({ bounceCount: 3, significantSessions: 0 })
			expect(scoreGame(makeGame({ stats }), makeCtx())).toBeNull()
		})
	})

	describe('mood finish', () => {
		it('returns null when no ongoing session', () => {
			const ctx = makeCtx(makeProfile(), new Set(), { mood: 'finish' })
			expect(scoreGame(makeGame(), ctx)).toBeNull()
		})

		it('returns null for ongoing session without HLTB data', () => {
			const recentDate = new Date(Date.now() - 30 * 24 * 3600 * 1000)
			const stats = makeStats({ significantSessions: 2, lastMeaningfulPlayAt: recentDate })
			const ctx = makeCtx(makeProfile(), new Set(), { mood: 'finish' })
			expect(scoreGame(makeGame({ stats, hltbDurations: null }), ctx)).toBeNull()
		})

		it('keeps game with ongoing session and HLTB data', () => {
			const recentDate = new Date(Date.now() - 30 * 24 * 3600 * 1000)
			const stats = makeStats({ significantSessions: 2, lastMeaningfulPlayAt: recentDate })
			const ctx = makeCtx(makeProfile(), new Set(), { mood: 'finish' })
			const result = scoreGame(
				makeGame({
					stats,
					hltbDurations: { mainStory: 3600, mainExtras: null, completionist: null },
				}),
				ctx,
			)
			expect(result).not.toBeNull()
		})
	})

	describe('profile content-based scoring', () => {
		it('scores higher for matching system', () => {
			const profile = makeProfile({ systemsWeights: [w('snes', 0.9)] })
			const favSystem = scoreGame(makeGame({ system: 'snes' }), makeCtx(profile))
			const otherSystem = scoreGame(makeGame({ system: 'nes' }), makeCtx(profile))
			expect(favSystem?.score).toBeGreaterThan(otherSystem!.score)
		})

		it('scores higher for matching genre', () => {
			const profile = makeProfile({ genresWeights: [w('Platformer', 0.8)] })
			const favGenre = scoreGame(makeGame({ genres: ['Platformer'] }), makeCtx(profile))
			const otherGenre = scoreGame(makeGame({ genres: ['Shmup'] }), makeCtx(profile))
			expect(favGenre?.score).toBeGreaterThan(otherGenre!.score)
		})

		it('adds system-prefers reason when weight ≥ 0.7', () => {
			const profile = makeProfile({ systemsWeights: [w('snes', 0.9)] })
			const result = scoreGame(makeGame({ system: 'snes' }), makeCtx(profile))
			expect(result?.reasons).toContainEqual({ key: 'favoriteConsole' })
		})
	})

	describe('IGDB boost', () => {
		it('adds +50 and igdbBoosted flag for similar comfort game', () => {
			const game = makeGame({ gameId: 42 })
			const similar = new Set<number>([42])
			const baseCtx = makeCtx(makeProfile(), new Set())
			const boostCtx = makeCtx(makeProfile(), similar)
			// biome-ignore lint/style/noNonNullAssertion: game with sufficient stats always scores
			const base = scoreGame(game, baseCtx)!
			// biome-ignore lint/style/noNonNullAssertion: see above
			const boosted = scoreGame(game, boostCtx)!
			expect(boosted.score - base.score).toBe(50)
			expect(boosted.igdbBoosted).toBe(true)
		})

		it('sets confidence to high when igdb boosted', () => {
			const game = makeGame({ gameId: 42 })
			// biome-ignore lint/style/noNonNullAssertion: game with sufficient stats always scores
			const result = scoreGame(game, makeCtx(makeProfile(), new Set([42])))!
			expect(result.confidence).toBe('high')
		})
	})

	describe('comfort game', () => {
		it('scores higher in chill mood than neutral', () => {
			const profile = makeProfile({ comfortGames: [1] })
			const stats = makeStats({ significantSessions: 3 })
			const chillCtx = makeCtx(profile, new Set(), { mood: 'chill' })
			const neutralCtx = makeCtx(profile, new Set(), { mood: 'surprise' })
			// biome-ignore lint/style/noNonNullAssertion: game with sufficient stats always scores
			const chill = scoreGame(makeGame({ gameId: 1, stats }), chillCtx)!
			// biome-ignore lint/style/noNonNullAssertion: see above
			const neutral = scoreGame(makeGame({ gameId: 1, stats }), neutralCtx)!
			expect(chill.score).toBeGreaterThan(neutral.score)
		})

		it('scores lower in discovery mood than neutral (same game, measured sessions)', () => {
			const profile = makeProfile({ comfortGames: [1] })
			// measuredSessions > 0 so isUntested = false, avoiding discovery untested bonus
			const stats = makeStats({ significantSessions: 3, measuredSessions: 3, meaningfulCount: 3 })
			const discoverCtx = makeCtx(profile, new Set(), { mood: 'discovery' })
			const neutralCtx = makeCtx(profile, new Set(), { mood: 'surprise' })
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const discover = scoreGame(makeGame({ gameId: 1, stats }), discoverCtx)!
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const neutral = scoreGame(makeGame({ gameId: 1, stats }), neutralCtx)!
			expect(discover.score).toBeLessThan(neutral.score)
		})
	})

	describe('confidence', () => {
		it('is high for love rating', () => {
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(makeGame({ rating: 'love' }), makeCtx())!
			expect(result.confidence).toBe('high')
		})

		it('is high for confirmed taste', () => {
			const stats = makeStats({ significantSessions: 3 })
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(makeGame({ stats }), makeCtx())!
			expect(result.confidence).toBe('high')
		})

		it('is medium for like rating', () => {
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(makeGame({ rating: 'like' }), makeCtx())!
			expect(result.confidence).toBe('medium')
		})

		it('is exploration for unknown untested game', () => {
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(makeGame(), makeCtx())!
			expect(result.confidence).toBe('exploration')
		})
	})

	describe('time match', () => {
		it('boosts arcade games for 30 min', () => {
			const ctx = makeCtx(makeProfile(), new Set(), { availableMinutes: 30 })
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const arcade = scoreGame(makeGame({ system: 'arcade' }), ctx)!
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const rpg = scoreGame(makeGame({ system: 'snes', genres: ['RPG'] }), ctx)!
			expect(arcade.score).toBeGreaterThan(rpg.score)
		})

		it('boosts RPG for long sessions', () => {
			const ctx120 = makeCtx(makeProfile(), new Set(), { availableMinutes: 120 })
			const ctx30 = makeCtx(makeProfile(), new Set(), { availableMinutes: 30 })
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const rpg120 = scoreGame(makeGame({ genres: ['RPG'] }), ctx120)!
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const rpg30 = scoreGame(makeGame({ genres: ['RPG'] }), ctx30)!
			expect(rpg120.score).toBeGreaterThan(rpg30.score)
		})
	})

	describe('mood finish — HLTB time fit', () => {
		const recentDate = new Date(Date.now() - 30 * 24 * 3600 * 1000)
		const ongoingStats = makeStats({ significantSessions: 1, lastMeaningfulPlayAt: recentDate })
		const finishCtx = makeCtx(makeProfile(), new Set(), { mood: 'finish', availableMinutes: 60 })

		it('adds +40 and reason when mainStory ≤ availableMinutes', () => {
			const game = makeGame({
				stats: ongoingStats,
				hltbDurations: { mainStory: 3000, mainExtras: null, completionist: null }, // 50min
			})
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(game, finishCtx)!
			expect(result).not.toBeNull()
			expect(result.scoreBreakdown?.hltbTimeFit).toBe(40)
			expect(result.reasons.some((r) => r.key === 'finishableTonight')).toBe(true)
		})

		it('adds +25 and reason when mainStory is 1–2× availableMinutes', () => {
			const game = makeGame({
				stats: ongoingStats,
				hltbDurations: { mainStory: 7200, mainExtras: null, completionist: null }, // 120min = 2×
			})
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(game, finishCtx)!
			expect(result.scoreBreakdown?.hltbTimeFit).toBe(25)
			expect(result.reasons.some((r) => r.key === 'oneTwoSessions')).toBe(true)
		})

		it('adds +10 when mainStory is 2–4× availableMinutes', () => {
			const game = makeGame({
				stats: ongoingStats,
				hltbDurations: { mainStory: 14400, mainExtras: null, completionist: null }, // 240min = 4×
			})
			expect(scoreGame(game, finishCtx)?.scoreBreakdown?.hltbTimeFit).toBe(10)
		})

		it('returns null when mainStory is >4× availableMinutes', () => {
			const game = makeGame({
				stats: ongoingStats,
				hltbDurations: { mainStory: 18000, mainExtras: null, completionist: null }, // 300min = 5×
			})
			expect(scoreGame(game, finishCtx)).toBeNull()
		})

		it('falls back to mainExtras when mainStory is null', () => {
			const game = makeGame({
				stats: ongoingStats,
				hltbDurations: { mainStory: null, mainExtras: 3000, completionist: null },
			})
			expect(scoreGame(game, finishCtx)?.scoreBreakdown?.hltbTimeFit).toBe(40)
		})

		it('falls back to completionist when mainStory and mainExtras are null', () => {
			const game = makeGame({
				stats: ongoingStats,
				hltbDurations: { mainStory: null, mainExtras: null, completionist: 3000 },
			})
			expect(scoreGame(game, finishCtx)?.scoreBreakdown?.hltbTimeFit).toBe(40)
		})
	})

	describe('estimateTimeMatch — HLTB bonus', () => {
		it('adds +10 when any HLTB duration falls within ±50% of availableMinutes', () => {
			const ctx = makeCtx(makeProfile(), new Set(), { availableMinutes: 60, mood: 'chill' })
			const withHltb = makeGame({
				hltbDurations: { mainStory: 3600, mainExtras: null, completionist: null }, // 60min exact match
			})
			const withoutHltb = makeGame({ hltbDurations: null, system: 'snes' })
			const withScore = scoreGame(withHltb, ctx)!.score
			const withoutScore = scoreGame(withoutHltb, ctx)!.score
			expect(withScore).toBeGreaterThan(withoutScore)
		})

		it('falls back to heuristics when HLTB duration does not fit', () => {
			const ctx = makeCtx(makeProfile(), new Set(), { availableMinutes: 30, mood: 'chill' })
			const arcadeGame = makeGame({
				system: 'arcade',
				hltbDurations: { mainStory: 36000, mainExtras: null, completionist: null }, // 10h, no fit
			})
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(arcadeGame, ctx)!
			expect(result.scoreBreakdown?.timeMatch).toBe(25)
		})
	})
})
