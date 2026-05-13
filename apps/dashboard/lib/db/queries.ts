import { asc, count, desc, eq, gte, isNull, like, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db/index'
import { games, sessions, systemSnapshots } from '@/lib/db/schema'
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

// ─── Sessions ─────────────────────────────────────────────────────────────────

export type Session = typeof sessions.$inferSelect

export type SessionFilters = {
	system?: string
	romPath?: string
	fromDate?: Date
	toDate?: Date
	autoClosed?: boolean
	page?: number
	pageSize?: number
}

export type SessionStats = {
	totalPlaytimeSec: number
	totalSessions: number
	uniqueGames: number
	avgSessionSec: number
	byDay: Array<{ date: string; playtimeSec: number; sessionCount: number }>
	bySystem: Array<{ system: string; playtimeSec: number; sessionCount: number }>
	topGames: Array<{
		romPath: string
		gameName: string
		system: string
		playtimeSec: number
		sessionCount: number
		lastPlayed: Date
	}>
}

/** Insert a new open session record. Returns the inserted session id. */
export async function openSession(opts: {
	gameId?: number
	startedAt: Date
	system: string
	romPath: string
}): Promise<number> {
	const result = await db
		.insert(sessions)
		.values({
			gameId: opts.gameId ?? null,
			startedAt: opts.startedAt,
			system: opts.system,
			romPath: opts.romPath,
		})
		.returning({ id: sessions.id })
	const row = result[0]
	if (!row) throw new Error('Failed to insert session')
	return row.id
}

/** Close an open session by id, setting endedAt and durationSeconds. */
export async function closeSession(
	id: number,
	endedAt: Date,
	durationSeconds: number,
	opts?: { autoClosed?: boolean; closedReason?: string },
): Promise<void> {
	await db
		.update(sessions)
		.set({
			endedAt,
			durationSeconds,
			autoClosed: opts?.autoClosed ?? false,
			closedReason: opts?.closedReason ?? null,
		})
		.where(eq(sessions.id, id))
}

/** Delete a session by id (used for sub-minimum-duration cleanup). */
export async function deleteSession(id: number): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, id))
}

/** Return all sessions that have no endedAt (still open). */
export async function getOpenSessions(): Promise<Session[]> {
	return db.select().from(sessions).where(isNull(sessions.endedAt))
}

/** List closed sessions with optional filters and pagination. */
export async function listSessions(
	filters: SessionFilters = {},
): Promise<{ sessions: Session[]; total: number }> {
	const { system, romPath, fromDate, toDate, autoClosed, page = 1, pageSize = 50 } = filters

	const conditions: ReturnType<typeof sql>[] = [sql`${sessions.endedAt} IS NOT NULL`]
	if (system) conditions.push(sql`${sessions.system} = ${system}`)
	if (romPath) conditions.push(sql`${sessions.romPath} = ${romPath}`)
	if (fromDate) conditions.push(sql`${sessions.startedAt} >= ${Math.floor(fromDate.getTime() / 1000)}`)
	if (toDate) conditions.push(sql`${sessions.startedAt} <= ${Math.floor(toDate.getTime() / 1000)}`)
	if (autoClosed !== undefined) conditions.push(sql`${sessions.autoClosed} = ${autoClosed ? 1 : 0}`)

	const where = sql.join(conditions, sql` AND `)
	const offset = (page - 1) * pageSize

	const [rows, countRows] = await Promise.all([
		db.select().from(sessions).where(where).orderBy(desc(sessions.startedAt)).limit(pageSize).offset(offset),
		db.select({ value: count() }).from(sessions).where(where),
	])

	return { sessions: rows, total: countRows[0]?.value ?? 0 }
}

/** Aggregate session stats over an optional date range. */
export async function getSessionStats(opts: {
	fromDate?: Date
	toDate?: Date
	topGamesLimit?: number
} = {}): Promise<SessionStats> {
	const { fromDate, toDate, topGamesLimit = 10 } = opts

	const baseConditions: ReturnType<typeof sql>[] = [sql`${sessions.endedAt} IS NOT NULL`]
	if (fromDate) baseConditions.push(sql`${sessions.startedAt} >= ${Math.floor(fromDate.getTime() / 1000)}`)
	if (toDate) baseConditions.push(sql`${sessions.startedAt} <= ${Math.floor(toDate.getTime() / 1000)}`)
	const where = sql.join(baseConditions, sql` AND `)

	const [totalsRows, byDayRows, bySystemRows, topGamesRows] = await Promise.all([
		db
			.select({
				totalPlaytimeSec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)`,
				totalSessions: count(),
				uniqueGames: sql<number>`COUNT(DISTINCT ${sessions.romPath})`,
				avgSessionSec: sql<number>`COALESCE(AVG(${sessions.durationSeconds}), 0)`,
			})
			.from(sessions)
			.where(where),
		db
			.select({
				date: sql<string>`DATE(${sessions.startedAt}, 'unixepoch')`,
				playtimeSec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)`,
				sessionCount: count(),
			})
			.from(sessions)
			.where(where)
			.groupBy(sql`DATE(${sessions.startedAt}, 'unixepoch')`)
			.orderBy(sql`DATE(${sessions.startedAt}, 'unixepoch')`),
		db
			.select({
				system: sessions.system,
				playtimeSec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)`,
				sessionCount: count(),
			})
			.from(sessions)
			.where(where)
			.groupBy(sessions.system)
			.orderBy(desc(sql`SUM(${sessions.durationSeconds})`)),
		db
			.select({
				romPath: sessions.romPath,
				gameName: sql<string>`COALESCE(${games.name}, ${sessions.romPath})`,
				system: sessions.system,
				playtimeSec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)`,
				sessionCount: count(),
				lastPlayed: sql<number>`MAX(${sessions.startedAt})`,
			})
			.from(sessions)
			.leftJoin(games, eq(sessions.romPath, games.romPath))
			.where(where)
			.groupBy(sessions.romPath)
			.orderBy(desc(sql`SUM(${sessions.durationSeconds})`))
			.limit(topGamesLimit),
	])

	const totals = totalsRows[0] ?? { totalPlaytimeSec: 0, totalSessions: 0, uniqueGames: 0, avgSessionSec: 0 }

	return {
		totalPlaytimeSec: totals.totalPlaytimeSec,
		totalSessions: totals.totalSessions,
		uniqueGames: totals.uniqueGames,
		avgSessionSec: Math.round(totals.avgSessionSec),
		byDay: byDayRows,
		bySystem: bySystemRows,
		topGames: topGamesRows.map((r) => ({
			romPath: r.romPath,
			gameName: r.gameName,
			system: r.system,
			playtimeSec: r.playtimeSec,
			sessionCount: r.sessionCount,
			lastPlayed: new Date(r.lastPlayed * 1000),
		})),
	}
}
