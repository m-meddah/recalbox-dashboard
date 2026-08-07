import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

// listGames reads the db singleton, so the in-memory db has to stand in for it.
let db: DB = makeDb()
vi.mock('@/lib/db/index', () => ({
	get db() {
		return db
	},
}))

const { listGames } = await import('../queries')
const { saveArtwork, listWanted } = await import('../artwork')

async function seedGames() {
	await db.insert(schema.games).values([
		{
			recalboxId: 'rb1',
			name: 'Sonic',
			system: 'megadrive',
			romPath: '/roms/sonic.zip',
			imagePath: '/recalbox/share/img/sonic.png',
			updatedAt: new Date(),
		},
		{
			recalboxId: 'rb1',
			name: 'Zelda',
			system: 'snes',
			romPath: '/roms/zelda.zip',
			imagePath: '/recalbox/share/img/zelda.png',
			updatedAt: new Date(),
		},
	])
}

describe('listGames artwork resolution', () => {
	beforeEach(async () => {
		db = makeDb()
		process.env.AGENT_ONLY_MEDIA = '1'
		await seedGames()
	})
	afterEach(() => {
		process.env.AGENT_ONLY_MEDIA = undefined
	})

	it('attaches the stored url and queues the covers it lacks', async () => {
		await saveArtwork(db, 'rb1', '/recalbox/share/img/sonic.png', 'https://blob/sonic.png', null)

		const { games } = await listGames({ recalboxId: 'rb1' })
		const byName = new Map(games.map((g) => [g.name, g]))

		expect(byName.get('Sonic')?.imageUrl).toBe('https://blob/sonic.png')
		expect(byName.get('Zelda')?.imageUrl).toBeNull()
		// The miss is requested here rather than costing an /api/media invocation.
		expect((await listWanted(db, 'rb1')).map((r) => r.boxPath)).toEqual([
			'/recalbox/share/img/zelda.png',
		])
	})

	// Self-hosted proxies artwork over SSH; the render must keep falling back to
	// /api/media and must not write wanted rows on every page view.
	it('leaves imageUrl null and writes nothing outside serverless mode', async () => {
		process.env.AGENT_ONLY_MEDIA = undefined
		await saveArtwork(db, 'rb1', '/recalbox/share/img/sonic.png', 'https://blob/sonic.png', null)

		const { games } = await listGames({ recalboxId: 'rb1' })

		expect(games.every((g) => g.imageUrl === null)).toBe(true)
		expect(await listWanted(db, 'rb1')).toHaveLength(0)
	})
})
