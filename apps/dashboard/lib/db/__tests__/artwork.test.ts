import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	getArtwork,
	listWanted,
	lookupArtworkUrls,
	markWanted,
	markWantedMany,
	resolveArtworkUrls,
	saveArtwork,
} from '../artwork'

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

	it('markWantedMany queues a batch without clobbering uploaded urls', async () => {
		await saveArtwork(db, 'rb1', '/x/kept.png', 'https://blob/kept.png', 'image/png')
		await markWantedMany(db, 'rb1', ['/x/a.png', '/x/b.png', '/x/kept.png'])
		expect((await listWanted(db, 'rb1')).map((r) => r.boxPath).sort()).toEqual([
			'/x/a.png',
			'/x/b.png',
		])
		expect((await getArtwork(db, 'rb1', '/x/kept.png'))?.url).toBe('https://blob/kept.png')
	})

	it('markWantedMany is a no-op on an empty batch', async () => {
		await expect(markWantedMany(db, 'rb1', [])).resolves.toBeUndefined()
		expect(await listWanted(db, 'rb1')).toHaveLength(0)
	})

	it('lookupArtworkUrls returns uploaded urls only, scoped to the Recalbox', async () => {
		await saveArtwork(db, 'rb1', '/x/a.png', 'https://blob/a.png', 'image/png')
		await markWanted(db, 'rb1', '/x/pending.png')
		await saveArtwork(db, 'rb2', '/x/other.png', 'https://blob/other.png', 'image/png')

		const found = await lookupArtworkUrls(db, 'rb1', ['/x/a.png', '/x/pending.png', '/x/other.png'])
		expect([...found]).toEqual([['/x/a.png', 'https://blob/a.png']])
	})

	it('lookupArtworkUrls handles an empty batch without querying', async () => {
		expect([...(await lookupArtworkUrls(db, 'rb1', []))]).toEqual([])
	})
})

describe('resolveArtworkUrls', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
		process.env.AGENT_ONLY_MEDIA = '1'
	})
	afterEach(() => {
		process.env.AGENT_ONLY_MEDIA = undefined
	})

	it('returns the hits and queues the misses for the agent', async () => {
		await saveArtwork(db, 'rb1', '/x/have.png', 'https://blob/have.png', 'image/png')

		const found = await resolveArtworkUrls(db, 'rb1', [
			'/x/have.png',
			'/x/missing.png',
			null,
			undefined,
		])

		expect(found.get('/x/have.png')).toBe('https://blob/have.png')
		expect(found.has('/x/missing.png')).toBe(false)
		expect((await listWanted(db, 'rb1')).map((r) => r.boxPath)).toEqual(['/x/missing.png'])
	})

	it('queues a repeated missing path once', async () => {
		await resolveArtworkUrls(db, 'rb1', ['/x/dup.png', '/x/dup.png'])
		expect(await listWanted(db, 'rb1')).toHaveLength(1)
	})

	// Self-hosted serves artwork over SSH and has no agent to upload anything, so
	// resolution must stay inert: no urls, and no rows written on every render.
	it('is a no-op outside serverless mode', async () => {
		process.env.AGENT_ONLY_MEDIA = undefined
		await saveArtwork(db, 'rb1', '/x/have.png', 'https://blob/have.png', 'image/png')

		const found = await resolveArtworkUrls(db, 'rb1', ['/x/have.png', '/x/missing.png'])

		expect([...found]).toEqual([])
		expect(await listWanted(db, 'rb1')).toHaveLength(0)
	})
})
