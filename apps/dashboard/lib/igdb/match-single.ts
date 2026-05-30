import { db } from '@/lib/db'
import { gameIgdbMapping, games } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isIgdbEnabled } from './auth'
import { matchGameToIgdb } from './match-game'

const inFlight = new Set<number>()

/**
 * Fire-and-forget async match for a single game.
 * Idempotent: skips if already in flight or already matched.
 * No-op if IGDB is disabled.
 */
export function matchGameAsync(gameId: number): void {
	if (inFlight.has(gameId)) return
	inFlight.add(gameId)
	;(async () => {
		try {
			if (!(await isIgdbEnabled())) return

			const existing = await db
				.select()
				.from(gameIgdbMapping)
				.where(eq(gameIgdbMapping.gameId, gameId))
				.get()
			if (existing) return

			const game = await db.select().from(games).where(eq(games.id, gameId)).get()
			if (!game) return

			const sourceName = game.name || (game.romPath?.split('/').pop() ?? String(gameId))
			const result = await matchGameToIgdb({ romName: sourceName, recalboxSystem: game.system })

			await db
				.insert(gameIgdbMapping)
				.values({
					gameId,
					igdbId: result.igdbId,
					igdbName: result.igdbName,
					matchConfidence: result.confidence,
					matchMethod: result.method,
					needsReview: result.needsReview,
					candidates: result.candidates.length > 0 ? JSON.stringify(result.candidates) : null,
				})
				.onConflictDoNothing()
		} catch (e) {
			console.error(`[igdb] Async match failed for game ${gameId}:`, e)
		} finally {
			inFlight.delete(gameId)
		}
	})()
}
