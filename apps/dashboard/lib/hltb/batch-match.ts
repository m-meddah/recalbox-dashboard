import { db } from '@/lib/db'
import { games, gameHltbMapping, hltbCache } from '@/lib/db/schema'
import type { HltbMatchResult } from './match-game'
import { matchGameToHltb } from './match-game'

const HLTB_TTL_MS = 365 * 24 * 60 * 60 * 1000
const RATE_LIMIT_MS = 200
const CONCURRENCY = 2

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

	const existing = await db.select({ gameId: gameHltbMapping.gameId }).from(gameHltbMapping).all()
	const matchedSet = new Set(existing.map((e) => e.gameId))

	return all.filter((g) => !matchedSet.has(g.id))
}

async function persistResult(gameId: number, result: HltbMatchResult): Promise<void> {
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
	}
}

const NOT_GAME_PREFIX = /^zzz\(notgame\)/i
const NOT_FOUND_RESULT: HltbMatchResult = {
	hltbId: null,
	hltbName: null,
	confidence: 0,
	method: 'not_found',
	needsReview: false,
}

export async function batchMatchHltb(
	onProgress?: (p: HltbBatchProgress) => void,
): Promise<HltbBatchProgress> {
	const unmatched = await getUnmatchedGames()

	// Group by name so we call HLTB once per unique name
	const byName = new Map<string, GameRow[]>()
	for (const game of unmatched) {
		const key = (game.name || extractFilename(game.romPath)).trim()
		const group = byName.get(key) ?? []
		group.push(game)
		byName.set(key, group)
	}

	const groups = [...byName.entries()] // [name, games[]]

	const progress: HltbBatchProgress = {
		total: unmatched.length,
		done: 0,
		matched: 0,
		notFound: 0,
		needsReview: 0,
		errors: 0,
	}

	// Process with bounded concurrency
	let index = 0

	async function worker() {
		while (index < groups.length) {
			const [name, groupGames] = groups[index++]

			progress.current = name
			onProgress?.({ ...progress })

			let result: HltbMatchResult
			try {
				if (NOT_GAME_PREFIX.test(name)) {
					result = NOT_FOUND_RESULT
				} else {
					result = await matchGameToHltb(name)
					await new Promise((r) => setTimeout(r, RATE_LIMIT_MS))
				}
			} catch (e) {
				console.error(`[hltb] Batch match failed for "${name}":`, e)
				result = NOT_FOUND_RESULT
				progress.errors++
			}

			// Apply result to all games with this name
			for (const game of groupGames) {
				try {
					await persistResult(game.id, result)
				} catch (e) {
					console.error(`[hltb] Failed to persist result for game ${game.id}:`, e)
					progress.errors++
				}
				progress.done++
				if (result.hltbId !== null) {
					progress.matched++
				} else {
					progress.notFound++
				}
				if (result.needsReview) progress.needsReview++
			}

			onProgress?.({ ...progress })
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, worker))

	progress.current = undefined
	onProgress?.({ ...progress })
	return progress
}

function extractFilename(path: string): string {
	return path.split('/').pop()?.split('\\').pop() ?? path
}
