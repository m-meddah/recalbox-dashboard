import { db } from '@/lib/db'
import {
	gameHltbMapping,
	gameIgdbMapping,
	gameRatings,
	games,
	hltbCache,
	igdbGameCache,
	recommendationLog,
	recommendationSkip,
} from '@/lib/db/schema'
import { getGamePlayStatsBatch } from '@/lib/games/play-stats'
import { matchHltbAsync } from '@/lib/hltb/match-single'
import { isIgdbEnabled } from '@/lib/igdb/auth'
import { matchGameAsync } from '@/lib/igdb/match-single'
import { getUserProfile } from '@/lib/profile/get-profile'
import { and, eq, gt, isNotNull } from 'drizzle-orm'
import { type GameForScoring, type ScoringContext, scoreGame } from './score-game'
import { selectFinalists } from './select-finalists'
import { getSimilarityProvider } from './similarity-provider'
import type { RecommendationContext, ScoredGame } from './types'

const LAZY_MATCH_TOP_N = 30

export async function recommend(
	ctxInput: Omit<RecommendationContext, 'excludedGameIds'>,
): Promise<ScoredGame[]> {
	const [profile, activeSkips, gamesList, statsMap, ratings, igdbRatingsMap, hltbDurationsMap] =
		await Promise.all([
			getUserProfile(),
			db
				.select({ gameId: recommendationSkip.gameId })
				.from(recommendationSkip)
				.where(gt(recommendationSkip.expiresAt, new Date()))
				.all(),
			db
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
				.all(),
			getGamePlayStatsBatch(),
			db.select().from(gameRatings).all(),
			loadIgdbRatings(),
			loadHltbDurations(),
		])

	const excludedGameIds = activeSkips.map((s) => s.gameId)
	const recommendationCtx: RecommendationContext = { ...ctxInput, excludedGameIds }
	const ratingsMap = new Map(ratings.map((r) => [r.gameId, r.rating]))

	const provider = await getSimilarityProvider()
	const similarToComfortGames = await provider.getSimilarToAny(profile.comfortGames)

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
			hltbDurations: hltbDurationsMap.get(game.gameId) ?? null,
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

	triggerLazyHltbMatching(scored.slice(0, LAZY_MATCH_TOP_N).map((c) => c.gameId))

	return finalists
}

type HltbDurations = {
	mainStory: number | null
	mainExtras: number | null
	completionist: number | null
}

async function loadHltbDurations(): Promise<Map<number, HltbDurations>> {
	const rows = await db
		.select({
			gameId: gameHltbMapping.gameId,
			mainStory: hltbCache.mainStorySeconds,
			mainExtras: hltbCache.mainExtrasSeconds,
			completionist: hltbCache.completionistSeconds,
		})
		.from(gameHltbMapping)
		.innerJoin(hltbCache, eq(hltbCache.hltbId, gameHltbMapping.hltbId))
		.where(isNotNull(gameHltbMapping.hltbId))
		.all()

	return new Map(
		rows.map((r) => [
			r.gameId,
			{ mainStory: r.mainStory, mainExtras: r.mainExtras, completionist: r.completionist },
		]),
	)
}

async function loadIgdbRatings(): Promise<Map<number, number>> {
	const rows = await db
		.select({ gameId: gameIgdbMapping.gameId, rating: igdbGameCache.rating })
		.from(gameIgdbMapping)
		.innerJoin(igdbGameCache, eq(igdbGameCache.igdbId, gameIgdbMapping.igdbId))
		.where(isNotNull(igdbGameCache.rating))
		.all()

	return new Map(rows.map((r) => [r.gameId, r.rating as number]))
}

async function triggerLazyMatching(gameIds: number[]): Promise<void> {
	const matched = await db.select({ gameId: gameIgdbMapping.gameId }).from(gameIgdbMapping).all()
	const matchedSet = new Set(matched.map((m) => m.gameId))
	for (const id of gameIds.filter((id) => !matchedSet.has(id)).slice(0, 5)) {
		matchGameAsync(id)
	}
}

async function triggerLazyHltbMatching(gameIds: number[]): Promise<void> {
	const mapped = await db.select({ gameId: gameHltbMapping.gameId }).from(gameHltbMapping).all()
	const mappedSet = new Set(mapped.map((m) => m.gameId))
	for (const id of gameIds) {
		if (!mappedSet.has(id)) matchHltbAsync(id)
	}
}

function parseGenres(raw: string | null): string[] {
	if (!raw) return []
	return raw.split(',').flatMap((s) => {
		const t = s.trim()
		return t ? [t] : []
	})
}
