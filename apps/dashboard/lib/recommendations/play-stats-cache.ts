import { type GamePlayStats, getGamePlayStatsBatch } from '@/lib/games/play-stats'

/**
 * `getGamePlayStatsBatch()` with no ids does THREE full-table scans (`sessions`,
 * `gameInheritedStats`, `gameCalibration`) — and `recommend()` calls it on every
 * request and every reshuffle. Like the games snapshot (`games-cache.ts`), a short
 * in-memory TTL collapses a reshuffle burst into one read set, cutting the Turso
 * row-read cost this codebase is careful about.
 *
 * Play stats drift as sessions land, but a few minutes of staleness on a "play
 * tonight" hint is invisible; the skip button and explicit ratings are separate,
 * live paths. TTL-only (no event invalidation) on purpose — active play would
 * otherwise invalidate it constantly and defeat the point.
 */
export const RECOMMENDER_PLAYSTATS_TTL_MS = 5 * 60_000

let cache: { map: Map<number, GamePlayStats>; expiresAt: number } | null = null

/** All-games play stats for the recommender, served from a short-lived snapshot. */
export async function loadRecommenderPlayStats(
	now: () => number = Date.now,
): Promise<Map<number, GamePlayStats>> {
	const t = now()
	if (cache && cache.expiresAt > t) return cache.map
	const map = await getGamePlayStatsBatch()
	cache = { map, expiresAt: t + RECOMMENDER_PLAYSTATS_TTL_MS }
	return map
}

/** Drop the snapshot (test isolation). */
export function clearRecommenderPlayStatsCache(): void {
	cache = null
}
