import { describe, expect, it, vi } from 'vitest'

// Seed a DB with one session per source BEFORE the queries module imports the singleton.
const { db } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recalbox_id TEXT,
			game_id INTEGER,
			started_at INTEGER NOT NULL,
			ended_at INTEGER,
			duration_seconds INTEGER,
			system TEXT NOT NULL,
			rom_path TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'scrobbler'
		);
		CREATE TABLE games (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recalbox_id TEXT, rom_path TEXT, name TEXT, region TEXT, sr_has_page INTEGER, sr_url TEXT
		);
	`)
	const now = Math.floor(Date.now() / 1000)
	const ins = sqlite.prepare(
		`INSERT INTO sessions (recalbox_id, started_at, ended_at, duration_seconds, system, rom_path, source)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
	ins.run('rb', now, now + 100, 100, 'snes', '/rom/scrob.zip', 'scrobbler')
	ins.run('rb', now, now + 200, 200, 'snes', '/rom/agent.zip', 'agent') // serverless push
	ins.run('rb', now, now + 999, 999, 'snes', '/rom/manual.zip', 'manual') // must be excluded
	return { db: drizzle(sqlite) }
})

vi.mock('@/lib/db/index', () => ({ db }))

import { getSessionStats } from '@/lib/db/queries'

describe('getSessionStats source filtering', () => {
	it('counts scrobbler + agent sessions but not manual', async () => {
		const stats = await getSessionStats({})
		expect(stats.totalPlaytimeSec).toBe(300) // 100 (scrobbler) + 200 (agent), NOT the 999 manual
		expect(stats.totalSessions).toBe(2)
		expect(stats.uniqueGames).toBe(2)
	})
})
