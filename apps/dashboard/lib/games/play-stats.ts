import { db } from '@/lib/db'
import { gameCalibration, gameInheritedStats, sessions } from '@/lib/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'

/**
 * Consolidated stats for a game, combining:
 * - Scrobbled sessions (with their classification)
 * - Inherited stats from gamelist userdata (playCount + lastPlayedAt)
 * - User calibration (declared or auto-inferred engagement verdict)
 *
 * Used by the recommendation algorithm, the taste profile builder, and
 * enriched stats pages.
 */
export type GamePlayStats = {
	gameId: number

	// Measured sessions (scrobbler source only)
	totalSessions: number
	measuredSessions: number // alias for clarity

	totalPlaytimeSeconds: number

	// Per-classification counts
	noiseCount: number
	bounceCount: number
	tasteCount: number
	meaningfulCount: number
	marathonCount: number

	// Derived
	/** bounceCount / sessions-excluding-noise. 0 when no signal. */
	bounceRate: number
	/** meaningful + marathon: the strongest engagement signal. */
	significantSessions: number

	// Timestamps
	firstPlayedAt: Date | null
	lastPlayedAt: Date | null
	/** Date of the last meaningful or marathon session. */
	lastMeaningfulPlayAt: Date | null

	// Inherited (null when absent)
	inherited: {
		playCount: number
		lastPlayedAt: Date | null
	} | null

	// User calibration (null when absent)
	calibration: {
		engagement: 'high' | 'medium' | 'bounced' | 'unknown'
		source: 'user' | 'auto_inferred'
	} | null
}

/**
 * Returns consolidated stats for a single game, or null if the game has
 * no trace in sessions, inherited stats, or calibration.
 */
export async function getGamePlayStats(gameId: number): Promise<GamePlayStats | null> {
	const map = await getGamePlayStatsBatch([gameId])
	return map.get(gameId) ?? null
}

/**
 * Returns consolidated stats for multiple games in a single round-trip per source.
 *
 * @param gameIds - IDs to fetch. If omitted, returns all games with any trace.
 * @returns Map keyed by gameId.
 */
export async function getGamePlayStatsBatch(
	gameIds?: number[],
): Promise<Map<number, GamePlayStats>> {
	const gameFilter =
		gameIds && gameIds.length > 0 ? inArray(sessions.gameId, gameIds) : undefined

	// Session aggregates (scrobbler only)
	const sessionAgg = await db
		.select({
			gameId: sessions.gameId,
			total: sql<number>`COUNT(*)`,
			totalPlaytime: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)`,
			noiseCount: sql<number>`SUM(CASE WHEN ${sessions.classification} = 'noise' THEN 1 ELSE 0 END)`,
			bounceCount: sql<number>`SUM(CASE WHEN ${sessions.classification} = 'bounce' THEN 1 ELSE 0 END)`,
			tasteCount: sql<number>`SUM(CASE WHEN ${sessions.classification} = 'taste' THEN 1 ELSE 0 END)`,
			meaningfulCount: sql<number>`SUM(CASE WHEN ${sessions.classification} = 'meaningful' THEN 1 ELSE 0 END)`,
			marathonCount: sql<number>`SUM(CASE WHEN ${sessions.classification} = 'marathon' THEN 1 ELSE 0 END)`,
			firstPlayedAt: sql<number | null>`MIN(${sessions.startedAt})`,
			lastPlayedAt: sql<number | null>`MAX(${sessions.startedAt})`,
			lastMeaningfulPlayAt: sql<number | null>`
        MAX(CASE
          WHEN ${sessions.classification} IN ('meaningful', 'marathon')
          THEN ${sessions.startedAt}
          ELSE NULL
        END)
      `,
		})
		.from(sessions)
		.where(and(eq(sessions.source, 'scrobbler'), gameFilter))
		.groupBy(sessions.gameId)

	// Inherited stats
	const inheritedFilter =
		gameIds && gameIds.length > 0
			? inArray(gameInheritedStats.gameId, gameIds)
			: undefined
	const inheritedAll = await db
		.select()
		.from(gameInheritedStats)
		.where(inheritedFilter)

	// Calibrations
	const calibFilter =
		gameIds && gameIds.length > 0
			? inArray(gameCalibration.gameId, gameIds)
			: undefined
	const calibAll = await db.select().from(gameCalibration).where(calibFilter)

	// Build lookup maps
	const inheritedMap = new Map(inheritedAll.map((i) => [i.gameId, i]))
	const calibMap = new Map(calibAll.map((c) => [c.gameId, c]))

	// Union of all known gameIds across sources
	const allGameIds = new Set<number>([
		...sessionAgg.map((s) => s.gameId).filter((id): id is number => id != null),
		...inheritedAll.map((i) => i.gameId),
		...calibAll.map((c) => c.gameId),
	])

	const result = new Map<number, GamePlayStats>()

	for (const gameId of allGameIds) {
		const s = sessionAgg.find((a) => a.gameId === gameId)
		const inh = inheritedMap.get(gameId)
		const cal = calibMap.get(gameId)

		const total = Number(s?.total ?? 0)
		const noiseCount = Number(s?.noiseCount ?? 0)
		const bounceCount = Number(s?.bounceCount ?? 0)
		const tasteCount = Number(s?.tasteCount ?? 0)
		const meaningfulCount = Number(s?.meaningfulCount ?? 0)
		const marathonCount = Number(s?.marathonCount ?? 0)
		const sessionsExcludingNoise = total - noiseCount

		// SQLite stores timestamps as unix seconds; Drizzle mode:'timestamp'
		// gives us Date objects already for columns declared that way, but
		// sql<number> template columns return raw unix-second integers.
		const toDate = (v: number | null | undefined): Date | null =>
			v != null ? new Date(v * 1000) : null

		result.set(gameId, {
			gameId,
			totalSessions: total,
			measuredSessions: total,
			totalPlaytimeSeconds: Number(s?.totalPlaytime ?? 0),
			noiseCount,
			bounceCount,
			tasteCount,
			meaningfulCount,
			marathonCount,
			bounceRate: sessionsExcludingNoise > 0 ? bounceCount / sessionsExcludingNoise : 0,
			significantSessions: meaningfulCount + marathonCount,
			firstPlayedAt: toDate(s?.firstPlayedAt),
			lastPlayedAt: toDate(s?.lastPlayedAt),
			lastMeaningfulPlayAt: toDate(s?.lastMeaningfulPlayAt),
			inherited: inh
				? {
						playCount: inh.playCount,
						lastPlayedAt: inh.lastPlayedAt,
					}
				: null,
			calibration: cal
				? {
						engagement: cal.engagement,
						source: cal.source,
					}
				: null,
		})
	}

	return result
}
