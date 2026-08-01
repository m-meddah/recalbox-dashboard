import { describe, expect, it, vi } from 'vitest'

// Seed two tenants' collections BEFORE the queries module imports the db singleton.
const { db } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE games (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recalbox_id TEXT,
			name TEXT NOT NULL,
			system TEXT NOT NULL,
			rom_path TEXT NOT NULL,
			favorite INTEGER NOT NULL DEFAULT 0,
			hidden INTEGER NOT NULL DEFAULT 0,
			play_count INTEGER DEFAULT 0,
			scrape_status TEXT NOT NULL DEFAULT 'pending',
			updated_at INTEGER NOT NULL
		);
	`)
	const ins = sqlite.prepare(
		'INSERT INTO games (recalbox_id, name, system, rom_path, favorite, hidden, play_count, updated_at) VALUES (?,?,?,?,?,?,?,0)',
	)
	// Alice: 2 snes (1 favorite, 1 never played) + 1 nes
	ins.run('rb-alice', 'A1', 'snes', '/a1.zip', 1, 0, 5)
	ins.run('rb-alice', 'A2', 'snes', '/a2.zip', 0, 0, 0)
	ins.run('rb-alice', 'A3', 'nes', '/a3.zip', 0, 0, 3)
	// Bob: 4 megadrive, all favorites, none played — must never appear in Alice's stats
	for (let i = 0; i < 4; i++) ins.run('rb-bob', `B${i}`, 'megadrive', `/b${i}.zip`, 1, 0, 0)
	// A hidden game on Alice's box stays excluded
	ins.run('rb-alice', 'A-hidden', 'snes', '/ah.zip', 0, 1, 0)
	return { db: drizzle(sqlite) }
})

vi.mock('@/lib/db', () => ({ db }))

import { getCollectionStats } from '@/lib/db/queries'

describe('getCollectionStats tenant scoping', () => {
	it("counts only the requested box's games", async () => {
		const stats = await getCollectionStats('rb-alice')

		expect(stats.totalGames).toBe(3)
		expect(stats.bySystem).toEqual({ snes: 2, nes: 1 })
	})

	it("never leaks another tenant's systems", async () => {
		const stats = await getCollectionStats('rb-alice')

		expect(stats.bySystem).not.toHaveProperty('megadrive')
	})

	it('scopes favorites and never-played to the box', async () => {
		const alice = await getCollectionStats('rb-alice')
		const bob = await getCollectionStats('rb-bob')

		expect(alice.favorites).toBe(1)
		expect(alice.neverPlayed).toBe(1)
		expect(bob.favorites).toBe(4)
		expect(bob.neverPlayed).toBe(4)
	})

	it('excludes hidden games', async () => {
		const stats = await getCollectionStats('rb-alice')

		// A-hidden is a 3rd snes row but must not be counted.
		expect(stats.bySystem.snes).toBe(2)
	})

	it('fails closed with no box rather than aggregating every tenant', async () => {
		const stats = await getCollectionStats(null)

		expect(stats).toEqual({ totalGames: 0, bySystem: {}, favorites: 0, neverPlayed: 0 })
	})
})
