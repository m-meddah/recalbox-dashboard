import { db } from '@/lib/db'
import { resolveArtworkUrls } from '@/lib/db/artwork'
import {
	gameHltbMapping,
	gameIgdbMapping,
	gameRatings,
	hltbCache,
	igdbGameCache,
	recommendationLog,
	recommendationSkip,
} from '@/lib/db/schema'
import { matchHltbAsync } from '@/lib/hltb/match-single'
import { isIgdbEnabled } from '@/lib/igdb/auth'
import { matchGameAsync } from '@/lib/igdb/match-single'
import { getUserProfile } from '@/lib/profile/get-profile'
import { and, count, eq, gt, inArray, isNotNull } from 'drizzle-orm'
import { gameIdentityKey } from './game-identity'
import { type RecommenderGameRow, loadRecommenderGames } from './games-cache'
import { loadRecommenderPlayStats } from './play-stats-cache'
import { type GameForScoring, type ScoringContext, scoreGame } from './score-game'
import { selectFinalists } from './select-finalists'
import { getSimilarityProvider } from './similarity-provider'
import type { RecommendationContext, ScoredGame } from './types'

const LAZY_MATCH_TOP_N = 30

// Single-flight registry: concurrent identical requests share one computation.
const inFlight = new Map<string, Promise<ScoredGame[]>>()

export function recommend(
	ctxInput: Omit<RecommendationContext, 'excludedGameIds'>,
	recalboxId?: string | null,
): Promise<ScoredGame[]> {
	// Collapse concurrent identical requests (React StrictMode's double-invoke, or
	// rapid duplicate submits) into a single computation. NOT a cache — the entry
	// is dropped the moment it settles, so a later reshuffle recomputes fresh and
	// the scoring jitter still yields variety. Also avoids logging the same
	// recommendation twice when StrictMode fires the request twice.
	const key = `${ctxInput.availableMinutes}:${ctxInput.mood}`
	const existing = inFlight.get(key)
	if (existing) return existing
	const promise = computeRecommendations(ctxInput, { recalboxId }).finally(() =>
		inFlight.delete(key),
	)
	inFlight.set(key, promise)
	return promise
}

export async function computeRecommendations(
	ctxInput: Omit<RecommendationContext, 'excludedGameIds'>,
	opts: { persist?: boolean; recalboxId?: string | null } = {},
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
			// Cached (short TTL): the whole-collection scan is the app's biggest
			// Turso row-read; a reshuffle burst reuses one snapshot. See games-cache.ts.
			loadRecommenderGames(),
			loadRecommenderPlayStats(),
			db.select().from(gameRatings).all(),
			loadIgdbRatings(),
			loadHltbDurations(),
		])

	const excludedGameIds = activeSkips.map((s) => s.gameId)
	const recommendationCtx: RecommendationContext = { ...ctxInput, excludedGameIds }
	const ratingsMap = new Map(ratings.map((r) => [r.gameId, r.rating]))

	// One game is several `games` rows. Every "already known" signal is recorded on
	// whichever row the user touched, so all of them are folded onto the identity
	// before scoring — otherwise the untouched twins escape the filters.
	const identityByGameId = new Map(gamesList.map((g) => [g.gameId, gameIdentityKey(g)]))
	const knownIdentities = buildKnownIdentities(
		gamesList,
		identityByGameId,
		statsMap,
		ratingsMap,
		profile.comfortGames,
	)
	const skippedIdentities = new Set(
		excludedGameIds.flatMap((id) => {
			const key = identityByGameId.get(id)
			return key ? [key] : []
		}),
	)
	const recentlyShown = await loadRecentlyShown(identityByGameId)

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
		knownIdentities,
		skippedIdentities,
	}

	const scored: ScoredGame[] = []
	for (const game of gamesList) {
		const releaseYear = game.releaseDate ? new Date(game.releaseDate).getFullYear() : null
		const g: GameForScoring = {
			gameId: game.gameId,
			identityKey: identityByGameId.get(game.gameId) ?? gameIdentityKey(game),
			name: game.name,
			system: game.system,
			imagePath: game.imagePath,
			videoPath: game.videoPath,
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

	let finalists = selectFinalists(scored)

	// Resolve the finalists' artwork here rather than letting each card 404 its way
	// through /api/media: one lookup covers the whole set, hits render straight from
	// object storage, and the misses this queues are what prefetchArtwork used to do.
	if (opts.recalboxId) {
		const recalboxId = opts.recalboxId
		const urls = await resolveArtworkUrls(
			db,
			recalboxId,
			finalists.flatMap((f) => [f.imagePath, f.videoPath]),
		).catch(() => new Map<string, string>())
		finalists = finalists.map((f) => ({
			...f,
			imageUrl: (f.imagePath && urls.get(f.imagePath)) || null,
			videoUrl: (f.videoPath && urls.get(f.videoPath)) || null,
		}))
	}

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
 *
 * Counted per identity, not per row: proposing Metal Slug on `neogeo` has to
 * penalise the `fbneo` copy too, or the reshuffle just swaps one twin for the other.
 */
async function loadRecentlyShown(
	identityByGameId: Map<number, string>,
): Promise<Map<string, number>> {
	const cutoff = new Date(Date.now() - ROTATION_WINDOW_HOURS * 60 * 60 * 1000)
	const rows = await db
		.select({ gameId: recommendationLog.gameId, shows: count() })
		.from(recommendationLog)
		.where(gt(recommendationLog.presentedAt, cutoff))
		.groupBy(recommendationLog.gameId)
		.all()

	const byIdentity = new Map<string, number>()
	for (const row of rows) {
		const key = identityByGameId.get(row.gameId)
		if (!key) continue
		byIdentity.set(key, (byIdentity.get(key) ?? 0) + row.shows)
	}
	return byIdentity
}

/**
 * Every identity the user demonstrably already knows — played on any of its rows,
 * hearted in EmulationStation, rated love/like, or held as a comfort game.
 *
 * The signals live on whichever ROM row the user actually touched, so they are
 * unioned across rows here. Without that fold, discovery kept proposing the
 * never-launched regional twin of a game sitting in the user's favorites.
 */
function buildKnownIdentities(
	gamesList: RecommenderGameRow[],
	identityByGameId: Map<number, string>,
	statsMap: Awaited<ReturnType<typeof loadRecommenderPlayStats>>,
	ratingsMap: Map<number, 'love' | 'like' | 'dislike' | 'unknown'>,
	comfortGames: number[],
): Set<string> {
	const known = new Set<string>()

	const mark = (gameId: number) => {
		const key = identityByGameId.get(gameId)
		if (key) known.add(key)
	}

	for (const game of gamesList) {
		if (!game.favorite) continue
		const key = identityByGameId.get(game.gameId)
		if (key) known.add(key)
	}

	for (const [gameId, stats] of statsMap) {
		const played = stats.measuredSessions > 0 || (stats.inherited?.playCount ?? 0) > 0
		if (played) mark(gameId)
	}

	for (const [gameId, rating] of ratingsMap) {
		if (rating === 'love' || rating === 'like') mark(gameId)
	}

	for (const gameId of comfortGames) mark(gameId)

	return known
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

export async function triggerLazyMatching(gameIds: number[]): Promise<void> {
	if (gameIds.length === 0) return
	// Only ask about the candidates, not the whole mapping table — this runs on
	// every recommend and used to full-scan game_igdb_mapping just to check ≤30 ids.
	const matched = await db
		.select({ gameId: gameIgdbMapping.gameId })
		.from(gameIgdbMapping)
		.where(inArray(gameIgdbMapping.gameId, gameIds))
		.all()
	const matchedSet = new Set(matched.map((m) => m.gameId))
	for (const id of gameIds.filter((id) => !matchedSet.has(id)).slice(0, 5)) {
		matchGameAsync(id)
	}
}

export async function triggerLazyHltbMatching(gameIds: number[]): Promise<void> {
	if (gameIds.length === 0) return
	const mapped = await db
		.select({ gameId: gameHltbMapping.gameId })
		.from(gameHltbMapping)
		.where(inArray(gameHltbMapping.gameId, gameIds))
		.all()
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
	statsMap: Awaited<ReturnType<typeof loadRecommenderPlayStats>>,
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
