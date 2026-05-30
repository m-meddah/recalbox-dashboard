import { db } from '@/lib/db'
import { gameIgdbMapping, gameInheritedStats, games, sessions } from '@/lib/db/schema'
import { eq, or, sql } from 'drizzle-orm'
import { matchGameToIgdb, type MatchResult } from './match-game'

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

const NOT_GAME_PREFIX = /^zzz\(notgame\)/i

const NOT_FOUND_RESULT: MatchResult = {
	igdbId: null,
	igdbName: null,
	confidence: 0,
	method: 'not_found',
	needsReview: false,
	candidates: [],
}

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
	// Group by (name, system) — one IGDB call per unique (name, system) pair
	const byKey = new Map<string, { name: string; system: string; games: GameRow[] }>()
	for (const game of gameRows) {
		const name = (game.name || extractFilename(game.romPath)).trim()
		const key = `${name}|${game.system}`
		const group = byKey.get(key) ?? { name, system: game.system, games: [] }
		group.games.push(game)
		byKey.set(key, group)
	}

	const progress: BatchProgress = {
		total: gameRows.length,
		done: 0,
		matched: 0,
		notFound: 0,
		needsReview: 0,
		errors: 0,
	}

	for (const { name, system, games: groupGames } of byKey.values()) {
		progress.current = name
		onProgress?.(progress)

		let result: MatchResult
		try {
			if (NOT_GAME_PREFIX.test(name)) {
				result = NOT_FOUND_RESULT
			} else {
				result = await matchGameToIgdb({ romName: name, recalboxSystem: system })
			}
		} catch (e) {
			console.error(`[igdb] Batch match failed for "${name}":`, e)
			result = NOT_FOUND_RESULT
			progress.errors++
		}

		// Apply result to all games sharing this (name, system)
		for (const game of groupGames) {
			try {
				await db
					.insert(gameIgdbMapping)
					.values({
						gameId: game.id,
						igdbId: result.igdbId,
						igdbName: result.igdbName,
						matchConfidence: result.confidence,
						matchMethod: result.method,
						needsReview: result.needsReview,
						candidates: result.candidates.length > 0 ? JSON.stringify(result.candidates) : null,
					})
					.onConflictDoUpdate({
						target: gameIgdbMapping.gameId,
						set: {
							igdbId: result.igdbId,
							igdbName: result.igdbName,
							matchConfidence: result.confidence,
							matchMethod: result.method,
							needsReview: result.needsReview,
							candidates: result.candidates.length > 0 ? JSON.stringify(result.candidates) : null,
							matchedAt: new Date(),
						},
					})
			} catch (e) {
				console.error(`[igdb] Failed to persist result for game ${game.id}:`, e)
				progress.errors++
			}
			progress.done++
			if (result.igdbId !== null) progress.matched++
			else progress.notFound++
			if (result.needsReview) progress.needsReview++
		}

		onProgress?.(progress)
	}

	progress.current = undefined
	onProgress?.(progress)
	return progress
}

function extractFilename(path: string): string {
	return path.split('/').pop()?.split('\\').pop() ?? path
}
