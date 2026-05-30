import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { syncInheritedStats } from '../sync-inherited-stats'

function createTestDb() {
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE game_inherited_stats (
			game_id INTEGER PRIMARY KEY NOT NULL,
			play_count INTEGER NOT NULL DEFAULT 0,
			last_played_at INTEGER,
			imported_at INTEGER NOT NULL DEFAULT (unixepoch()),
			last_synced_at INTEGER NOT NULL DEFAULT (unixepoch())
		);
	`)
	return drizzle(sqlite, { schema })
}

describe('syncInheritedStats', () => {
	let db: ReturnType<typeof createTestDb>

	beforeEach(() => {
		db = createTestDb()
	})

	it('inserts a new entry', async () => {
		const result = await syncInheritedStats(db, [
			{ gameId: 1, playCount: 3, lastPlayedAt: new Date('2024-01-01T12:00:00Z') },
		])

		expect(result.imported).toBe(1)
		expect(result.skipped).toBe(0)

		const rows = await db.select().from(schema.gameInheritedStats).all()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.gameId).toBe(1)
		expect(rows[0]?.playCount).toBe(3)
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
