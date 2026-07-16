import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentToken, resolveAgentToken } from '../agent-queries'
import { deleteRecalbox } from '../recalbox-queries'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

const snapshots = (db: DB, id: string) =>
	db.select().from(schema.systemSnapshots).where(eq(schema.systemSnapshots.recalboxId, id)).all()

describe('deleteRecalbox cascade', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('deletes dependent rows + revokes tokens for the box, leaving other boxes intact', async () => {
		const now = new Date()
		await db.insert(schema.recalboxes).values({
			id: 'rb1',
			name: 'A',
			host: 'h',
			sshUser: 'u',
			sshPassword: 'p',
			createdAt: now,
		})
		await db.insert(schema.systemSnapshots).values([
			{ recalboxId: 'rb1', capturedAt: now },
			{ recalboxId: 'rb2', capturedAt: now },
		])
		await db.insert(schema.nowPlaying).values([
			{ recalboxId: 'rb1', updatedAt: now },
			{ recalboxId: 'rb2', updatedAt: now },
		])
		const { token: t1 } = await createAgentToken(db, 'rb1')
		const { token: t2 } = await createAgentToken(db, 'rb2')

		await deleteRecalbox('rb1', db)

		// rb1: fully cascaded + token revoked (row gone → resolves to null)
		expect(snapshots(db, 'rb1')).toHaveLength(0)
		expect(
			db.select().from(schema.nowPlaying).where(eq(schema.nowPlaying.recalboxId, 'rb1')).all(),
		).toHaveLength(0)
		expect(
			db.select().from(schema.recalboxes).where(eq(schema.recalboxes.id, 'rb1')).all(),
		).toHaveLength(0)
		expect(await resolveAgentToken(db, t1)).toBeNull()

		// rb2: untouched
		expect(snapshots(db, 'rb2')).toHaveLength(1)
		expect(await resolveAgentToken(db, t2)).not.toBeNull()
	})
})
