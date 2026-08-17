import { describe, expect, it, vi } from 'vitest'

// Two users, one Recalbox each. Before scoping, every stats surface aggregated the
// whole table, so inviting a second person made each of them see the other's playtime.
const { db } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recalbox_id TEXT, game_id INTEGER,
			started_at INTEGER NOT NULL, ended_at INTEGER, duration_seconds INTEGER,
			system TEXT NOT NULL, rom_path TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'scrobbler'
		);
		CREATE TABLE games (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recalbox_id TEXT, rom_path TEXT, name TEXT, region TEXT,
			image_path TEXT, release_date INTEGER, sr_has_page INTEGER, sr_url TEXT
		);
		CREATE TABLE game_inherited_stats (
			game_id INTEGER PRIMARY KEY, play_count INTEGER, last_played_at INTEGER
		);
		CREATE TABLE game_hltb_mapping (game_id INTEGER PRIMARY KEY, hltb_id INTEGER);
		CREATE TABLE hltb_cache (hltb_id INTEGER PRIMARY KEY, main_story_seconds INTEGER);
		CREATE TABLE ra_game_mapping (
			recalbox_id TEXT, rom_path TEXT, ra_game_id INTEGER
		);
		CREATE TABLE ra_achievements (
			id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, unlocked_at INTEGER
		);
	`)

	const now = Math.floor(Date.now() / 1000) - 3600
	const session = sqlite.prepare(
		`INSERT INTO sessions (recalbox_id, started_at, ended_at, duration_seconds, system, rom_path)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
	session.run('mine', now, now + 200, 200, 'snes', '/rom/mine.zip')
	// The other user's box: far more playtime, so any leak is unmistakable.
	session.run('theirs', now, now + 9000, 9000, 'psx', '/rom/theirs.chd')
	session.run('theirs', now, now + 9000, 9000, 'psx', '/rom/theirs2.chd')

	const game = sqlite.prepare('INSERT INTO games (recalbox_id, rom_path, name) VALUES (?, ?, ?)')
	game.run('mine', '/rom/mine.zip', 'My Game')
	game.run('theirs', '/rom/theirs.chd', 'Their Game')
	game.run('theirs', '/rom/theirs2.chd', 'Their Other Game')

	// An inherited stat on the other user's game — the heatmap merges these in too.
	sqlite
		.prepare(
			'INSERT INTO game_inherited_stats (game_id, play_count, last_played_at) VALUES (?, ?, ?)',
		)
		.run(2, 5, now)

	return { db: drizzle(sqlite) }
})

vi.mock('@/lib/db/index', () => ({ db }))

import { getDashboardStats } from '@/lib/stats/calculators'

describe('getDashboardStats Recalbox scoping', () => {
	it('counts only the caller own boxes', async () => {
		const stats = await getDashboardStats('all', ['mine'])
		expect(stats.kpi.totalPlaytimeSec).toBe(200)
		expect(stats.kpi.totalSessions).toBe(1)
	})

	it('never lists another box session among the recent ones', async () => {
		const stats = await getDashboardStats('all', ['mine'])
		const names = stats.recentSessions.map((s) => s.gameName)
		expect(names).toEqual(['My Game'])
	})

	it('keeps another box inherited history out of the heatmap', async () => {
		const stats = await getDashboardStats('all', ['mine'])
		const inheritedOnly = stats.heatmap.flat().filter((d) => d.sessionCount > 1)
		expect(inheritedOnly).toEqual([])
	})

	it('shows nothing at all to a user who owns no box', async () => {
		const stats = await getDashboardStats('all', [])
		expect(stats.kpi.totalPlaytimeSec).toBe(0)
		expect(stats.kpi.totalSessions).toBe(0)
		expect(stats.recentSessions).toEqual([])
	})
})
