import { randomUUID } from 'node:crypto'
import type { DB } from '@/lib/db'
import { romFiles, romScans, romSystemAudits } from '@/lib/db/schema'
import type { MatchLevel } from '@/lib/rom-audit/match'
import { and, desc, eq, inArray } from 'drizzle-orm'

// $inferSelect, NOT $inferInsert: the select type makes every optional column
// `T | null`, so a producer that leaves one `undefined` fails to typecheck.
// Drizzle writes `undefined` as "column absent", which on an update silently
// keeps the previous value — the type is the guard against that.
export type RomFileRow = typeof romFiles.$inferSelect
export type RomSystemAuditRow = typeof romSystemAudits.$inferSelect
export type RomScanRow = typeof romScans.$inferSelect

export type SyncResult = { inserted: number; updated: number; deleted: number }

// SQLite caps a statement at 999 bound variables by default. Chunk both the
// inserts (16 columns each) and the delete lists well under that.
const INSERT_CHUNK = 50
const DELETE_CHUNK = 400

/**
 * Identity of a scanned entry within a Recalbox.
 *
 * A 7z archive yields one manifest entry per contained ROM, all sharing the same
 * `path` — keying on the path alone would keep exactly one of them.
 */
export function entryKey(path: string, innerName?: string | null): string {
	return innerName ? `${path}#${innerName}` : path
}

/**
 * Everything that makes a row's content, EXCLUDING `scannedAt`.
 *
 * Every rescan carries a fresh `scannedAt` for every row. Counting it as a
 * change would rewrite the whole collection on each pass — precisely the write
 * volume that froze the Turso quota once already.
 */
function fileSignature(row: RomFileRow): string {
	return JSON.stringify([
		row.system,
		row.mount,
		row.path,
		row.innerName,
		row.size,
		row.mtime,
		row.kind,
		row.crc32,
		row.sha1,
		row.serial,
		row.matchLevel,
		row.datEntryName,
		row.canonicalTitle,
	])
}

function auditSignature(row: RomSystemAuditRow): string {
	return JSON.stringify([
		row.datName,
		row.datVersion,
		row.totalRomEntries,
		row.matchedRomEntries,
		row.verifiedCount,
		row.serialCount,
		row.namedCount,
		row.unknownCount,
		row.filesScanned,
		row.totalBytes,
		row.mounts,
		row.matchedEntries,
	])
}

function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}

/**
 * Bring `(recalboxId, system)` in line with what the scan just found.
 *
 * Incremental by contract: a rescan that changed nothing performs ZERO writes.
 * Scoped to one system of one Recalbox — it never touches a sibling system's
 * rows, and never another box's.
 */
export async function syncSystemRomFiles(
	db: DB,
	recalboxId: string,
	system: string,
	rows: readonly RomFileRow[],
): Promise<SyncResult> {
	const existing = await db
		.select()
		.from(romFiles)
		.where(and(eq(romFiles.recalboxId, recalboxId), eq(romFiles.system, system)))
		.all()

	const before = new Map(existing.map((row) => [row.entryKey, row]))
	const toInsert: RomFileRow[] = []
	const toUpdate: RomFileRow[] = []
	const seen = new Set<string>()

	for (const row of rows) {
		// A scan can legitimately yield the same key twice (the same archive listed
		// from two mounts). Keep the first and never insert a duplicate primary key.
		if (seen.has(row.entryKey)) continue
		seen.add(row.entryKey)

		const previous = before.get(row.entryKey)
		if (!previous) toInsert.push(row)
		else if (fileSignature(previous) !== fileSignature(row)) toUpdate.push(row)
	}

	const toDelete = existing.filter((row) => !seen.has(row.entryKey)).map((row) => row.entryKey)

	for (const batch of chunk(toInsert, INSERT_CHUNK)) {
		await db.insert(romFiles).values(batch)
	}
	for (const row of toUpdate) {
		await db
			.update(romFiles)
			.set(row)
			.where(and(eq(romFiles.recalboxId, recalboxId), eq(romFiles.entryKey, row.entryKey)))
	}
	for (const batch of chunk(toDelete, DELETE_CHUNK)) {
		await db
			.delete(romFiles)
			.where(and(eq(romFiles.recalboxId, recalboxId), inArray(romFiles.entryKey, batch)))
	}

	return { inserted: toInsert.length, updated: toUpdate.length, deleted: toDelete.length }
}

/** Write the per-system aggregate, but only if it actually changed. Returns whether it wrote. */
export async function upsertSystemAudit(db: DB, row: RomSystemAuditRow): Promise<boolean> {
	const previous = await getSystemAudit(db, row.recalboxId, row.system)
	if (previous && auditSignature(previous) === auditSignature(row)) return false

	if (previous) {
		await db
			.update(romSystemAudits)
			.set(row)
			.where(
				and(eq(romSystemAudits.recalboxId, row.recalboxId), eq(romSystemAudits.system, row.system)),
			)
	} else {
		await db.insert(romSystemAudits).values(row)
	}
	return true
}

export async function getSystemAudit(
	db: DB,
	recalboxId: string,
	system: string,
): Promise<RomSystemAuditRow | null> {
	const rows = await db
		.select()
		.from(romSystemAudits)
		.where(and(eq(romSystemAudits.recalboxId, recalboxId), eq(romSystemAudits.system, system)))
		.limit(1)
		.all()
	return rows[0] ?? null
}

export async function listSystemAudits(db: DB, recalboxId: string): Promise<RomSystemAuditRow[]> {
	return db
		.select()
		.from(romSystemAudits)
		.where(eq(romSystemAudits.recalboxId, recalboxId))
		.orderBy(romSystemAudits.system)
		.all()
}

export async function listRomFiles(
	db: DB,
	recalboxId: string,
	system: string,
	opts?: { matchLevel?: MatchLevel; limit?: number; offset?: number },
): Promise<RomFileRow[]> {
	const where = opts?.matchLevel
		? and(
				eq(romFiles.recalboxId, recalboxId),
				eq(romFiles.system, system),
				eq(romFiles.matchLevel, opts.matchLevel),
			)
		: and(eq(romFiles.recalboxId, recalboxId), eq(romFiles.system, system))

	const query = db.select().from(romFiles).where(where).orderBy(romFiles.entryKey)
	if (opts?.limit === undefined) return query.all()
	return query
		.limit(opts.limit)
		.offset(opts.offset ?? 0)
		.all()
}

/**
 * Open a scan run. An SSH scan starts running immediately (the server drives
 * it); an agent scan is only queued — the box has not claimed the command yet.
 */
export async function createScan(
	db: DB,
	recalboxId: string,
	transport: 'ssh' | 'agent',
	systemsTotal: number,
	createdBy?: string | null,
): Promise<RomScanRow> {
	const now = new Date()
	const rows = await db
		.insert(romScans)
		.values({
			id: randomUUID(),
			recalboxId,
			status: transport === 'ssh' ? 'running' : 'pending',
			transport,
			startedAt: now,
			updatedAt: now,
			systemsTotal,
			systemsDone: 0,
			createdBy: createdBy ?? null,
		})
		.returning()
	const row = rows[0]
	if (!row) throw new Error('Failed to create rom scan')
	return row
}

/**
 * Record progress. Also flips a queued agent scan to 'running': its first report
 * is the proof the box picked the command up.
 */
export async function updateScanProgress(
	db: DB,
	id: string,
	patch: { systemsDone?: number; systemsTotal?: number; currentSystem?: string | null },
): Promise<void> {
	const set: Partial<RomScanRow> = { updatedAt: new Date(), status: 'running' }
	if (patch.systemsDone !== undefined) set.systemsDone = patch.systemsDone
	if (patch.systemsTotal !== undefined) set.systemsTotal = patch.systemsTotal
	if ('currentSystem' in patch) set.currentSystem = patch.currentSystem ?? null
	await db.update(romScans).set(set).where(eq(romScans.id, id))
}

export async function finishScan(
	db: DB,
	id: string,
	status: 'done' | 'failed',
	error?: string | null,
): Promise<void> {
	const now = new Date()
	await db
		.update(romScans)
		.set({ status, completedAt: now, updatedAt: now, error: error ?? null })
		.where(eq(romScans.id, id))
}

export async function getScan(db: DB, id: string): Promise<RomScanRow | null> {
	const rows = await db.select().from(romScans).where(eq(romScans.id, id)).limit(1).all()
	return rows[0] ?? null
}

export async function getLatestScan(db: DB, recalboxId: string): Promise<RomScanRow | null> {
	const rows = await db
		.select()
		.from(romScans)
		.where(eq(romScans.recalboxId, recalboxId))
		.orderBy(desc(romScans.startedAt))
		.limit(1)
		.all()
	return rows[0] ?? null
}

/**
 * A scan whose progress stopped this long ago is presumed dead. Self-hosted, a
 * server restart mid-scan leaves a 'running' row nobody will ever close;
 * serverless, an agent that never claims its command leaves a 'pending' one.
 */
export const SCAN_STALE_MS = 3 * 60 * 60 * 1000

export function isScanStale(
	row: Pick<RomScanRow, 'status' | 'updatedAt'>,
	now: number = Date.now(),
): boolean {
	if (row.status !== 'running' && row.status !== 'pending') return false
	return now - row.updatedAt.getTime() > SCAN_STALE_MS
}
