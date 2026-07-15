import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { getLatestSnapshots, snapshotToSystemInfo } from '../system-info'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

async function insert(db: DB, recalboxId: string, capturedAt: Date, temp: number) {
	await db.insert(schema.systemSnapshots).values({
		recalboxId,
		capturedAt,
		cpuPercent: 12.5,
		memUsedMb: 500,
		memTotalMb: 4096,
		tempCelsius: temp,
		uptimeSeconds: 1000,
	})
}

describe('getLatestSnapshots', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('is empty when there are no snapshots', async () => {
		expect((await getLatestSnapshots(db)).size).toBe(0)
	})

	it('returns the most recent snapshot per recalbox', async () => {
		await insert(db, 'rb1', new Date('2026-01-01T00:00:00Z'), 50)
		await insert(db, 'rb1', new Date('2026-01-01T00:01:00Z'), 58) // newer (higher id)
		await insert(db, 'rb2', new Date('2026-01-01T00:00:30Z'), 41)
		const latest = await getLatestSnapshots(db)
		expect(latest.size).toBe(2)
		expect(latest.get('rb1')?.tempCelsius).toBe(58)
		expect(latest.get('rb2')?.tempCelsius).toBe(41)
	})
})

describe('snapshotToSystemInfo', () => {
	it('maps snapshot columns to a system:info event', () => {
		const ev = snapshotToSystemInfo({
			id: 1,
			recalboxId: 'rb1',
			capturedAt: new Date('2026-01-01T00:00:00Z'),
			cpuPercent: 12.5,
			memUsedMb: 500,
			memTotalMb: 4096,
			tempCelsius: 58.4,
			uptimeSeconds: 1000,
			storage: null,
		})
		expect(ev).toEqual({
			type: 'system:info',
			timestamp: '2026-01-01T00:00:00.000Z',
			cpuPercent: 12.5,
			memUsedMb: 500,
			memTotalMb: 4096,
			tempCelsius: 58.4,
		})
	})

	it('coerces null metrics to 0', () => {
		const ev = snapshotToSystemInfo({
			id: 1,
			recalboxId: 'rb1',
			capturedAt: new Date('2026-01-01T00:00:00Z'),
			cpuPercent: null,
			memUsedMb: null,
			memTotalMb: null,
			tempCelsius: null,
			uptimeSeconds: null,
			storage: null,
		})
		expect(ev.cpuPercent).toBe(0)
		expect(ev.tempCelsius).toBe(0)
	})
})
