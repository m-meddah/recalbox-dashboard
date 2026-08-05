import path from 'node:path'
import type { DB } from '@/lib/db'
import { upsertNowPlaying } from '@/lib/db/now-playing'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSeedState } from '../build-seed-state'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

const BOX = 'rb-1'

async function seedBox(db: DB) {
	await db.insert(schema.recalboxes).values({
		id: BOX,
		name: 'Salon',
		host: 'recalbox.local',
		sshUser: 'root',
		sshPassword: 'recalboxroot',
		createdAt: new Date(),
	})
}

/** Insert an agent token whose lastUsedAt drives the liveness signal. */
async function seedToken(db: DB, lastUsedAt: Date | null) {
	await db.insert(schema.agentTokens).values({
		id: 'token-1',
		recalboxId: BOX,
		tokenHash: 'deadbeef',
		name: 'test',
		createdAt: new Date(),
		lastUsedAt,
	})
}

let db: DB
beforeEach(async () => {
	db = makeDb()
	await seedBox(db)
})

describe('buildSeedState', () => {
	it('retourne un seed vide quand aucune box n’est active', async () => {
		expect(await buildSeedState(db, null)).toEqual({
			box: null,
			game: null,
			online: false,
			lastSeenAt: null,
		})
	})

	it('expose le jeu en cours', async () => {
		await upsertNowPlaying(db, BOX, {
			playing: true,
			system: 'snes',
			systemFullName: 'Super Nintendo',
			gameName: 'Chrono Trigger',
			romPath: '/roms/snes/ct.zip',
			startedAt: new Date('2026-08-05T10:00:00Z'),
		})
		const seed = await buildSeedState(db, BOX)
		expect(seed.box).toBe(BOX)
		expect(seed.game?.type).toBe('game:start')
		expect(seed.game?.gameName).toBe('Chrono Trigger')
	})

	it('n’expose aucun jeu quand la partie est terminée', async () => {
		await upsertNowPlaying(db, BOX, {
			playing: false,
			romPath: '/roms/snes/ct.zip',
			gameName: 'Chrono Trigger',
		})
		const seed = await buildSeedState(db, BOX)
		expect(seed.game).toBeNull()
	})

	it('est en ligne quand l’agent a été vu récemment', async () => {
		await seedToken(db, new Date())
		const seed = await buildSeedState(db, BOX)
		expect(seed.online).toBe(true)
		expect(seed.lastSeenAt).toBeInstanceOf(Date)
	})

	it('est hors ligne au-delà de la fenêtre de vivacité', async () => {
		await seedToken(db, new Date(Date.now() - 10 * 60 * 1000))
		const seed = await buildSeedState(db, BOX)
		expect(seed.online).toBe(false)
		// lastSeenAt reste renseigné : l'UI affiche « dernier signal il y a 10 min ».
		expect(seed.lastSeenAt).toBeInstanceOf(Date)
	})

	it('est hors ligne quand aucun agent n’a jamais été vu', async () => {
		const seed = await buildSeedState(db, BOX)
		expect(seed.online).toBe(false)
		expect(seed.lastSeenAt).toBeNull()
	})
})
