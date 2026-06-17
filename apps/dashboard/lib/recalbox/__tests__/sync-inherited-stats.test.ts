import path from 'node:path'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { importInheritedStatsFromGames, syncInheritedStats } from '../sync-inherited-stats'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function createTestDb() {
	const sqlite = new Database(':memory:')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db
}

function seedGame(
	db: ReturnType<typeof createTestDb>,
	g: {
		recalboxId: string
		playCount?: number
		lastPlayed?: Date | null
		playTimeSeconds?: number
	},
) {
	return db
		.insert(schema.games)
		.values({
			recalboxId: g.recalboxId,
			name: 'Game',
			system: 'snes',
			romPath: `/roms/${Math.random()}.zip`,
			playCount: g.playCount ?? 0,
			lastPlayed: g.lastPlayed ?? null,
			playTimeSeconds: g.playTimeSeconds ?? 0,
			updatedAt: new Date(),
		})
		.run()
}

describe('syncInheritedStats', () => {
	let db: ReturnType<typeof createTestDb>

	beforeEach(() => {
		db = createTestDb()
	})

	it('inserts a new entry', async () => {
		const result = await syncInheritedStats(db, [
			{
				gameId: 1,
				playCount: 3,
				lastPlayedAt: new Date('2024-01-01T12:00:00Z'),
				playTimeSeconds: 7200,
			},
		])

		expect(result.imported).toBe(1)
		expect(result.skipped).toBe(0)

		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.gameId).toBe(1)
		expect(rows[0]?.playCount).toBe(3)
		expect(rows[0]?.playTimeSeconds).toBe(7200)
	})

	it('updates playTimeSeconds on conflict', async () => {
		await syncInheritedStats(db, [
			{ gameId: 1, playCount: 3, lastPlayedAt: null, playTimeSeconds: 300 },
		])
		await syncInheritedStats(db, [
			{ gameId: 1, playCount: 5, lastPlayedAt: null, playTimeSeconds: 9000 },
		])

		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows[0]?.playTimeSeconds).toBe(9000)
	})

	it('keeps an entry that only has play time (no playCount, no lastPlayedAt)', async () => {
		const result = await syncInheritedStats(db, [
			{ gameId: 7, playCount: 0, lastPlayedAt: null, playTimeSeconds: 600 },
		])

		expect(result.imported).toBe(1)
		expect(result.skipped).toBe(0)
	})

	it('updates an existing entry on conflict', async () => {
		await syncInheritedStats(db, [
			{ gameId: 1, playCount: 3, lastPlayedAt: new Date('2024-01-01T12:00:00Z') },
		])
		await syncInheritedStats(db, [
			{ gameId: 1, playCount: 5, lastPlayedAt: new Date('2024-06-01T12:00:00Z') },
		])

		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.playCount).toBe(5)
	})

	it('skips entries with playCount=0 and no lastPlayedAt', async () => {
		const result = await syncInheritedStats(db, [{ gameId: 99, playCount: 0, lastPlayedAt: null }])

		expect(result.skipped).toBe(1)
		expect(result.imported).toBe(0)

		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows).toHaveLength(0)
	})

	it('inserts entries with playCount=0 but a lastPlayedAt', async () => {
		// lastPlayedAt without a playCount is unusual but should not be silently dropped
		const result = await syncInheritedStats(db, [
			{ gameId: 2, playCount: 0, lastPlayedAt: new Date('2023-05-01T00:00:00Z') },
		])

		expect(result.imported).toBe(1)
		expect(result.skipped).toBe(0)
	})

	it('handles a mix of valid and skipped entries', async () => {
		const result = await syncInheritedStats(db, [
			{ gameId: 1, playCount: 1, lastPlayedAt: new Date('2024-01-01T12:00:00Z') },
			{ gameId: 2, playCount: 0, lastPlayedAt: null },
			{ gameId: 3, playCount: 7, lastPlayedAt: null },
		])

		expect(result.imported).toBe(2)
		expect(result.skipped).toBe(1)

		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows).toHaveLength(2)
	})
})

describe('importInheritedStatsFromGames', () => {
	let db: ReturnType<typeof createTestDb>

	beforeEach(() => {
		db = createTestDb()
	})

	it('imports games that have any play signal and skips the rest', async () => {
		seedGame(db, { recalboxId: 'rb1', playCount: 3, playTimeSeconds: 9000 })
		seedGame(db, { recalboxId: 'rb1', lastPlayed: new Date('2024-01-01T00:00:00Z') })
		seedGame(db, { recalboxId: 'rb1', playTimeSeconds: 600 })
		seedGame(db, { recalboxId: 'rb1' }) // no signal → not even a candidate

		const result = await importInheritedStatsFromGames(db)

		expect(result.imported).toBe(3)
		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows).toHaveLength(3)
		expect(rows.find((r) => r.playTimeSeconds === 9000)?.playCount).toBe(3)
	})

	it('filters by recalboxId when provided', async () => {
		seedGame(db, { recalboxId: 'rb1', playCount: 2, playTimeSeconds: 8000 })
		seedGame(db, { recalboxId: 'rb2', playCount: 4, playTimeSeconds: 8000 })

		const result = await importInheritedStatsFromGames(db, 'rb1')

		expect(result.imported).toBe(1)
		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.playCount).toBe(2)
	})

	it('returns zero counts when there are no candidates', async () => {
		seedGame(db, { recalboxId: 'rb1' })

		const result = await importInheritedStatsFromGames(db)

		expect(result.imported).toBe(0)
		expect(result.skipped).toBe(0)
	})
})
