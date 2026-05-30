import { db } from '@/lib/db'
import { games, gameHltbMapping, hltbCache } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import { matchGameToHltb } from './match-game'

const HLTB_TTL_MS = 365 * 24 * 60 * 60 * 1000
const RATE_LIMIT_MS = 500

export type HltbBatchProgress = {
	total: number
	done: number
	matched: number
	notFound: number
	needsReview: number
	errors: number
	current?: string
}

type GameRow = { id: number; name: string; romPath: string }

async function getUnmatchedGames(): Promise<GameRow[]> {
	const all = await db
		.select({ id: games.id, name: games.name, romPath: games.romPath })
		.from(games)
		.all()

	if (all.length === 0) return []

	const ids = all.map((g) => g.id)
	const existing = await db
		.select({ gameId: gameHltbMapping.gameId })
		.from(gameHltbMapping)
		.where(inArray(gameHltbMapping.gameId, ids))
		.all()
	const matchedSet = new Set(existing.map((e) => e.gameId))

	return all.filter((g) => !matchedSet.has(g.id))
}

export async function batchMatchHltb(
	onProgress?: (p: HltbBatchProgress) => void,
): Promise<HltbBatchProgress> {
	const toMatch = await getUnmatchedGames()
	const progress: HltbBatchProgress = {
		total: toMatch.length,
		done: 0,
		matched: 0,
		notFound: 0,
		needsReview: 0,
		errors: 0,
	}

	for (const game of toMatch) {
		progress.current = game.name
		onProgress?.(progress)

		try {
			const sourceName = game.name || extractFilename(game.romPath)
			const result = await matchGameToHltb(sourceName)

			await db
				.insert(gameHltbMapping)
				.values({
					gameId: game.id,
					hltbId: result.hltbId,
					hltbName: result.hltbName,
					matchConfidence: result.confidence,
					matchMethod: result.method,
					needsReview: result.needsReview,
				})
				.onConflictDoUpdate({
					target: gameHltbMapping.gameId,
					set: {
						hltbId: result.hltbId,
						hltbName: result.hltbName,
						matchConfidence: result.confidence,
						matchMethod: result.method,
						needsReview: result.needsReview,
						matchedAt: new Date(),
					},
				})

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
					.onConflictDoUpdate({
						target: hltbCache.hltbId,
						set: {
							name: result.hltbName ?? '',
							mainStorySeconds: result.durations.mainStory,
							mainExtrasSeconds: result.durations.mainExtras,
							completionistSeconds: result.durations.completionist,
							fetchedAt: new Date(),
							expiresAt: new Date(Date.now() + HLTB_TTL_MS),
						},
					})
				progress.matched++
			} else {
				progress.notFound++
			}

			if (result.needsReview) progress.needsReview++
		} catch (e) {
			console.error(`[hltb] Batch match failed for ${game.name}:`, e)
			progress.errors++
		}

		progress.done++
		onProgress?.(progress)

		await new Promise((r) => setTimeout(r, RATE_LIMIT_MS))
	}

	progress.current = undefined
	onProgress?.(progress)
	return progress
}

function extractFilename(path: string): string {
	return path.split('/').pop()?.split('\\').pop() ?? path
}
