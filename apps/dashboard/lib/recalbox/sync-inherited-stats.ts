import type { DB } from '@/lib/db/index'
import { gameInheritedStats, games } from '@/lib/db/schema'
import { and, eq, isNotNull, or, sql } from 'drizzle-orm'

export type InheritedStatsEntry = {
	gameId: number
	playCount: number
	lastPlayedAt: Date | null
	/** Cumulative play time in seconds. Defaults to 0 when unknown. */
	playTimeSeconds?: number
}

/**
 * Upsert inherited play stats into game_inherited_stats.
 *
 * Data comes from games.playCount / games.lastPlayed which are synced from
 * gamelist-userdata.ini during collection sync. Entries with zero plays, no
 * lastPlayedAt and no play time are skipped — they carry no useful signal.
 *
 * @returns Count of upserted and skipped entries.
 */
export async function syncInheritedStats(
	db: DB,
	entries: InheritedStatsEntry[],
): Promise<{ imported: number; skipped: number }> {
	let imported = 0
	let skipped = 0
	const now = new Date()

	for (const entry of entries) {
		const playTimeSeconds = entry.playTimeSeconds ?? 0
		if (entry.playCount === 0 && !entry.lastPlayedAt && playTimeSeconds === 0) {
			skipped++
			continue
		}

		await db
			.insert(gameInheritedStats)
			.values({
				gameId: entry.gameId,
				playCount: entry.playCount,
				lastPlayedAt: entry.lastPlayedAt,
				playTimeSeconds,
				lastSyncedAt: now,
			})
			.onConflictDoUpdate({
				target: gameInheritedStats.gameId,
				set: {
					playCount: entry.playCount,
					lastPlayedAt: entry.lastPlayedAt,
					playTimeSeconds,
					lastSyncedAt: now,
				},
			})

		imported++
	}

	return { imported, skipped }
}

/**
 * Read the inherited play stats already stored in `games` (playCount / lastPlayed /
 * playTimeSeconds, synced from gamelist-userdata.ini) and upsert them into
 * game_inherited_stats — the source of truth the recommendation algorithm reads.
 *
 * Only games carrying a play signal are considered. Called at the end of a
 * collection sync so recommendations stay in step without a manual import step.
 *
 * @param recalboxId - When provided, restricts the import to that instance's games.
 * @returns Count of upserted and skipped entries.
 */
export async function importInheritedStatsFromGames(
	db: DB,
	recalboxId?: string,
): Promise<{ imported: number; skipped: number }> {
	const hasSignal = or(
		sql`${games.playCount} > 0`,
		isNotNull(games.lastPlayed),
		sql`${games.playTimeSeconds} > 0`,
	)
	const where = recalboxId ? and(eq(games.recalboxId, recalboxId), hasSignal) : hasSignal

	const candidates = await db
		.select({
			id: games.id,
			playCount: games.playCount,
			lastPlayed: games.lastPlayed,
			playTimeSeconds: games.playTimeSeconds,
		})
		.from(games)
		.where(where)

	if (candidates.length === 0) return { imported: 0, skipped: 0 }

	return syncInheritedStats(
		db,
		candidates.map((g) => ({
			gameId: g.id,
			playCount: g.playCount ?? 0,
			lastPlayedAt: g.lastPlayed ?? null,
			playTimeSeconds: g.playTimeSeconds ?? 0,
		})),
	)
}
