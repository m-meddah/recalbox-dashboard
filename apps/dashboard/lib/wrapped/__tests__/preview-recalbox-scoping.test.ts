import { describe, expect, it, vi } from 'vitest'

// Two Recalboxes that own the SAME rom path — the normal case once a second box is
// enrolled, since retro collections overlap heavily. Only the first box has actually
// played anything; the second merely has the game in its collection.
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
			recalbox_id TEXT, rom_path TEXT, name TEXT, region TEXT,
			image_path TEXT, release_date INTEGER, sr_has_page INTEGER, sr_url TEXT
		);
	`)

	const start = Math.floor(new Date('2026-06-01T12:00:00Z').getTime() / 1000)
	const session = sqlite.prepare(
		`INSERT INTO sessions (recalbox_id, started_at, ended_at, duration_seconds, system, rom_path)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
	// box1 played the shared rom for 200s and its own exclusive rom for 300s.
	session.run('box1', start, start + 200, 200, 'snes', '/rom/shared.zip')
	session.run('box1', start, start + 300, 300, 'snes', '/rom/exclusive.zip')

	const game = sqlite.prepare('INSERT INTO games (recalbox_id, rom_path, name) VALUES (?, ?, ?)')
	// box2's row is inserted FIRST so an unscoped join is not accidentally right.
	game.run('box2', '/rom/shared.zip', 'Shared Game (box2 copy)')
	game.run('box1', '/rom/shared.zip', 'Shared Game')
	game.run('box1', '/rom/exclusive.zip', 'Exclusive Game')

	return { db: drizzle(sqlite) }
})

vi.mock('@/lib/db/index', () => ({ db }))

import { getWrappedPreview } from '@/lib/wrapped/preview'

describe('getWrappedPreview cross-Recalbox scoping', () => {
	it('does not let a second box duplicate a session and crown the wrong top game', async () => {
		// Joining on rom_path alone matches BOTH game rows for the shared rom, so the
		// LEFT JOIN emits that session twice and SUM(duration) reads 400s instead of 200s
		// — enough to outrank the genuinely most-played game at 300s.
		const preview = await getWrappedPreview(2026)
		expect(preview?.topGame).toBe('Exclusive Game')
	})

	it('reports the playing box name, not another box copy of the same rom', async () => {
		const preview = await getWrappedPreview(2026)
		expect(preview?.topGame).not.toContain('box2')
	})

	it('keeps the playtime total intact', async () => {
		const preview = await getWrappedPreview(2026)
		expect(preview?.hours).toBe(0)
		expect(preview?.minutes).toBe(8) // 500s
	})
})
