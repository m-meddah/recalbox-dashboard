import path from 'node:path'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

const sqlite = new Database(':memory:')
sqlite.pragma('journal_mode = WAL')
const testDb = drizzle(sqlite, { schema })
migrate(testDb, { migrationsFolder: MIGRATIONS_FOLDER })

vi.mock('@/lib/db', () => ({ db: testDb }))

const { loadRecommenderGames, clearRecommenderGamesCache, RECOMMENDER_GAMES_TTL_MS } = await import(
	'../games-cache'
)

let idc = 1
async function seedGame(name: string, hidden = false) {
	const id = idc++
	await testDb.insert(schema.games).values({
		id,
		name,
		system: 'snes',
		romPath: `/roms/${id}.sfc`,
		hidden,
		updatedAt: new Date(),
	})
	return id
}

beforeEach(async () => {
	clearRecommenderGamesCache()
	await testDb.delete(schema.games)
})

describe('loadRecommenderGames', () => {
	it('returns only non-hidden games', async () => {
		await seedGame('visible')
		await seedGame('hidden-one', true)
		const rows = await loadRecommenderGames()
		expect(rows.map((r) => r.name)).toEqual(['visible'])
	})

	it('serves a cached snapshot within the TTL (new rows not seen until cleared)', async () => {
		await seedGame('first')
		const r1 = await loadRecommenderGames()
		expect(r1).toHaveLength(1)

		await seedGame('second')
		const r2 = await loadRecommenderGames()
		expect(r2).toHaveLength(1) // still the cached snapshot, not re-read

		clearRecommenderGamesCache()
		const r3 = await loadRecommenderGames()
		expect(r3).toHaveLength(2) // fresh read sees both
	})

	it('reloads after the TTL expires', async () => {
		let t = 1_000_000
		const clock = () => t
		await seedGame('x')
		expect(await loadRecommenderGames(clock)).toHaveLength(1)

		await seedGame('y')
		t += RECOMMENDER_GAMES_TTL_MS + 1
		expect(await loadRecommenderGames(clock)).toHaveLength(2)
	})

	it('projects the fields the scorer needs', async () => {
		await seedGame('zelda')
		const [row] = await loadRecommenderGames()
		expect(row).toMatchObject({
			name: 'zelda',
			system: 'snes',
			favorite: false,
		})
		expect(row).toHaveProperty('gameId')
		expect(row).toHaveProperty('imagePath')
		expect(row).toHaveProperty('videoPath')
		expect(row).toHaveProperty('genres')
	})
})
