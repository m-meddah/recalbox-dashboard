import type { DB } from '@/lib/db/index'
import { gameInheritedStats } from '@/lib/db/schema'

export type InheritedStatsEntry = {
	gameId: number
	playCount: number
	lastPlayedAt: Date | null
}

/**
 * Upsert inherited play stats into game_inherited_stats.
 *
 * Data comes from games.playCount / games.lastPlayed which are synced from
 * gamelist-userdata.ini during collection sync. Entries with zero plays and
 * no lastPlayedAt are skipped — they carry no useful signal.
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
		if (entry.playCount === 0 && !entry.lastPlayedAt) {
			skipped++
			continue
		}

		await db
			.insert(gameInheritedStats)
			.values({
				gameId: entry.gameId,
				playCount: entry.playCount,
				lastPlayedAt: entry.lastPlayedAt,
				lastSyncedAt: now,
			})
			.onConflictDoUpdate({
				target: gameInheritedStats.gameId,
				set: {
					playCount: entry.playCount,
					lastPlayedAt: entry.lastPlayedAt,
					lastSyncedAt: now,
				},
			})

		imported++
	}

	return { imported, skipped }
}
