import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'

function createTestDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('foreign_keys = ON')
	sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recalbox_id TEXT,
      game_id INTEGER,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_seconds INTEGER,
      system TEXT NOT NULL,
      rom_path TEXT NOT NULL,
      auto_closed INTEGER DEFAULT 0,
      closed_reason TEXT,
      source TEXT NOT NULL DEFAULT 'scrobbler',
      duration_confidence TEXT NOT NULL DEFAULT 'measured',
      classification TEXT
    );
  `)
	return drizzle(sqlite, { schema })
}

describe('multi-tenant session queries', () => {
	const db = createTestDb()

	beforeAll(async () => {
		const now = Math.floor(Date.now() / 1000)
		await db.insert(schema.sessions).values([
			{
				recalboxId: 'rb-a',
				startedAt: new Date(now * 1000),
				endedAt: new Date((now + 60) * 1000),
				durationSeconds: 60,
				system: 'snes',
				romPath: '/rom/a.zip',
			},
			{
				recalboxId: 'rb-b',
				startedAt: new Date(now * 1000),
				endedAt: new Date((now + 120) * 1000),
				durationSeconds: 120,
				system: 'nes',
				romPath: '/rom/b.zip',
			},
		])
	})

	it('filters sessions by recalboxId', async () => {
		const rows = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.recalboxId, 'rb-a'))
		expect(rows).toHaveLength(1)
		expect(rows[0]?.romPath).toBe('/rom/a.zip')
	})

	it('returns all sessions when no recalboxId filter', async () => {
		const rows = await db.select().from(schema.sessions)
		expect(rows).toHaveLength(2)
	})

	it('does not cross-contaminate recalbox data', async () => {
		const rbA = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.recalboxId, 'rb-a'))
		const rbB = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.recalboxId, 'rb-b'))
		expect(rbA.every((r) => r.recalboxId === 'rb-a')).toBe(true)
		expect(rbB.every((r) => r.recalboxId === 'rb-b')).toBe(true)
	})
})
