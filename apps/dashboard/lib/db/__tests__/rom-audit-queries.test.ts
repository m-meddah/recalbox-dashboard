import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RomFileRow, RomSystemAuditRow } from '../rom-audit-queries'
import {
	SCAN_STALE_MS,
	appendSystemRomFiles,
	createScan,
	entryKey,
	finishScan,
	getLatestScan,
	getRomFileByKey,
	getScan,
	getSystemAudit,
	isScanStale,
	listRomFiles,
	listSystemAudits,
	pruneRomFilesBefore,
	syncSystemRomFiles,
	updateScanProgress,
	upsertSystemAudit,
} from '../rom-audit-queries'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

let sqlite: Database.Database

function makeDb(): DB {
	sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

/** SQLite's own write counter — the only honest way to assert "wrote nothing". */
function writes(): number {
	return (sqlite.prepare('SELECT total_changes() AS c').get() as { c: number }).c
}

const SCANNED_AT = new Date('2026-07-26T10:00:00Z')

function file(over: Partial<RomFileRow> = {}): RomFileRow {
	const filePath = over.path ?? '/recalbox/share/roms/snes/Game.zip'
	const innerName = over.innerName === undefined ? 'Game (Europe).sfc' : over.innerName
	return {
		recalboxId: 'rb1',
		entryKey: entryKey(filePath, innerName),
		system: 'snes',
		mount: '/recalbox/share',
		path: filePath,
		innerName,
		size: 1048576,
		mtime: 1721900000,
		kind: 'zip-entry',
		crc32: 'e95a3dd7',
		sha1: null,
		serial: null,
		matchLevel: 'verified',
		datEntryName: 'Game (Europe).sfc',
		canonicalTitle: 'Game',
		scannedAt: SCANNED_AT,
		...over,
	}
}

function audit(over: Partial<RomSystemAuditRow> = {}): RomSystemAuditRow {
	return {
		recalboxId: 'rb1',
		system: 'snes',
		datName: 'Nintendo - Super Nintendo Entertainment System',
		datVersion: '2026.05.02',
		totalRomEntries: 4000,
		matchedRomEntries: 1200,
		verifiedCount: 1150,
		serialCount: 0,
		namedCount: 50,
		unknownCount: 7,
		filesScanned: 1207,
		totalBytes: 12345678,
		mounts: ['/recalbox/share'],
		matchedEntries: ['Game (Europe).sfc'],
		scannedAt: SCANNED_AT,
		...over,
	}
}

describe('entryKey', () => {
	it('is the path alone for a bare file', () => {
		expect(entryKey('/roms/snes/Game.sfc', null)).toBe('/roms/snes/Game.sfc')
	})

	// One 7z can hold twenty ROMs; keying on the path alone would keep one.
	it('separates two entries of the same archive', () => {
		const a = entryKey('/roms/nes/Set.7z', 'A.nes')
		const b = entryKey('/roms/nes/Set.7z', 'B.nes')
		expect(a).not.toBe(b)
	})
})

describe('syncSystemRomFiles', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('inserts the rows of a first scan', async () => {
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [file(), file({ path: '/b.zip' })])
		expect(res).toEqual({ inserted: 2, updated: 0, deleted: 0 })
		expect(await listRomFiles(db, 'rb1', 'snes')).toHaveLength(2)
	})

	// The whole point of the incremental write: a rescan that changes nothing
	// must not rewrite 75k identical rows into Turso.
	it('writes nothing at all when the scan is unchanged', async () => {
		const rows = [file(), file({ path: '/b.zip' })]
		await syncSystemRomFiles(db, 'rb1', 'snes', rows)
		const before = writes()
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', rows)
		expect(res).toEqual({ inserted: 0, updated: 0, deleted: 0 })
		expect(writes()).toBe(before)
	})

	// A re-scan carries a new scannedAt for every row; that alone is not a change.
	it('ignores a change of scannedAt only', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file()])
		const before = writes()
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [
			file({ scannedAt: new Date('2026-08-01T00:00:00Z') }),
		])
		expect(res).toEqual({ inserted: 0, updated: 0, deleted: 0 })
		expect(writes()).toBe(before)
	})

	it('updates only the row whose content changed', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file(), file({ path: '/b.zip' })])
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [
			file({ mtime: 1721999999 }),
			file({ path: '/b.zip' }),
		])
		expect(res).toEqual({ inserted: 0, updated: 1, deleted: 0 })
		const rows = await listRomFiles(db, 'rb1', 'snes')
		expect(rows.find((r) => r.path === '/recalbox/share/roms/snes/Game.zip')?.mtime).toBe(
			1721999999,
		)
	})

	it('deletes a row whose file disappeared', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file(), file({ path: '/b.zip' })])
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [file()])
		expect(res).toEqual({ inserted: 0, updated: 0, deleted: 1 })
		expect(await listRomFiles(db, 'rb1', 'snes')).toHaveLength(1)
	})

	// A scan of one system must never touch another system's rows, and never
	// another Recalbox's — this is the multi-box safety net.
	it('is scoped to one system and one Recalbox', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file()])
		await syncSystemRomFiles(db, 'rb1', 'nes', [file({ system: 'nes', path: '/n.zip' })])
		await syncSystemRomFiles(db, 'rb2', 'snes', [file({ recalboxId: 'rb2' })])

		await syncSystemRomFiles(db, 'rb1', 'snes', [])

		expect(await listRomFiles(db, 'rb1', 'snes')).toHaveLength(0)
		expect(await listRomFiles(db, 'rb1', 'nes')).toHaveLength(1)
		expect(await listRomFiles(db, 'rb2', 'snes')).toHaveLength(1)
	})

	it('filters by match level', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [
			file(),
			file({ path: '/u.zip', matchLevel: 'unknown', datEntryName: null }),
		])
		const unknown = await listRomFiles(db, 'rb1', 'snes', { matchLevel: 'unknown' })
		expect(unknown).toHaveLength(1)
		expect(unknown[0]?.path).toBe('/u.zip')
	})
})

// The agent pushes one system in several HTTP requests, and a chunk cannot tell
// a vanished file from one belonging to another chunk — hence upsert now, sweep
// at the end.
describe('appendSystemRomFiles + pruneRomFilesBefore', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	const T1 = new Date('2026-07-26T10:00:00Z')
	const T2 = new Date('2026-07-27T10:00:00Z')

	it('accumulates chunks instead of replacing them', async () => {
		await appendSystemRomFiles(db, 'rb1', 'snes', [file({ path: '/a.zip' })])
		await appendSystemRomFiles(db, 'rb1', 'snes', [file({ path: '/b.zip' })])
		expect(await listRomFiles(db, 'rb1', 'snes')).toHaveLength(2)
	})

	it('updates a row the next chunk re-sends', async () => {
		await appendSystemRomFiles(db, 'rb1', 'snes', [file({ matchLevel: 'unknown' })])
		await appendSystemRomFiles(db, 'rb1', 'snes', [file({ matchLevel: 'verified' })])
		const rows = await listRomFiles(db, 'rb1', 'snes')
		expect(rows).toHaveLength(1)
		expect(rows[0]?.matchLevel).toBe('verified')
	})

	it('refuses a row that belongs to another system', async () => {
		const res = await appendSystemRomFiles(db, 'rb1', 'snes', [
			file({ system: 'nes', path: '/n.zip' }),
		])
		expect(res.written).toBe(0)
		expect(await listRomFiles(db, 'rb1', 'nes')).toHaveLength(0)
	})

	it('sweeps only what the current scan did not refresh', async () => {
		await appendSystemRomFiles(db, 'rb1', 'snes', [
			file({ path: '/stays.zip', scannedAt: T1 }),
			file({ path: '/goes.zip', scannedAt: T1 }),
		])
		await appendSystemRomFiles(db, 'rb1', 'snes', [file({ path: '/stays.zip', scannedAt: T2 })])

		const res = await pruneRomFilesBefore(db, 'rb1', 'snes', T2)
		expect(res.deleted).toBe(1)
		const rows = await listRomFiles(db, 'rb1', 'snes')
		expect(rows.map((r) => r.path)).toEqual(['/stays.zip'])
	})

	it('never sweeps another system or another Recalbox', async () => {
		await appendSystemRomFiles(db, 'rb1', 'nes', [
			file({ system: 'nes', path: '/n.zip', scannedAt: T1 }),
		])
		await appendSystemRomFiles(db, 'rb2', 'snes', [
			file({ recalboxId: 'rb2', path: '/o.zip', scannedAt: T1 }),
		])
		await pruneRomFilesBefore(db, 'rb1', 'snes', T2)
		expect(await listRomFiles(db, 'rb1', 'nes')).toHaveLength(1)
		expect(await listRomFiles(db, 'rb2', 'snes')).toHaveLength(1)
	})
})

describe('upsertSystemAudit', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('writes the aggregate and reads it back', async () => {
		expect(await upsertSystemAudit(db, audit())).toBe(true)
		const row = await getSystemAudit(db, 'rb1', 'snes')
		expect(row?.matchedRomEntries).toBe(1200)
		expect(row?.matchedEntries).toEqual(['Game (Europe).sfc'])
		expect(row?.mounts).toEqual(['/recalbox/share'])
	})

	it('writes nothing when the aggregate is unchanged', async () => {
		await upsertSystemAudit(db, audit())
		const before = writes()
		expect(
			await upsertSystemAudit(db, audit({ scannedAt: new Date('2026-08-01T00:00:00Z') })),
		).toBe(false)
		expect(writes()).toBe(before)
	})

	it('rewrites when a counter changed', async () => {
		await upsertSystemAudit(db, audit())
		expect(await upsertSystemAudit(db, audit({ matchedRomEntries: 1201 }))).toBe(true)
		expect((await getSystemAudit(db, 'rb1', 'snes'))?.matchedRomEntries).toBe(1201)
	})

	it('lists every system of a Recalbox and nobody else’s', async () => {
		await upsertSystemAudit(db, audit())
		await upsertSystemAudit(db, audit({ system: 'nes' }))
		await upsertSystemAudit(db, audit({ recalboxId: 'rb2' }))
		expect(await listSystemAudits(db, 'rb1')).toHaveLength(2)
	})

	it('returns null for a system never audited', async () => {
		expect(await getSystemAudit(db, 'rb1', 'psx')).toBeNull()
	})
})

describe('scan lifecycle', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('creates a running scan for the ssh transport', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 3, 'user1')
		expect(row.status).toBe('running')
		expect(row.transport).toBe('ssh')
		expect(row.systemsTotal).toBe(3)
		expect(row.systemsDone).toBe(0)
		expect(row.createdBy).toBe('user1')
	})

	// The agent has not picked the command up yet, so the scan is not running.
	it('creates a pending scan for the agent transport', async () => {
		const row = await createScan(db, 'rb1', 'agent', 3)
		expect(row.status).toBe('pending')
	})

	it('advances progress and bumps updatedAt', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 3)
		await updateScanProgress(db, row.id, { systemsDone: 2, currentSystem: 'psx' })
		const after = await getScan(db, row.id)
		expect(after?.systemsDone).toBe(2)
		expect(after?.currentSystem).toBe('psx')
		expect(after?.status).toBe('running')
		expect((after?.updatedAt.getTime() ?? 0) >= row.updatedAt.getTime()).toBe(true)
	})

	it('closes a scan as done', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 1)
		await finishScan(db, row.id, 'done')
		const after = await getScan(db, row.id)
		expect(after?.status).toBe('done')
		expect(after?.completedAt).toBeInstanceOf(Date)
		expect(after?.error).toBeNull()
	})

	it('closes a scan as failed with its reason', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 1)
		await finishScan(db, row.id, 'failed', 'box unreachable')
		expect((await getScan(db, row.id))?.error).toBe('box unreachable')
	})

	it('returns the most recent scan of the box', async () => {
		await createScan(db, 'rb1', 'ssh', 1)
		await new Promise((r) => setTimeout(r, 1100))
		const second = await createScan(db, 'rb1', 'ssh', 2)
		await createScan(db, 'rb2', 'ssh', 1)
		expect((await getLatestScan(db, 'rb1'))?.id).toBe(second.id)
	})

	it('has no scan for a box that never ran one', async () => {
		expect(await getLatestScan(db, 'rb9')).toBeNull()
	})
})

describe('isScanStale', () => {
	// A self-hosted server restarted mid-scan leaves a 'running' row forever;
	// the UI must not show a scan in flight for eternity.
	it('flags a running scan whose progress stopped long ago', () => {
		const updatedAt = new Date(Date.now() - SCAN_STALE_MS - 1000)
		expect(isScanStale({ status: 'running', updatedAt })).toBe(true)
	})

	it('leaves a scan that just reported progress alone', () => {
		expect(isScanStale({ status: 'running', updatedAt: new Date() })).toBe(false)
	})

	it('never flags a finished scan', () => {
		const updatedAt = new Date(Date.now() - SCAN_STALE_MS - 1000)
		expect(isScanStale({ status: 'done', updatedAt })).toBe(false)
		expect(isScanStale({ status: 'failed', updatedAt })).toBe(false)
	})
})

// A deep-verify request carries an entry key and nothing else — the system is
// not part of it, and hardcoding a list of "verifiable systems" would miss
// dreamcast, saturn, segacd and the rest.
describe('getRomFileByKey', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('finds an entry without being told its system', async () => {
		await syncSystemRomFiles(db, 'rb1', 'psx', [
			file({ system: 'psx', path: '/recalbox/share/roms/psx/Game.chd', innerName: null, kind: 'chd' }),
		])
		const row = await getRomFileByKey(db, 'rb1', '/recalbox/share/roms/psx/Game.chd')
		expect(row?.system).toBe('psx')
		expect(row?.kind).toBe('chd')
	})

	it('returns null for a key that does not exist', async () => {
		expect(await getRomFileByKey(db, 'rb1', '/nope')).toBeNull()
	})

	// Another box's entry must never be reachable through this lookup.
	it('is scoped to one Recalbox', async () => {
		await syncSystemRomFiles(db, 'rb2', 'psx', [
			file({ recalboxId: 'rb2', system: 'psx', path: '/p/Game.chd', innerName: null, kind: 'chd' }),
		])
		expect(await getRomFileByKey(db, 'rb1', '/p/Game.chd')).toBeNull()
		expect(await getRomFileByKey(db, 'rb2', '/p/Game.chd')).not.toBeNull()
	})
})
