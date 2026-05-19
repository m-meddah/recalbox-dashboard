import { db } from '@/lib/db/index'
import { games, sessions, settings, systemSnapshots } from '@/lib/db/schema'
import type { ParsedGame } from '@/lib/recalbox/gamelist-parser'
import type { SystemStats } from '@/lib/recalbox/system-stats'
import { SETUP_COMPLETED_KEY } from '@/lib/settings/schemas'
import { and, asc, count, desc, eq, gte, isNull, like, lte, max, sql } from 'drizzle-orm'

// ─── Settings ────────────────────────────────────────────────────────────────

export function getAllSettings(): Record<string, string> {
	const rows = db.select().from(settings).all()
	return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export function upsertSetting(key: string, value: string): void {
	db.insert(settings)
		.values({ key, value, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value, updatedAt: new Date() },
		})
		.run()
}

export function deleteSetting(key: string): void {
	db.delete(settings).where(eq(settings.key, key)).run()
}

export function deleteSettingsByPrefix(prefix: string): void {
	const rows = db.select({ key: settings.key }).from(settings).all()
	for (const row of rows) {
		if (row.key.startsWith(prefix)) {
			db.delete(settings).where(eq(settings.key, row.key)).run()
		}
	}
}

export function getLatestSettingUpdatedAt(): number {
	const row = db
		.select({ latest: max(settings.updatedAt) })
		.from(settings)
		.get()
	if (!row?.latest) return 0
	return row.latest instanceof Date ? row.latest.getTime() : Number(row.latest)
}

export function isSetupComplete(): boolean {
	const row = db.select().from(settings).where(eq(settings.key, SETUP_COMPLETED_KEY)).get()
	return row?.value === 'true'
}

// ─── System snapshots ────────────────────────────────────────────────────────

/** Insert a system stats snapshot into the database. */
export async function insertSystemSnapshot(stats: SystemStats, recalboxId: string): Promise<void> {
	await db.insert(systemSnapshots).values({
		recalboxId,
		capturedAt: stats.takenAt,
		cpuPercent: stats.cpuUsage,
		memUsedMb: stats.ramUsedMb,
		memTotalMb: stats.ramTotalMb,
		tempCelsius: stats.cpuTemp,
		uptimeSeconds: stats.uptimeSec !== null ? Math.round(stats.uptimeSec) : null,
	})
}

/** Retrieve system snapshots from the last N minutes. */
export async function getRecentSnapshots(minutes: number, recalboxId?: string) {
	const since = new Date(Date.now() - minutes * 60 * 1000)
	const conditions = [gte(systemSnapshots.capturedAt, since)]
	if (recalboxId) conditions.push(eq(systemSnapshots.recalboxId, recalboxId))
	return db
		.select()
		.from(systemSnapshots)
		.where(sql.join(conditions, sql` AND `))
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
	recalboxId: string,
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
					recalboxId,
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
				target: [games.recalboxId, games.romPath],
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
	recalboxId?: string
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
		recalboxId,
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

	if (recalboxId) conditions.push(eq(games.recalboxId, recalboxId))
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
export async function listRegions(system?: string, recalboxId?: string): Promise<string[]> {
	const conditions = [eq(games.hidden, false), sql`${games.region} IS NOT NULL`]
	if (recalboxId) conditions.push(eq(games.recalboxId, recalboxId))
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
	recalboxId?: string
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
	recalboxId: string
	gameId?: number
	startedAt: Date
	system: string
	romPath: string
}): Promise<number> {
	const result = await db
		.insert(sessions)
		.values({
			recalboxId: opts.recalboxId,
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
	const {
		recalboxId,
		system,
		romPath,
		fromDate,
		toDate,
		autoClosed,
		page = 1,
		pageSize = 50,
	} = filters

	const conditions: ReturnType<typeof sql>[] = [sql`${sessions.endedAt} IS NOT NULL`]
	if (recalboxId) conditions.push(sql`${sessions.recalboxId} = ${recalboxId}`)
	if (system) conditions.push(sql`${sessions.system} = ${system}`)
	if (romPath) conditions.push(sql`${sessions.romPath} = ${romPath}`)
	if (fromDate)
		conditions.push(sql`${sessions.startedAt} >= ${Math.floor(fromDate.getTime() / 1000)}`)
	if (toDate) conditions.push(sql`${sessions.startedAt} <= ${Math.floor(toDate.getTime() / 1000)}`)
	if (autoClosed !== undefined) conditions.push(sql`${sessions.autoClosed} = ${autoClosed ? 1 : 0}`)

	const where = sql.join(conditions, sql` AND `)
	const offset = (page - 1) * pageSize

	const [rows, countRows] = await Promise.all([
		db
			.select()
			.from(sessions)
			.where(where)
			.orderBy(desc(sessions.startedAt))
			.limit(pageSize)
			.offset(offset),
		db.select({ value: count() }).from(sessions).where(where),
	])

	return { sessions: rows, total: countRows[0]?.value ?? 0 }
}

/** Aggregate session stats over an optional date range. */
export async function getSessionStats(
	opts: {
		recalboxId?: string
		fromDate?: Date
		toDate?: Date
		topGamesLimit?: number
	} = {},
): Promise<SessionStats> {
	const { recalboxId, fromDate, toDate, topGamesLimit = 10 } = opts

	const baseConditions: ReturnType<typeof sql>[] = [sql`${sessions.endedAt} IS NOT NULL`]
	if (recalboxId) baseConditions.push(sql`${sessions.recalboxId} = ${recalboxId}`)
	if (fromDate)
		baseConditions.push(sql`${sessions.startedAt} >= ${Math.floor(fromDate.getTime() / 1000)}`)
	if (toDate)
		baseConditions.push(sql`${sessions.startedAt} <= ${Math.floor(toDate.getTime() / 1000)}`)
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
				srHasPage: games.srHasPage,
				srUrl: games.srUrl,
			})
			.from(sessions)
			.leftJoin(
				games,
				and(eq(sessions.recalboxId, games.recalboxId), eq(sessions.romPath, games.romPath)),
			)
			.where(where)
			.groupBy(sessions.romPath)
			.orderBy(desc(sql`SUM(${sessions.durationSeconds})`))
			.limit(topGamesLimit),
	])

	const totals = totalsRows[0] ?? {
		totalPlaytimeSec: 0,
		totalSessions: 0,
		uniqueGames: 0,
		avgSessionSec: 0,
	}

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
			srHasPage: r.srHasPage ?? null,
			srUrl: r.srUrl ?? null,
		})),
	}
}

export async function listAllSessionsAcrossRecalboxes(
	filters: SessionFilters = {},
): Promise<{ sessions: Session[]; total: number }> {
	return listSessions(filters)
}

export async function getSessionStatsAllRecalboxes(
	opts: { fromDate?: Date; toDate?: Date; topGamesLimit?: number } = {},
): Promise<SessionStats> {
	return getSessionStats(opts)
}

// ─── Super Retrogamers ────────────────────────────────────────────────────────

export function updateGameSrInfo(
	recalboxId: string,
	romPath: string,
	srSlug: string,
	srHasPage: boolean,
	srUrl: string | null,
): void {
	db.update(games)
		.set({
			srSlug,
			srHasPage: srHasPage ? 1 : 0,
			srUrl: srUrl ?? null,
			srCheckedAt: new Date(),
		})
		.where(and(eq(games.recalboxId, recalboxId), eq(games.romPath, romPath)))
		.run()
}

export function getGameSrInfo(
	recalboxId: string,
	romPath: string,
): { srHasPage: number | null; srUrl: string | null } | null {
	const row = db
		.select({ srHasPage: games.srHasPage, srUrl: games.srUrl })
		.from(games)
		.where(and(eq(games.recalboxId, recalboxId), eq(games.romPath, romPath)))
		.get()
	return row ?? null
}

export function countSrStats(recalboxId?: string): { total: number; matched: number } {
	const totalWhere = recalboxId ? eq(games.recalboxId, recalboxId) : undefined
	const matchedWhere = recalboxId
		? and(eq(games.recalboxId, recalboxId), eq(games.srHasPage, 1))
		: eq(games.srHasPage, 1)
	const total = db.select({ count: count() }).from(games).where(totalWhere).get()?.count ?? 0
	const matched = db.select({ count: count() }).from(games).where(matchedWhere).get()?.count ?? 0
	return { total, matched }
}

export function listUncheckedGames(
	limit: number,
	recalboxId?: string,
): Array<{
	romPath: string
	name: string
	system: string
}> {
	const whereClause = recalboxId
		? and(isNull(games.srCheckedAt), eq(games.recalboxId, recalboxId))
		: isNull(games.srCheckedAt)
	return db
		.select({ romPath: games.romPath, name: games.name, system: games.system })
		.from(games)
		.where(whereClause)
		.limit(limit)
		.all()
}
