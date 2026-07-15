import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { ingestSnapshot } from '../ingest-snapshot'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db
}

describe('ingestSnapshot', () => {
	let db: ReturnType<typeof makeDb>
	beforeEach(() => {
		db = makeDb()
	})

	it('inserts a snapshot for the Recalbox', async () => {
		const { id } = await ingestSnapshot(db as unknown as DB, 'rb1', {
			capturedAt: new Date('2026-06-20T20:00:00.000Z'),
			cpuPercent: 12.5,
			memUsedMb: 800,
			memTotalMb: 4096,
			tempCelsius: 47.2,
			uptimeSeconds: 3600,
		})
		expect(id).toBeGreaterThan(0)

		const rows = db.select().from(schema.systemSnapshots).all()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.recalboxId).toBe('rb1')
		expect(rows[0]?.cpuPercent).toBe(12.5)
		expect(rows[0]?.tempCelsius).toBe(47.2)
		expect(rows[0]?.uptimeSeconds).toBe(3600)
	})

	it('accepts missing metrics as null', async () => {
		await ingestSnapshot(db as unknown as DB, 'rb1', { capturedAt: new Date() })
		const row = db.select().from(schema.systemSnapshots).all()[0]
		expect(row?.cpuPercent).toBeNull()
		expect(row?.memTotalMb).toBeNull()
		expect(row?.tempCelsius).toBeNull()
	})

	it('stores the storage array', async () => {
		const storage = [
			{ label: 'share', mount: '/recalbox/share', usedBytes: 500, sizeBytes: 1000, percent: 50 },
		]
		await ingestSnapshot(db as unknown as DB, 'rb1', {
			capturedAt: new Date('2026-06-20T20:00:00.000Z'),
			storage,
		})
		const row = db.select().from(schema.systemSnapshots).all()[0]
		expect(row?.storage).toEqual(storage)
	})

	it('stores null storage when omitted', async () => {
		await ingestSnapshot(db as unknown as DB, 'rb1', { capturedAt: new Date() })
		const row = db.select().from(schema.systemSnapshots).all()[0]
		expect(row?.storage).toBeNull()
	})
})
