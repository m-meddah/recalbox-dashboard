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
import { and, count, eq, gt, isNotNull } from 'drizzle-orm'
import { type GameForScoring, type ScoringContext, scoreGame } from './score-game'
import { selectFinalists } from './select-finalists'
import { getSimilarityProvider } from './similarity-provider'
import type { RecommendationContext, ScoredGame } from './types'

const LAZY_MATCH_TOP_N = 30

// Single-flight registry: concurrent identical requests share one computation.
const inFlight = new Map<string, Promise<ScoredGame[]>>()

export function recommend(
	ctxInput: Omit<RecommendationContext, 'excludedGameIds'>,
): Promise<ScoredGame[]> {
	// Collapse concurrent identical requests (React StrictMode's double-invoke, or
	// rapid duplicate submits) into a single computation. NOT a cache — the entry
	// is dropped the moment it settles, so a later reshuffle recomputes fresh and
	// the scoring jitter still yields variety. Also avoids logging the same
	// recommendation twice when StrictMode fires the request twice.
	const key = `${ctxInput.availableMinutes}:${ctxInput.mood}`
	const existing = inFlight.get(key)
	if (existing) return existing
	const promise = computeRecommendations(ctxInput).finally(() => inFlight.delete(key))
	inFlight.set(key, promise)
	return promise
}

export async function computeRecommendations(
	ctxInput: Omit<RecommendationContext, 'excludedGameIds'>,
	opts: { persist?: boolean } = {},
): Promise<ScoredGame[]> {
	const persist = opts.persist !== false
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
					favorite: games.favorite,
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
	const recentlyShown = await loadRecentlyShown()

	const provider = await getSimilarityProvider()
	// In discovery mood we broaden the IGDB anchor set beyond the comfort games so
	// the "similar to favorite" boost can pull in fresh, never-played titles instead
	// of funnelling through the same handful of cached comfort anchors. Other moods
	// keep the comfort-game anchors only.
	const similarityAnchors =
		ctxInput.mood === 'discovery'
			? buildDiscoveryAnchors(profile.comfortGames, statsMap, ratingsMap)
			: profile.comfortGames
	const similarToComfortGames = await provider.getSimilarToAny(similarityAnchors)

	const scoringCtx: ScoringContext = {
		profile,
		similarToComfortGames,
		recommendationCtx,
		recentlyShown,
	}

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
			favorite: game.favorite,
			hltbDurations: hltbDurationsMap.get(game.gameId) ?? null,
		}
		const result = scoreGame(g, scoringCtx)
		if (result) scored.push(result)
	}

	const finalists = selectFinalists(scored)

	// Single batched INSERT — writes go to the Turso primary, so one round-trip
	// instead of one per finalist.
	if (persist && finalists.length > 0) {
		await db.insert(recommendationLog).values(
			finalists.map((f) => ({
				gameId: f.gameId,
				contextTimeMinutes: recommendationCtx.availableMinutes,
				contextMood: recommendationCtx.mood,
				score: f.score,
				confidence: f.confidence,
				reasons: f.reasons,
			})),
		)
	}

	if (persist) {
		if (await isIgdbEnabled()) {
			triggerLazyMatching(scored.slice(0, LAZY_MATCH_TOP_N).map((c) => c.gameId))
		}
		triggerLazyHltbMatching(scored.slice(0, LAZY_MATCH_TOP_N).map((c) => c.gameId))
	}

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

const ROTATION_WINDOW_HOURS = 12

/**
 * How many times each game was presented in the recent rotation window. Feeds the
 * anti-repetition penalty so reshuffles surface fresh games instead of the same
 * high-scoring finalists every time. Indexed on presented_at, so this stays cheap.
 */
async function loadRecentlyShown(): Promise<Map<number, number>> {
	const cutoff = new Date(Date.now() - ROTATION_WINDOW_HOURS * 60 * 60 * 1000)
	const rows = await db
		.select({ gameId: recommendationLog.gameId, shows: count() })
		.from(recommendationLog)
		.where(gt(recommendationLog.presentedAt, cutoff))
		.groupBy(recommendationLog.gameId)
		.all()
	return new Map(rows.map((r) => [r.gameId, r.shows]))
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

const DISCOVERY_EXTRA_ANCHORS = 12

/**
 * Anchor set for the discovery similarity boost: the comfort games plus the user's
 * strongest taste signals — `love`-rated games and the most-played titles (by
 * inherited gamelist playtime, since the scrobbler may have no sessions yet). A
 * wider seed pool means the IGDB "similar to favorite" boost reaches more
 * never-played candidates rather than the same comfort-anchor neighbours.
 */
function buildDiscoveryAnchors(
	comfortGames: number[],
	statsMap: Awaited<ReturnType<typeof getGamePlayStatsBatch>>,
	ratingsMap: Map<number, 'love' | 'like' | 'dislike' | 'unknown'>,
): number[] {
	const anchors = new Set<number>(comfortGames)

	for (const [gameId, rating] of ratingsMap) {
		if (rating === 'love') anchors.add(gameId)
	}

	const topPlayed = Array.from(statsMap.entries())
		.flatMap(([gameId, stats]) => {
			const seconds = stats.inherited?.playTimeSeconds ?? 0
			return seconds > 0 ? [[gameId, seconds] as const] : []
		})
		.sort((a, b) => b[1] - a[1])
		.slice(0, DISCOVERY_EXTRA_ANCHORS)
	for (const [gameId] of topPlayed) anchors.add(gameId)

	return Array.from(anchors)
}

function parseGenres(raw: string | null): string[] {
	if (!raw) return []
	return raw.split(',').flatMap((s) => {
		const t = s.trim()
		return t ? [t] : []
	})
}
