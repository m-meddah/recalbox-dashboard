import { asc, count, desc, eq, gte, ilike, like, sql } from 'drizzle-orm'
import { db } from '@/lib/db/index'
import { games, systemSnapshots } from '@/lib/db/schema'
import type { ParsedGame } from '@/lib/recalbox/gamelist-parser'
import type { SystemStats } from '@/lib/recalbox/system-stats'

// ─── System snapshots ────────────────────────────────────────────────────────

/** Insert a system stats snapshot into the database. */
export async function insertSystemSnapshot(stats: SystemStats): Promise<void> {
	await db.insert(systemSnapshots).values({
		capturedAt: stats.takenAt,
		cpuPercent: stats.cpuUsage,
		memUsedMb: stats.ramUsedMb,
		memTotalMb: stats.ramTotalMb,
		tempCelsius: stats.cpuTemp,
		uptimeSeconds: stats.uptimeSec !== null ? Math.round(stats.uptimeSec) : null,
	})
}

/** Retrieve system snapshots from the last N minutes. */
export async function getRecentSnapshots(minutes: number) {
	const since = new Date(Date.now() - minutes * 60 * 1000)
	return db
		.select()
		.from(systemSnapshots)
		.where(gte(systemSnapshots.capturedAt, since))
		.orderBy(systemSnapshots.capturedAt)
}

// ─── Collection ───────────────────────────────────────────────────────────────

const BATCH_SIZE = 500

/**
 * Upsert a batch of parsed games for a given system.
 * Returns the number of inserted/updated rows.
 */
export async function upsertGames(
	parsedGames: ParsedGame[],
	system: string,
	diskSource: string,
): Promise<number> {
	if (parsedGames.length === 0) return 0

	const now = new Date()
	let total = 0

	for (let i = 0; i < parsedGames.length; i += BATCH_SIZE) {
		const batch = parsedGames.slice(i, i + BATCH_SIZE)

		await db
			.insert(games)
			.values(
				batch.map((g) => ({
					name: g.name,
					system,
					romPath: g.romPath,
					imagePath: g.imagePath ?? null,
					videoPath: g.videoPath ?? null,
					thumbnailPath: g.thumbnailPath ?? null,
					rating: g.rating ?? null,
					players: g.players ?? null,
					releaseDate: g.releaseDate ?? null,
					developer: g.developer ?? null,
					publisher: g.publisher ?? null,
					genre: g.genre ?? null,
					description: g.description ?? null,
					hash: g.hash ?? null,
					region: g.region ?? null,
					favorite: g.favorite,
					hidden: g.hidden,
					playCount: g.playCount ?? 0,
					lastPlayed: g.lastPlayed ?? null,
					diskSource,
					syncedAt: now,
					updatedAt: now,
				})),
			)
			.onConflictDoUpdate({
				target: games.romPath,
				set: {
					name: sql`excluded.name`,
					imagePath: sql`excluded.image_path`,
					videoPath: sql`excluded.video_path`,
					thumbnailPath: sql`excluded.thumbnail_path`,
					rating: sql`excluded.rating`,
					players: sql`excluded.players`,
					releaseDate: sql`excluded.release_date`,
					developer: sql`excluded.developer`,
					publisher: sql`excluded.publisher`,
					genre: sql`excluded.genre`,
					description: sql`excluded.description`,
					hash: sql`excluded.hash`,
					region: sql`excluded.region`,
					favorite: sql`excluded.favorite`,
					hidden: sql`excluded.hidden`,
					playCount: sql`excluded.play_count`,
					lastPlayed: sql`excluded.last_played`,
					diskSource: sql`excluded.disk_source`,
					syncedAt: sql`excluded.synced_at`,
					updatedAt: sql`excluded.updated_at`,
				},
			})

		total += batch.length
	}

	return total
}

export type CollectionFilters = {
	system?: string
	favoritesOnly?: boolean
	neverPlayed?: boolean
	developer?: string
	region?: string
	search?: string
	sortBy?: 'name' | 'rating' | 'lastPlayed' | 'releaseDate'
	sortDir?: 'asc' | 'desc'
	limit?: number
	offset?: number
}

export type Game = typeof games.$inferSelect

/** List games with optional filters, sorting and pagination. */
export async function listGames(
	filters: CollectionFilters = {},
): Promise<{ games: Game[]; total: number }> {
	const {
		system,
		favoritesOnly,
		neverPlayed,
		developer,
		region,
		search,
		sortBy = 'name',
		sortDir = 'asc',
		limit = 50,
		offset = 0,
	} = filters

	const conditions = [eq(games.hidden, false)]

	if (system) conditions.push(eq(games.system, system))
	if (favoritesOnly) conditions.push(eq(games.favorite, true))
	if (neverPlayed) conditions.push(sql`${games.playCount} = 0 OR ${games.playCount} IS NULL`)
	if (developer) conditions.push(eq(games.developer, developer))
	if (region) conditions.push(eq(games.region, region))
	if (search) conditions.push(like(games.name, `%${search}%`))

	const whereClause = sql.join(conditions, sql` AND `)

	const orderCol =
		sortBy === 'rating'
			? games.rating
			: sortBy === 'lastPlayed'
				? games.lastPlayed
				: sortBy === 'releaseDate'
					? games.releaseDate
					: games.name

	const orderFn = sortDir === 'desc' ? desc : asc

	const [rows, countRows] = await Promise.all([
		db
			.select()
			.from(games)
			.where(whereClause)
			.orderBy(orderFn(orderCol))
			.limit(limit)
			.offset(offset),
		db.select({ value: count() }).from(games).where(whereClause),
	])

	return { games: rows, total: countRows[0]?.value ?? 0 }
}

export type CollectionStats = {
	totalGames: number
	bySystem: Record<string, number>
	favorites: number
	neverPlayed: number
}

/** Aggregate stats over the full collection (excluding hidden games). */
export async function getCollectionStats(): Promise<CollectionStats> {
	const [bySystemRows, [totals]] = await Promise.all([
		db
			.select({ system: games.system, value: count() })
			.from(games)
			.where(eq(games.hidden, false))
			.groupBy(games.system)
			.orderBy(desc(count())),
		db
			.select({
				total: count(),
				favorites: sql<number>`sum(case when ${games.favorite} = 1 then 1 else 0 end)`,
				neverPlayed: sql<number>`sum(case when (${games.playCount} = 0 or ${games.playCount} is null) then 1 else 0 end)`,
			})
			.from(games)
			.where(eq(games.hidden, false)),
	])

	const bySystem: Record<string, number> = {}
	for (const row of bySystemRows) bySystem[row.system] = row.value

	return {
		totalGames: totals?.total ?? 0,
		bySystem,
		favorites: totals?.favorites ?? 0,
		neverPlayed: totals?.neverPlayed ?? 0,
	}
}

/** List distinct region values present in the collection (excluding hidden games). */
export async function listRegions(system?: string): Promise<string[]> {
	const conditions = [eq(games.hidden, false), sql`${games.region} IS NOT NULL`]
	if (system) conditions.push(eq(games.system, system))

	const rows = await db
		.selectDistinct({ region: games.region })
		.from(games)
		.where(sql.join(conditions, sql` AND `))
		.orderBy(asc(games.region))

	return rows.map((r) => r.region).filter((r): r is string => r !== null)
}
