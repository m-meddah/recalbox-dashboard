import path from 'node:path'
import { db } from '@/lib/db'
import { raGameMapping } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getGameList } from '@retroachievements/api'
import { and, eq } from 'drizzle-orm'
import { getAuth } from './auth'
import { getCached, getTtlSeconds, setCached } from './cache'
import { withRateLimit } from './rate-limiter'

const SYSTEM_TO_RA_CONSOLE_ID: Record<string, number> = {
	megadrive: 1,
	n64: 2,
	snes: 3,
	gb: 4,
	gba: 5,
	gbc: 6,
	nes: 7,
	pcengine: 8,
	segacd: 9,
	sega32x: 10,
	mastersystem: 11,
	xbox: 12,
	atari2600: 25,
	dos: 15,
	neogeo: 56,
	psx: 12,
	virtualboy: 28,
	gameandwatch: 52,
	ngp: 14,
	ngpc: 14,
	dreamcast: 40,
	saturn: 39,
	arcade: 27,
	fba: 27,
	mame: 27,
	gw: 52,
}

function levenshtein(a: string, b: string): number {
	const m = a.length
	const n = b.length
	// prev[j] = edit distance between a[0..i-1] and b[0..j-1]
	let prev = Array.from({ length: n + 1 }, (_, j) => j)
	for (let i = 1; i <= m; i++) {
		const curr = [i, ...Array(n).fill(0)] as number[]
		for (let j = 1; j <= n; j++) {
			curr[j] =
				a[i - 1] === b[j - 1]
					? (prev[j - 1] ?? 0)
					: 1 + Math.min(prev[j] ?? 0, curr[j - 1] ?? 0, prev[j - 1] ?? 0)
		}
		prev = curr
	}
	return prev[n] ?? 0
}

function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

function similarityScore(a: string, b: string): number {
	const na = normalizeTitle(a)
	const nb = normalizeTitle(b)
	if (!na || !nb) return 0
	const maxLen = Math.max(na.length, nb.length)
	if (maxLen === 0) return 1
	return 1 - levenshtein(na, nb) / maxLen
}

async function getGameListCached(consoleId: number) {
	const cacheKey = `gameList:${consoleId}`
	const cached = getCached<Array<{ id: number; title: string }>>(cacheKey)
	if (cached) return cached
	const list = await withRateLimit(() =>
		getGameList(getAuth(), { consoleId, shouldOnlyRetrieveGamesWithAchievements: true }),
	)
	const simplified = list.map((g) => ({ id: g.id, title: g.title }))
	setCached(cacheKey, simplified, getTtlSeconds('gameMetadata'))
	return simplified
}

export async function findRaGameForRom(
	recalboxId: string,
	romPath: string,
	system: string,
): Promise<number | null> {
	const existing = db
		.select()
		.from(raGameMapping)
		.where(and(eq(raGameMapping.recalboxId, recalboxId), eq(raGameMapping.romPath, romPath)))
		.get()
	if (existing) return existing.raGameId

	const consoleId = SYSTEM_TO_RA_CONSOLE_ID[system.toLowerCase()]
	if (!consoleId) return null

	const romName = path.basename(romPath, path.extname(romPath))

	try {
		const games = await getGameListCached(consoleId)
		let bestId: number | null = null
		let bestScore = 0

		for (const game of games) {
			const score = similarityScore(romName, game.title)
			if (score > bestScore) {
				bestScore = score
				bestId = game.id
			}
		}

		if (bestScore >= 0.8 && bestId !== null) {
			db.insert(raGameMapping)
				.values({
					recalboxId,
					romPath,
					raGameId: bestId,
					matchKind: 'auto',
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [raGameMapping.recalboxId, raGameMapping.romPath],
					set: { raGameId: bestId, matchKind: 'auto', updatedAt: new Date() },
				})
				.run()
			return bestId
		}
	} catch (err) {
		logger.warn(`Failed to find RA game for ROM: ${romPath} (${system})`, err)
	}

	return null
}

export async function setManualMapping(
	recalboxId: string,
	romPath: string,
	raGameId: number,
): Promise<void> {
	db.insert(raGameMapping)
		.values({ recalboxId, romPath, raGameId, matchKind: 'manual', updatedAt: new Date() })
		.onConflictDoUpdate({
			target: [raGameMapping.recalboxId, raGameMapping.romPath],
			set: { raGameId, matchKind: 'manual', updatedAt: new Date() },
		})
		.run()
}
