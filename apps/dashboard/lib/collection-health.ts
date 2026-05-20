import { db } from '@/lib/db/index'
import { games } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export type ScrapeStatus = {
	romPath: string
	name: string
	system: string
	missingImage: boolean
	missingDescription: boolean
	// video is tracked for completeness but NOT counted as critical missing media —
	// many games legitimately lack videos and that's considered normal.
	missingVideo: boolean
}

export type CollectionHealth = {
	totalGames: number
	fullyScraped: number
	missingMedia: number
	bySystem: Array<{
		system: string
		total: number
		missingMedia: number
	}>
	unscrapedGames: ScrapeStatus[]
}

type GameRow = {
	system: string
	romPath: string
	name: string
	imagePath: string | null
	description: string | null
	videoPath: string | null
}

/** Pure computation — extracted for testability. */
export function computeCollectionHealth(rows: GameRow[]): CollectionHealth {
	let fullyScraped = 0
	let missingMedia = 0
	const unscrapedGames: ScrapeStatus[] = []
	const bySystemMap = new Map<string, { total: number; missingMedia: number }>()

	for (const row of rows) {
		const missingImage = !row.imagePath
		const missingDescription = !row.description
		const missingVideo = !row.videoPath
		const isMissingCritical = missingImage || missingDescription

		const sys = bySystemMap.get(row.system) ?? { total: 0, missingMedia: 0 }
		sys.total++
		if (isMissingCritical) {
			sys.missingMedia++
			missingMedia++
			unscrapedGames.push({
				romPath: row.romPath,
				name: row.name,
				system: row.system,
				missingImage,
				missingDescription,
				missingVideo,
			})
		} else {
			fullyScraped++
		}
		bySystemMap.set(row.system, sys)
	}

	const bySystem = Array.from(bySystemMap.entries())
		.map(([system, s]) => ({ system, ...s }))
		.sort((a, b) => b.missingMedia - a.missingMedia)

	return {
		totalGames: rows.length,
		fullyScraped,
		missingMedia,
		bySystem,
		unscrapedGames: unscrapedGames.sort((a, b) => a.name.localeCompare(b.name)),
	}
}

export async function getCollectionHealth(recalboxId?: string): Promise<CollectionHealth> {
	const conditions = [eq(games.hidden, false)]
	if (recalboxId) conditions.push(eq(games.recalboxId, recalboxId))
	const where = conditions.length > 1 ? and(...conditions) : conditions[0]

	const rows = await db
		.select({
			system: games.system,
			romPath: games.romPath,
			name: games.name,
			imagePath: games.imagePath,
			description: games.description,
			videoPath: games.videoPath,
		})
		.from(games)
		.where(where)

	return computeCollectionHealth(rows)
}
