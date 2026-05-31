import { db } from '@/lib/db'
import { gameHltbMapping, games, hltbCache } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { matchGameToHltb } from './match-game'

const HLTB_TTL_MS = 365 * 24 * 60 * 60 * 1000

const inFlight = new Set<number>()

export function matchHltbAsync(gameId: number): void {
	if (inFlight.has(gameId)) return
	inFlight.add(gameId)
	;(async () => {
		try {
			const existing = await db
				.select()
				.from(gameHltbMapping)
				.where(eq(gameHltbMapping.gameId, gameId))
				.get()
			if (existing) return

			const game = await db.select().from(games).where(eq(games.id, gameId)).get()
			if (!game) return

			const sourceName = game.name || (game.romPath?.split('/').pop() ?? String(gameId))
			const result = await matchGameToHltb(sourceName)

			await db
				.insert(gameHltbMapping)
				.values({
					gameId,
					hltbId: result.hltbId,
					hltbName: result.hltbName,
					matchConfidence: result.confidence,
					matchMethod: result.method,
					needsReview: result.needsReview,
				})
				.onConflictDoNothing()

			if (result.hltbId !== null && result.durations) {
				await db
					.insert(hltbCache)
					.values({
						hltbId: result.hltbId,
						name: result.hltbName ?? '',
						mainStorySeconds: result.durations.mainStory,
						mainExtrasSeconds: result.durations.mainExtras,
						completionistSeconds: result.durations.completionist,
						expiresAt: new Date(Date.now() + HLTB_TTL_MS),
					})
					.onConflictDoNothing()
			}
		} catch (e) {
			console.error(`[hltb] Async match failed for game ${gameId}:`, e)
		} finally {
			inFlight.delete(gameId)
		}
	})()
}
