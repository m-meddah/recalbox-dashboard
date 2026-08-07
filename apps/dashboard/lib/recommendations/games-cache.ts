import { db } from '@/lib/db'
import { games } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * The recommender scores EVERY non-hidden game, so it reads the whole `games`
 * table (~70k rows on a full collection) on each call. On Turso that scan is the
 * single biggest row-read cost in the app, and a play-tonight reshuffle burst
 * repeats it several times in a row.
 *
 * The collection changes rarely (only when the agent pushes a new gamelist —
 * every 6h at most, often disabled), so a short in-memory TTL snapshot collapses
 * a whole burst of recommend calls into one table read. It also cuts latency:
 * a warm serverless instance serves finalists without a Turso round-trip.
 *
 * Scoped to the STABLE input only — skips, ratings and play-stats stay live so
 * the skip button and just-finished sessions still take effect immediately.
 */
export const RECOMMENDER_GAMES_TTL_MS = 5 * 60_000

export type RecommenderGameRow = {
	gameId: number
	name: string
	system: string
	imagePath: string | null
	videoPath: string | null
	genres: string | null
	releaseDate: Date | null
	developer: string | null
	scrapedRating: number | null
	favorite: boolean
}

let cache: { rows: RecommenderGameRow[]; expiresAt: number } | null = null

/** Non-hidden games for scoring, served from a short-lived in-memory snapshot. */
export async function loadRecommenderGames(
	now: () => number = Date.now,
): Promise<RecommenderGameRow[]> {
	const t = now()
	if (cache && cache.expiresAt > t) return cache.rows

	const rows = await db
		.select({
			gameId: games.id,
			name: games.name,
			system: games.system,
			imagePath: games.imagePath,
			videoPath: games.videoPath,
			genres: games.genre,
			releaseDate: games.releaseDate,
			developer: games.developer,
			scrapedRating: games.rating,
			favorite: games.favorite,
		})
		.from(games)
		.where(eq(games.hidden, false))
		.all()

	cache = { rows, expiresAt: t + RECOMMENDER_GAMES_TTL_MS }
	return rows
}

/** Drop the snapshot — call after a collection import, or for test isolation. */
export function clearRecommenderGamesCache(): void {
	cache = null
}
