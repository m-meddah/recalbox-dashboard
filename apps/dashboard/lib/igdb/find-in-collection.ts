import { db } from '@/lib/db'
import { gameIgdbMapping } from '@/lib/db/schema'
import { and, inArray, isNotNull } from 'drizzle-orm'

/**
 * Looks up collection games matching a list of IGDB IDs.
 * Used to resolve similar_games into games the user actually owns.
 * @returns Map<igdbId, gameId>
 */
export async function findCollectionGamesByIgdbIds(
	igdbIds: number[],
): Promise<Map<number, number>> {
	if (igdbIds.length === 0) return new Map()

	const rows = await db
		.select({ gameId: gameIgdbMapping.gameId, igdbId: gameIgdbMapping.igdbId })
		.from(gameIgdbMapping)
		.where(and(inArray(gameIgdbMapping.igdbId, igdbIds), isNotNull(gameIgdbMapping.igdbId)))
		.all()

	const pairs: [number, number][] = []
	for (const r of rows) {
		if (r.igdbId !== null) pairs.push([r.igdbId, r.gameId])
	}
	return new Map(pairs)
}
