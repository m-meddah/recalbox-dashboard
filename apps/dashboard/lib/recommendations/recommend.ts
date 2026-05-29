import { db } from '@/lib/db'
import {
	games,
	gameRatings,
	recommendationSkip,
	recommendationLog,
	gameIgdbMapping,
	igdbGameCache,
} from '@/lib/db/schema'
import { sql, eq, gt, and, isNotNull, inArray } from 'drizzle-orm'
import { getGamePlayStatsBatch } from '@/lib/games/play-stats'
import { getUserProfile } from '@/lib/profile/get-profile'
import { getSimilarityProvider } from './similarity-provider'
import { scoreGame, type GameForScoring, type ScoringContext } from './score-game'
import { selectFinalists } from './select-finalists'
import { isIgdbEnabled } from '@/lib/igdb/auth'
import { matchGameAsync } from '@/lib/igdb/match-single'
import type { RecommendationContext, ScoredGame } from './types'

const LAZY_MATCH_TOP_N = 30

export async function recommend(
	ctxInput: Omit<RecommendationContext, 'excludedGameIds'>,
): Promise<ScoredGame[]> {
	const profile = await getUserProfile()

	const activeSkips = await db
		.select({ gameId: recommendationSkip.gameId })
		.from(recommendationSkip)
		.where(gt(recommendationSkip.expiresAt, new Date()))
		.all()
	const excludedGameIds = activeSkips.map((s) => s.gameId)

	const recommendationCtx: RecommendationContext = { ...ctxInput, excludedGameIds }

	const provider = await getSimilarityProvider()
	const similarToComfortGames = await provider.getSimilarToAny(profile.comfortGames)

	const gamesList = await db
		.select({
			gameId: games.id,
			name: games.name,
			system: games.system,
			imageUrl: games.imagePath,
			videoUrl: games.videoPath,
			genres: games.genre,
			releaseDate: games.releaseDate,
			developer: games.developer,
			scrapedRating: games.rating,
		})
		.from(games)
		.where(eq(games.hidden, false))
		.all()

	const statsMap = await getGamePlayStatsBatch(gamesList.map((g) => g.gameId))

	const ratings = await db.select().from(gameRatings).all()
	const ratingsMap = new Map(ratings.map((r) => [r.gameId, r.rating]))

	const igdbRatingsMap = await loadIgdbRatings()

	const scoringCtx: ScoringContext = { profile, similarToComfortGames, recommendationCtx }

	const scored: ScoredGame[] = []
	for (const game of gamesList) {
		const releaseYear = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null
		const g: GameForScoring = {
			gameId: game.gameId,
			name: game.name,
			system: game.system,
			imageUrl: game.imageUrl,
			videoUrl: game.videoUrl,
			genres: parseGenres(game.genres),
			releaseYear,
			decade: releaseYear ? `${Math.floor(releaseYear / 10) * 10}s` : null,
			developer: game.developer,
			scrapedRating: game.scrapedRating,
			igdbRating: igdbRatingsMap.get(game.gameId) ?? null,
			stats: statsMap.get(game.gameId) ?? null,
			rating: ratingsMap.get(game.gameId) ?? null,
		}
		const result = scoreGame(g, scoringCtx)
		if (result) scored.push(result)
	}

	const finalists = selectFinalists(scored)

	for (const f of finalists) {
		await db.insert(recommendationLog).values({
			gameId: f.gameId,
			contextTimeMinutes: recommendationCtx.availableMinutes,
			contextMood: recommendationCtx.mood,
			score: f.score,
			confidence: f.confidence,
			reasons: f.reasons,
		})
	}

	if (await isIgdbEnabled()) {
		triggerLazyMatching(scored.slice(0, LAZY_MATCH_TOP_N).map((c) => c.gameId))
	}

	return finalists
}

async function loadIgdbRatings(): Promise<Map<number, number>> {
	const mappings = await db
		.select({ gameId: gameIgdbMapping.gameId, igdbId: gameIgdbMapping.igdbId })
		.from(gameIgdbMapping)
		.where(isNotNull(gameIgdbMapping.igdbId))
		.all()

	if (mappings.length === 0) return new Map()

	const igdbIds = mappings.map((m) => m.igdbId).filter((id): id is number => id !== null)
	if (igdbIds.length === 0) return new Map()

	const cached = await db
		.select({ igdbId: igdbGameCache.igdbId, rating: igdbGameCache.rating })
		.from(igdbGameCache)
		.where(and(inArray(igdbGameCache.igdbId, igdbIds), isNotNull(igdbGameCache.rating)))
		.all()

	const ratingByIgdbId = new Map(cached.map((c) => [c.igdbId, c.rating as number]))
	const result = new Map<number, number>()
	for (const m of mappings) {
		const r = m.igdbId !== null ? ratingByIgdbId.get(m.igdbId) : undefined
		if (r != null) result.set(m.gameId, r)
	}
	return result
}

async function triggerLazyMatching(gameIds: number[]): Promise<void> {
	const matched = await db.select({ gameId: gameIgdbMapping.gameId }).from(gameIgdbMapping).all()
	const matchedSet = new Set(matched.map((m) => m.gameId))
	gameIds
		.filter((id) => !matchedSet.has(id))
		.slice(0, 5)
		.forEach((id) => matchGameAsync(id))
}

function parseGenres(raw: string | null): string[] {
	if (!raw) return []
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
}
