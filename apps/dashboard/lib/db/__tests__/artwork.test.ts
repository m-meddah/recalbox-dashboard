import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { getArtwork, listWanted, markWanted, saveArtwork } from '../artwork'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

describe('artwork queries', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('marks a path wanted (url null) and lists it', async () => {
		await markWanted(db, 'rb1', '/recalbox/share/a.png')
		const wanted = await listWanted(db, 'rb1')
		expect(wanted).toHaveLength(1)
		expect(wanted[0]?.boxPath).toBe('/recalbox/share/a.png')
		expect(wanted[0]?.url).toBeNull()
	})

	it('markWanted is idempotent and never clobbers an uploaded url', async () => {
		await saveArtwork(db, 'rb1', '/recalbox/share/a.png', 'https://blob/x.png', 'image/png')
		await markWanted(db, 'rb1', '/recalbox/share/a.png') // must NOT wipe the url
		const row = await getArtwork(db, 'rb1', '/recalbox/share/a.png')
		expect(row?.url).toBe('https://blob/x.png')
		expect(await listWanted(db, 'rb1')).toHaveLength(0)
	})

	it('saveArtwork upserts the url and clears wanted state', async () => {
		await markWanted(db, 'rb1', '/recalbox/share/a.png')
		expect(await listWanted(db, 'rb1')).toHaveLength(1)
		await saveArtwork(db, 'rb1', '/recalbox/share/a.png', 'https://blob/a.png', 'image/png')
		const row = await getArtwork(db, 'rb1', '/recalbox/share/a.png')
		expect(row?.url).toBe('https://blob/a.png')
		expect(row?.uploadedAt).toBeTruthy()
		expect(await listWanted(db, 'rb1')).toHaveLength(0)
	})

	it('scopes wanted to the Recalbox', async () => {
		await markWanted(db, 'rb1', '/x/a.png')
		await markWanted(db, 'rb2', '/x/b.png')
		const w = await listWanted(db, 'rb1')
		expect(w).toHaveLength(1)
		expect(w[0]?.boxPath).toBe('/x/a.png')
	})
})
