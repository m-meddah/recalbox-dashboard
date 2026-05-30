import { db } from '@/lib/db'
import { gameIgdbMapping, gameInheritedStats, games, sessions } from '@/lib/db/schema'
import { eq, gt, or, sql } from 'drizzle-orm'
import { matchGameToIgdb } from './match-game'

export type BatchProgress = {
	total: number
	done: number
	matched: number
	notFound: number
	needsReview: number
	errors: number
	current?: string
}

type GameRow = { id: number; name: string; system: string; romPath: string }

async function getPlayedGames(): Promise<GameRow[]> {
	return db
		.select({
			id: games.id,
			name: games.name,
			system: games.system,
			romPath: games.romPath,
		})
		.from(games)
		.where(
			or(
				sql`EXISTS (SELECT 1 FROM ${sessions} WHERE ${sessions.gameId} = ${games.id} AND ${sessions.source} = 'scrobbler')`,
				sql`EXISTS (SELECT 1 FROM ${gameInheritedStats} WHERE ${gameInheritedStats.gameId} = ${games.id} AND ${gameInheritedStats.playCount} >= 1)`,
				eq(games.favorite, true),
			),
		)
		.all()
}

async function filterUnmatched(gameRows: GameRow[]): Promise<GameRow[]> {
	if (gameRows.length === 0) return []
	const existing = await db.select({ gameId: gameIgdbMapping.gameId }).from(gameIgdbMapping).all()
	const matched = new Set(existing.map((e) => e.gameId))
	return gameRows.filter((g) => !matched.has(g.id))
}

export async function batchMatchPlayedGames(
	onProgress?: (p: BatchProgress) => void,
): Promise<BatchProgress> {
	const played = await getPlayedGames()
	const toMatch = await filterUnmatched(played)
	return runBatch(toMatch, onProgress)
}

export async function batchMatchAll(
	onProgress?: (p: BatchProgress) => void,
): Promise<BatchProgress> {
	const all = await db
		.select({ id: games.id, name: games.name, system: games.system, romPath: games.romPath })
		.from(games)
		.all()
	const toMatch = await filterUnmatched(all)
	return runBatch(toMatch, onProgress)
}

async function runBatch(
	gameRows: GameRow[],
	onProgress?: (p: BatchProgress) => void,
): Promise<BatchProgress> {
	const progress: BatchProgress = {
		total: gameRows.length,
		done: 0,
		matched: 0,
		notFound: 0,
		needsReview: 0,
		errors: 0,
	}

	for (const game of gameRows) {
		progress.current = game.name
		onProgress?.(progress)

		try {
			const sourceName = game.name || extractFilename(game.romPath)
			const result = await matchGameToIgdb({ romName: sourceName, recalboxSystem: game.system })

			await db
				.insert(gameIgdbMapping)
				.values({
					gameId: game.id,
					igdbId: result.igdbId,
					igdbName: result.igdbName,
					matchConfidence: result.confidence,
					matchMethod: result.method,
					needsReview: result.needsReview,
				})
				.onConflictDoUpdate({
					target: gameIgdbMapping.gameId,
					set: {
						igdbId: result.igdbId,
						igdbName: result.igdbName,
						matchConfidence: result.confidence,
						matchMethod: result.method,
						needsReview: result.needsReview,
						matchedAt: new Date(),
					},
				})

			if (result.igdbId === null) progress.notFound++
			else progress.matched++
			if (result.needsReview) progress.needsReview++
		} catch (e) {
			console.error(`[igdb] Match failed for ${game.name}:`, e)
			progress.errors++
		}

		progress.done++
		onProgress?.(progress)
	}

	progress.current = undefined
	onProgress?.(progress)
	return progress
}

function extractFilename(path: string): string {
	return path.split('/').pop()?.split('\\').pop() ?? path
}
