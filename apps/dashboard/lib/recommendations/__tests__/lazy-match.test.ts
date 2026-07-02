import path from 'node:path'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

const sqlite = new Database(':memory:')
sqlite.pragma('journal_mode = WAL')
const testDb = drizzle(sqlite, { schema })
migrate(testDb, { migrationsFolder: MIGRATIONS_FOLDER })

vi.mock('@/lib/db', () => ({ db: testDb }))

const matchGameAsync = vi.fn()
const matchHltbAsync = vi.fn()
vi.mock('@/lib/igdb/match-single', () => ({ matchGameAsync: (id: number) => matchGameAsync(id) }))
vi.mock('@/lib/hltb/match-single', () => ({ matchHltbAsync: (id: number) => matchHltbAsync(id) }))
vi.mock('@/lib/igdb/auth', () => ({ isIgdbEnabled: vi.fn() }))

const { triggerLazyMatching, triggerLazyHltbMatching } = await import('../recommend')

beforeEach(async () => {
	await testDb.delete(schema.gameIgdbMapping)
	await testDb.delete(schema.gameHltbMapping)
	matchGameAsync.mockReset()
	matchHltbAsync.mockReset()
})

afterEach(async () => {
	await testDb.delete(schema.gameIgdbMapping)
	await testDb.delete(schema.gameHltbMapping)
})

describe('triggerLazyMatching (IGDB)', () => {
	it('only matches candidates with no existing mapping', async () => {
		await testDb.insert(schema.gameIgdbMapping).values({ gameId: 1, igdbId: 100 })
		await testDb.insert(schema.gameIgdbMapping).values({ gameId: 2, igdbId: 200 })

		await triggerLazyMatching([1, 2, 3, 4])

		const called = matchGameAsync.mock.calls.map((c) => c[0]).sort()
		expect(called).toEqual([3, 4])
	})

	it('caps the number of triggered matches at 5', async () => {
		await triggerLazyMatching([10, 11, 12, 13, 14, 15, 16, 17])
		expect(matchGameAsync).toHaveBeenCalledTimes(5)
	})

	it('does nothing for an empty candidate list', async () => {
		await triggerLazyMatching([])
		expect(matchGameAsync).not.toHaveBeenCalled()
	})
})

describe('triggerLazyHltbMatching', () => {
	it('only matches candidates with no existing mapping', async () => {
		await testDb.insert(schema.gameHltbMapping).values({ gameId: 5, hltbId: 500 })

		await triggerLazyHltbMatching([5, 6, 7])

		const called = matchHltbAsync.mock.calls.map((c) => c[0]).sort()
		expect(called).toEqual([6, 7])
	})

	it('does nothing for an empty candidate list', async () => {
		await triggerLazyHltbMatching([])
		expect(matchHltbAsync).not.toHaveBeenCalled()
	})
})
