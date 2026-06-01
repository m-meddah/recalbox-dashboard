import type { UserProfile } from '@/lib/db/schema'
import {
	hasBouncedWithoutCommitting,
	isConfirmedTaste,
	isUntested,
	monthsSinceLastMeaningfulPlay,
} from '@/lib/games/heuristics'
import type { GamePlayStats } from '@/lib/games/play-stats'
import { getWeightFor } from '@/lib/profile/get-profile'
import type { Confidence, ReasonKey, RecommendationContext, ScoredGame } from './types'

export type GameForScoring = {
	gameId: number
	name: string
	system: string
	imageUrl: string | null
	videoUrl: string | null
	genres: string[]
	releaseYear: number | null
	decade: string | null
	developer: string | null
	scrapedRating: number | null
	igdbRating: number | null
	stats: GamePlayStats | null
	rating: 'love' | 'like' | 'dislike' | 'unknown' | null
	hltbDurations: {
		mainStory: number | null
		mainExtras: number | null
		completionist: number | null
	} | null
}

export type ScoringContext = {
	profile: UserProfile
	similarToComfortGames: Set<number>
	recommendationCtx: RecommendationContext
}

const CHILL_GENRES = ['Puzzle', 'Platform', 'Platformer', 'Casual', 'Sports']
const CHILL_SYSTEMS = ['gb', 'gbc', 'gba', 'nes', 'gameboy']
const CHALLENGE_GENRES = ["Shoot'em up", 'Shmup', 'Fighting', "Beat'em up", 'Action']
const ARCADE_SYSTEMS = ['arcade', 'neogeo', 'mame', 'fbneo']
const RPG_GENRES = ['RPG', 'JRPG', 'Role-Playing', 'Role-playing']
const LONG_GENRES = ['RPG', 'JRPG', 'Adventure', 'Strategy', 'Simulation']

export function scoreGame(game: GameForScoring, ctx: ScoringContext): ScoredGame | null {
	const breakdown: Record<string, number> = {}
	let score = 0
	const reasons: ReasonKey[] = []
	let igdbBoosted = false
	const { mood, availableMinutes, excludedGameIds } = ctx.recommendationCtx

	// ── HARD EXCLUSIONS ──
	if (excludedGameIds.includes(game.gameId)) return null
	if (game.rating === 'dislike') return null
	if (ctx.profile.bouncerGames.includes(game.gameId) && game.rating !== 'love') return null
	if (game.stats && hasBouncedWithoutCommitting(game.stats) && game.rating !== 'love') return null

	// ── MOOD finish ──
	if (mood === 'finish') {
		const scrobblerEngaged = game.stats
			? game.stats.significantSessions + game.stats.tasteCount >= 1
			: false
		const inheritedEngaged = (game.stats?.inherited?.playCount ?? 0) >= 2
		const hasEngagement = scrobblerEngaged || inheritedEngaged

		const lastPlay =
			game.stats?.lastMeaningfulPlayAt ??
			game.stats?.lastPlayedAt ??
			game.stats?.inherited?.lastPlayedAt ??
			null
		const monthsSince = lastPlay
			? (Date.now() - lastPlay.getTime()) / (1000 * 60 * 60 * 24 * 30)
			: Number.POSITIVE_INFINITY

		if (!hasEngagement || monthsSince >= 6) return null
		if (!game.hltbDurations) return null

		score += 60
		breakdown.finishMode = 60
		reasons.push({ key: 'inProgress' })

		const refSec =
			game.hltbDurations.mainStory ??
			game.hltbDurations.mainExtras ??
			game.hltbDurations.completionist
		if (refSec !== null) {
			const ratio = refSec / 60 / availableMinutes
			const formatted = formatHltbDuration(refSec)
			let timeFitPts: number
			if (ratio <= 1) {
				timeFitPts = 40
				reasons.push({ key: 'finishableTonight', params: { duration: formatted } })
			} else if (ratio <= 2) {
				timeFitPts = 25
				reasons.push({ key: 'oneTwoSessions', params: { duration: formatted } })
			} else if (ratio <= 4) {
				timeFitPts = 10
			} else {
				return null
			}
			score += timeFitPts
			breakdown.hltbTimeFit = timeFitPts
		}
	}

	// ── CONTENT-BASED (profil) ──
	const systemWeight = getWeightFor(ctx.profile.systemsWeights, game.system)
	if (systemWeight > 0.1) {
		const pts = Math.round(30 * systemWeight)
		score += pts
		breakdown.systemMatch = pts
		if (systemWeight >= 0.7) reasons.push({ key: 'favoriteConsole' })
	}

	let bestGenreWeight = 0
	let bestGenre: string | null = null
	for (const g of game.genres) {
		const w = getWeightFor(ctx.profile.genresWeights, g)
		if (w > bestGenreWeight) {
			bestGenreWeight = w
			bestGenre = g
		}
	}
	if (bestGenreWeight > 0.1) {
		const pts = Math.round(25 * bestGenreWeight)
		score += pts
		breakdown.genreMatch = pts
		if (bestGenreWeight >= 0.5 && bestGenre)
			reasons.push({ key: 'favoriteGenre', params: { genre: bestGenre } })
	}

	if (game.decade) {
		const w = getWeightFor(ctx.profile.decadesWeights, game.decade)
		if (w > 0.1) {
			const pts = Math.round(10 * w)
			score += pts
			breakdown.decadeMatch = pts
		}
	}

	if (game.developer) {
		const w = getWeightFor(ctx.profile.developersWeights, game.developer)
		if (w > 0.3) {
			const pts = Math.round(8 * w)
			score += pts
			breakdown.developerMatch = pts
			if (w >= 0.6) reasons.push({ key: 'favoriteStudio', params: { studio: game.developer! } })
		}
	}

	// ── IGDB BOOST ──
	if (ctx.similarToComfortGames.has(game.gameId)) {
		score += 50
		breakdown.igdbSimilarBoost = 50
		igdbBoosted = true
		reasons.push({ key: 'similarToFavorite' })
	}

	// ── RATINGS ──
	if (game.rating === 'love') {
		score += 35
		breakdown.ratingLove = 35
		if (!reasons.some((r) => r.key === 'similarToFavorite')) reasons.push({ key: 'lovedGame' })
	} else if (game.rating === 'like') {
		score += 15
		breakdown.ratingLike = 15
	}

	// ── ENGAGEMENT ──
	if (game.stats) {
		if (isConfirmedTaste(game.stats)) {
			score += 15
			breakdown.confirmedTaste = 15
		}
		if (ctx.profile.comfortGames.includes(game.gameId)) {
			if (mood === 'chill' || mood === 'nostalgia') {
				score += 20
				breakdown.comfortGameMatch = 20
				reasons.push({ key: 'comfortGame' })
			} else if (mood === 'discovery') {
				score -= 15
				breakdown.comfortGameInDiscovery = -15
			} else {
				score += 5
				breakdown.comfortGameSlight = 5
			}
		}
	}

	// ── QUALITY ──
	if (game.scrapedRating !== null && game.scrapedRating > 0.7) {
		const pts = Math.round((game.scrapedRating - 0.7) * 30)
		score += pts
		breakdown.scrapedRatingBoost = pts
	}
	if (game.igdbRating !== null && game.igdbRating > 75) {
		const pts = Math.round((game.igdbRating - 75) * 0.3)
		score += pts
		breakdown.igdbRatingBoost = pts
	}

	// ── TIME MATCH ──
	const tm = estimateTimeMatch(game, availableMinutes)
	score += tm.score
	breakdown.timeMatch = tm.score
	if (tm.reason) reasons.push(tm.reason)

	// ── NOVELTY / FRESHNESS ──
	const untested = isUntested(game.stats)
	const monthsSince = game.stats
		? monthsSinceLastMeaningfulPlay(game.stats)
		: Number.POSITIVE_INFINITY
	if (untested) {
		if (mood === 'discovery') {
			score += 35
			breakdown.discoveryUntested = 35
			reasons.push({ key: 'neverLaunched' })
		} else if (mood !== 'finish') {
			score += 8
			breakdown.untestedBaseline = 8
		}
	} else if (monthsSince > 6) {
		if (mood === 'nostalgia') {
			score += 30
			breakdown.nostalgiaOldGame = 30
			reasons.push({ key: 'notPlayedInAWhile' })
		} else {
			score += 12
			breakdown.staleGame = 12
		}
	} else if (monthsSince < 1) {
		score -= 12
		breakdown.tooRecent = -12
	}

	// ── MOOD BIAS ──
	if (mood === 'chill') {
		if (game.genres.some((g) => CHILL_GENRES.includes(g))) {
			score += 18
			breakdown.chillGenre = 18
		}
		if (CHILL_SYSTEMS.includes(game.system.toLowerCase())) {
			score += 10
			breakdown.chillSystem = 10
		}
		if (game.genres.some((g) => RPG_GENRES.includes(g))) {
			score -= 12
			breakdown.antiChillRpg = -12
		}
	}
	if (mood === 'challenge') {
		if (game.genres.some((g) => CHALLENGE_GENRES.includes(g))) {
			score += 20
			breakdown.challengeGenre = 20
		}
		if (ARCADE_SYSTEMS.includes(game.system.toLowerCase())) {
			score += 15
			breakdown.challengeArcade = 15
		}
	}
	if (mood === 'discovery') {
		if (systemWeight < 0.3) {
			score += 12
			breakdown.discoveryUnfamiliarSystem = 12
		}
		if (game.scrapedRating && game.scrapedRating > 0.75) {
			score += 10
			breakdown.discoveryWellRated = 10
		}
	}

	// ── JITTER ──
	const jitterRange = mood === 'surprise' ? 20 : 8
	const jitter = (Math.random() - 0.5) * jitterRange
	score += jitter
	breakdown.jitter = jitter

	const confidence = computeConfidence(game, ctx, igdbBoosted)

	return {
		gameId: game.gameId,
		name: game.name,
		system: game.system,
		imageUrl: game.imageUrl,
		videoUrl: game.videoUrl,
		genres: game.genres,
		releaseYear: game.releaseYear,
		developer: game.developer,
		score,
		confidence,
		reasons: Array.from(new Set(reasons)).slice(0, 3),
		lastPlayedAt: game.stats?.lastMeaningfulPlayAt ?? game.stats?.inherited?.lastPlayedAt ?? null,
		meaningfulSessionsCount: game.stats?.significantSessions ?? 0,
		scoreBreakdown: breakdown,
		igdbBoosted,
	}
}

function estimateTimeMatch(
	game: GameForScoring,
	minutes: number,
): { score: number; reason?: ReasonKey } {
	if (game.hltbDurations) {
		const secs = [
			game.hltbDurations.mainStory,
			game.hltbDurations.mainExtras,
			game.hltbDurations.completionist,
		]
		const fits = secs.some((s) => s !== null && Math.abs(s / 60 - minutes) / minutes <= 0.5)
		if (fits) return { score: 10 }
	}

	const isRpg = game.genres.some((g) => RPG_GENRES.includes(g))
	const isLong = game.genres.some((g) => LONG_GENRES.includes(g))
	const isArcade = ARCADE_SYSTEMS.includes(game.system.toLowerCase())
	const isHandheld = CHILL_SYSTEMS.includes(game.system.toLowerCase())

	if (minutes <= 30) {
		if (isArcade) return { score: 25, reason: { key: 'idealFor30min' } as ReasonKey }
		if (isHandheld) return { score: 20 }
		if (isRpg) return { score: -25 }
		if (isLong) return { score: -15 }
		return { score: 0 }
	}
	if (minutes <= 60) {
		if (isArcade) return { score: 15 }
		if (isHandheld) return { score: 12 }
		if (isRpg) return { score: -10 }
		return { score: 5 }
	}
	if (minutes >= 120) {
		if (isRpg) return { score: 22, reason: { key: 'longSession' } }
		if (isLong) return { score: 18 }
		if (isArcade) return { score: -5 }
		return { score: 8 }
	}
	return { score: 0 }
}

function computeConfidence(
	game: GameForScoring,
	ctx: ScoringContext,
	igdbBoosted: boolean,
): Confidence {
	if (game.rating === 'love') return 'high'
	if (igdbBoosted) return 'high'
	if (game.stats && isConfirmedTaste(game.stats)) return 'high'
	if (game.rating === 'like') return 'medium'
	const sw = getWeightFor(ctx.profile.systemsWeights, game.system)
	const gw = Math.max(0, ...game.genres.map((g) => getWeightFor(ctx.profile.genresWeights, g)))
	if (sw >= 0.5 && gw >= 0.4) return 'medium'
	return 'exploration'
}

function formatHltbDuration(seconds: number): string {
	const hours = seconds / 3600
	if (hours < 1) return `${Math.round(seconds / 60)}min`
	return `~${Math.round(hours)}h`
}
