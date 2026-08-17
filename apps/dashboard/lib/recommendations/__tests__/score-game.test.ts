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
	recentlyShown: Map<string, number> = new Map(),
	identityOverrides: Partial<Pick<ScoringContext, 'knownIdentities' | 'skippedIdentities'>> = {},
): ScoringContext {
	return {
		profile,
		similarToComfortGames,
		recentlyShown,
		knownIdentities: identityOverrides.knownIdentities ?? new Set(),
		skippedIdentities: identityOverrides.skippedIdentities ?? new Set(),
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
		identityKey: 'igdb:1',
		name: 'Test Game',
		system: 'snes',
		imagePath: null,
		videoPath: null,
		genres: ['Platformer'],
		releaseYear: 1993,
		decade: '1990s',
		developer: 'Nintendo',
		scrapedRating: null,
		igdbRating: null,
		stats: null,
		rating: null,
		favorite: false,
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
		const finishCtx = () => makeCtx(makeProfile(), new Set(), { mood: 'finish' })

		it('returns null when the game was never played', () => {
			expect(scoreGame(makeGame(), finishCtx())).toBeNull()
		})

		it('rejects a game merely launched twice for a few minutes', () => {
			// The old rule (inherited playCount >= 2, no time floor) let 3-minute
			// launches in and labelled them "in progress".
			const stats = makeStats({
				inherited: {
					playCount: 2,
					playTimeSeconds: 200,
					lastPlayedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
				},
			})
			expect(scoreGame(makeGame({ stats }), finishCtx())).toBeNull()
		})

		it('keeps a game with real inherited playtime', () => {
			const stats = makeStats({
				inherited: {
					playCount: 2,
					playTimeSeconds: 3600,
					lastPlayedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
				},
			})
			expect(scoreGame(makeGame({ stats }), finishCtx())).not.toBeNull()
		})

		it('keeps a game with no HLTB data at all', () => {
			const stats = makeStats({ significantSessions: 2, totalPlaytimeSeconds: 5400 })
			const result = scoreGame(makeGame({ stats, hltbDurations: null }), finishCtx())
			expect(result).not.toBeNull()
			expect(result?.scoreBreakdown?.finishMode).toBe(30)
			expect(result?.scoreBreakdown?.hltbTimeFit).toBeUndefined()
		})

		it('keeps a game abandoned years ago — that is the point of the mood', () => {
			const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000)
			const stats = makeStats({
				significantSessions: 2,
				totalPlaytimeSeconds: 7200,
				lastMeaningfulPlayAt: threeYearsAgo,
			})
			const result = scoreGame(
				makeGame({
					stats,
					hltbDurations: { mainStory: 4 * 3600, mainExtras: null, completionist: null },
				}),
				finishCtx(),
			)
			expect(result).not.toBeNull()
			expect(result?.scoreBreakdown?.finishStale).toBe(-10)
		})

		it('swaps the generic reason for "resume" when played recently', () => {
			const stats = makeStats({
				significantSessions: 2,
				totalPlaytimeSeconds: 7200,
				lastMeaningfulPlayAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
			})
			const result = scoreGame(makeGame({ stats }), finishCtx())
			expect(result?.reasons).toContainEqual({ key: 'resumeWhereYouLeftOff' })
			expect(result?.reasons).not.toContainEqual({ key: 'inProgress' })
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

		it('is excluded entirely in discovery mood, but kept in neutral', () => {
			const profile = makeProfile({ comfortGames: [1] })
			const stats = makeStats({ significantSessions: 3, measuredSessions: 3, meaningfulCount: 3 })
			// recommend.ts folds comfort games and play traces into knownIdentities.
			const discoverCtx = makeCtx(profile, new Set(), { mood: 'discovery' }, new Map(), {
				knownIdentities: new Set(['igdb:1']),
			})
			const neutralCtx = makeCtx(profile, new Set(), { mood: 'surprise' })
			expect(
				scoreGame(makeGame({ gameId: 1, identityKey: 'igdb:1', stats }), discoverCtx),
			).toBeNull()
			expect(
				scoreGame(makeGame({ gameId: 1, identityKey: 'igdb:1', stats }), neutralCtx),
			).not.toBeNull()
		})
	})

	describe('discovery — break the comfort-zone funnel', () => {
		it('does not add the favorite-console bonus in discovery', () => {
			const profile = makeProfile({ systemsWeights: [w('snes', 0.9)] })
			const surprise = scoreGame(
				makeGame({ system: 'snes' }),
				makeCtx(profile, new Set(), { mood: 'surprise' }),
			)
			const discovery = scoreGame(
				makeGame({ system: 'snes' }),
				makeCtx(profile, new Set(), { mood: 'discovery' }),
			)
			expect(surprise?.scoreBreakdown?.systemMatch).toBe(27)
			expect(discovery?.scoreBreakdown?.systemMatch).toBeUndefined()
			expect(discovery?.reasons.some((r) => r.key === 'favoriteConsole')).toBe(false)
		})

		it('excludes an untouched row whose twin the user already knows', () => {
			// The regression: EmulationStation hearts one ROM row, discovery proposed
			// the other copy of the same game because the check was per row.
			const discoveryCtx = makeCtx(makeProfile(), new Set(), { mood: 'discovery' }, new Map(), {
				knownIdentities: new Set(['igdb:1234']),
			})
			const untouchedTwin = makeGame({
				gameId: 999,
				identityKey: 'igdb:1234',
				favorite: false,
				stats: null,
			})
			expect(scoreGame(untouchedTwin, discoveryCtx)).toBeNull()
		})

		it('halves the IGDB similarity boost in discovery', () => {
			const game = makeGame({ gameId: 42 })
			const surprise = scoreGame(game, makeCtx(makeProfile(), new Set([42]), { mood: 'surprise' }))
			const discovery = scoreGame(
				game,
				makeCtx(makeProfile(), new Set([42]), { mood: 'discovery' }),
			)
			expect(surprise?.scoreBreakdown?.igdbSimilarBoost).toBe(50)
			expect(discovery?.scoreBreakdown?.igdbSimilarBoost).toBe(25)
		})
	})

	describe('rotation — anti-repetition penalty', () => {
		it('penalizes -25 per showing, with no cap', () => {
			const once = scoreGame(
				makeGame({ identityKey: 'igdb:7' }),
				makeCtx(makeProfile(), new Set(), {}, new Map([['igdb:7', 1]])),
			)
			const fourTimes = scoreGame(
				makeGame({ identityKey: 'igdb:7' }),
				makeCtx(makeProfile(), new Set(), {}, new Map([['igdb:7', 4]])),
			)
			expect(once?.scoreBreakdown?.recentlyShownPenalty).toBe(-25)
			// Uncapped: the old -40 ceiling was smaller than the gap between finalists,
			// so the leaders survived every reshuffle.
			expect(fourTimes?.scoreBreakdown?.recentlyShownPenalty).toBe(-100)
		})

		it('penalizes a twin row that was never shown itself', () => {
			// Same game, other emulator: showing one has to demote the other.
			const twin = scoreGame(
				makeGame({ gameId: 99, identityKey: 'igdb:7' }),
				makeCtx(makeProfile(), new Set(), {}, new Map([['igdb:7', 2]])),
			)
			expect(twin?.scoreBreakdown?.recentlyShownPenalty).toBe(-50)
		})

		it('leaves never-shown games untouched', () => {
			const result = scoreGame(makeGame({ gameId: 7 }), makeCtx())
			expect(result?.scoreBreakdown?.recentlyShownPenalty).toBeUndefined()
		})
	})

	describe('mood discovery — only never-played, never-favorited', () => {
		const discoveryCtx = (profile = makeProfile()) =>
			makeCtx(profile, new Set(), { mood: 'discovery' })

		it('keeps a never-played, non-favorite game', () => {
			expect(scoreGame(makeGame({ gameId: 1, stats: null }), discoveryCtx())).not.toBeNull()
		})

		it('excludes a game with measured sessions', () => {
			const stats = makeStats({ measuredSessions: 2, significantSessions: 1 })
			expect(scoreGame(makeGame({ gameId: 1, stats }), discoveryCtx())).toBeNull()
		})

		it('excludes a game with inherited play history', () => {
			const stats = makeStats({
				inherited: { playCount: 1, playTimeSeconds: 600, lastPlayedAt: null },
			})
			expect(scoreGame(makeGame({ gameId: 1, stats }), discoveryCtx())).toBeNull()
		})

		it('excludes a comfort game even if never played', () => {
			const profile = makeProfile({ comfortGames: [1] })
			expect(scoreGame(makeGame({ gameId: 1, stats: null }), discoveryCtx(profile))).toBeNull()
		})

		it('excludes a love- or like-rated game', () => {
			expect(scoreGame(makeGame({ gameId: 1, rating: 'love' }), discoveryCtx())).toBeNull()
			expect(scoreGame(makeGame({ gameId: 1, rating: 'like' }), discoveryCtx())).toBeNull()
		})

		it('excludes a favorited game (treated like a like)', () => {
			expect(scoreGame(makeGame({ gameId: 1, favorite: true }), discoveryCtx())).toBeNull()
		})
	})

	describe('favorite games (EmulationStation heart)', () => {
		it('adds +15 like an implicit like when the game is unrated', () => {
			const favorited = scoreGame(makeGame({ favorite: true }), makeCtx())
			const plain = scoreGame(makeGame({ favorite: false }), makeCtx())
			expect(favorited?.scoreBreakdown?.favoriteBoost).toBe(15)
			expect(plain?.scoreBreakdown?.favoriteBoost).toBeUndefined()
		})

		it('does not double-count when the game is already rated like', () => {
			const result = scoreGame(makeGame({ favorite: true, rating: 'like' }), makeCtx())
			expect(result?.scoreBreakdown?.ratingLike).toBe(15)
			expect(result?.scoreBreakdown?.favoriteBoost).toBeUndefined()
		})

		it('does not double-count when the game is already rated love', () => {
			const result = scoreGame(makeGame({ favorite: true, rating: 'love' }), makeCtx())
			expect(result?.scoreBreakdown?.ratingLove).toBe(35)
			expect(result?.scoreBreakdown?.favoriteBoost).toBeUndefined()
		})

		it('still excludes a disliked game even if favorited', () => {
			expect(scoreGame(makeGame({ favorite: true, rating: 'dislike' }), makeCtx())).toBeNull()
		})

		it('gives medium confidence like a like rating', () => {
			// biome-ignore lint/style/noNonNullAssertion: game always scores in test context
			const result = scoreGame(makeGame({ favorite: true }), makeCtx())!
			expect(result.confidence).toBe('medium')
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

		it('adds +40 and reason when the time LEFT ≤ availableMinutes', () => {
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

		it('demotes rather than drops a game >4× availableMinutes', () => {
			// Dropping these emptied the pool of every game actually worth finishing.
			const game = makeGame({
				stats: ongoingStats,
				hltbDurations: { mainStory: 18000, mainExtras: null, completionist: null }, // 300min = 5×
			})
			expect(scoreGame(game, finishCtx)?.scoreBreakdown?.hltbTimeFit).toBe(-15)
		})

		it('measures the time remaining, not the game total', () => {
			// 5h game, 4h35 already played → 25 min left, finishable tonight, even
			// though the total length is five times the evening.
			const nearlyDone = makeStats({
				significantSessions: 1,
				totalPlaytimeSeconds: 16500,
				lastMeaningfulPlayAt: recentDate,
			})
			const game = makeGame({
				stats: nearlyDone,
				hltbDurations: { mainStory: 18000, mainExtras: null, completionist: null },
			})
			// biome-ignore lint/style/noNonNullAssertion: eligible game always scores
			const result = scoreGame(game, finishCtx)!
			expect(result.scoreBreakdown?.hltbTimeFit).toBe(40)
			expect(result.reasons).toContainEqual({
				key: 'finishableTonight',
				params: { duration: '25min' },
			})
			expect(result.reasons).toContainEqual({ key: 'almostDone', params: { pct: 92 } })
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
