import { describe, expect, it, vi } from 'vitest'

// Build an in-memory DB and seed it BEFORE the queries module imports the singleton.
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
			recalbox_id TEXT,
			rom_path TEXT,
			name TEXT,
			region TEXT,
			sr_has_page INTEGER,
			sr_url TEXT
		);
	`)
	const now = Math.floor(Date.now() / 1000)
	const ins = sqlite.prepare(
		`INSERT INTO sessions (recalbox_id, started_at, ended_at, duration_seconds, system, rom_path, source)
		 VALUES (?, ?, ?, ?, ?, ?, 'scrobbler')`,
	)
	ins.run('rb-a', now, now + 60, 60, 'snes', '/rom/a.zip')
	ins.run('rb-b', now, now + 120, 120, 'nes', '/rom/b.zip')
	ins.run('rb-c', now, now + 999, 999, 'gba', '/rom/c.zip')
	// Seed games: same rom_path on two different recalboxes to test join double-counting
	const insG = sqlite.prepare('INSERT INTO games (recalbox_id, rom_path, name) VALUES (?, ?, ?)')
	insG.run('rb-a', '/rom/a.zip', 'Game A')
	insG.run('rb-b', '/rom/a.zip', 'Game A') // same rom on another machine
	return { db: drizzle(sqlite) }
})

vi.mock('@/lib/db/index', () => ({ db }))

import { getSessionStats } from '@/lib/db/queries'

describe('getSessionStats recalboxIds filter', () => {
	// All tests are read-only; the DB is seeded once in vi.hoisted above.

	it('sums only the requested recalbox set', async () => {
		const stats = await getSessionStats({ recalboxIds: ['rb-a', 'rb-b'] })
		expect(stats.totalPlaytimeSec).toBe(180)
		expect(stats.totalSessions).toBe(2)
	})

	it('returns zeros for an empty set (no machines owned)', async () => {
		const stats = await getSessionStats({ recalboxIds: [] })
		expect(stats.totalPlaytimeSec).toBe(0)
		expect(stats.totalSessions).toBe(0)
		expect(stats.topGames).toEqual([])
	})

	it('still aggregates everything when no filter is given', async () => {
		const stats = await getSessionStats({})
		expect(stats.totalPlaytimeSec).toBe(60 + 120 + 999)
	})

	it('does not double-count top-game playtime when the same rom exists on multiple machines', async () => {
		const stats = await getSessionStats({ recalboxIds: ['rb-a'] })
		const gameA = stats.topGames.find((g) => g.romPath === '/rom/a.zip')
		expect(gameA?.playtimeSec).toBe(60) // the single rb-a session, NOT 120
		expect(gameA?.sessionCount).toBe(1)
	})
})
