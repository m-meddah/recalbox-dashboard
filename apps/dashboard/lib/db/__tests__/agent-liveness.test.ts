import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentToken, resolveAgentToken, revokeAgentToken } from '../agent-queries'
import { getAgentLastSeen } from '../agent-liveness'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

describe('getAgentLastSeen', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('is empty when no token was ever used', async () => {
		await createAgentToken(db, 'rb1')
		expect((await getAgentLastSeen(db)).has('rb1')).toBe(false)
	})

	it('reports lastUsedAt after the agent authenticates', async () => {
		const { token } = await createAgentToken(db, 'rb1')
		await resolveAgentToken(db, token) // touches lastUsedAt (best-effort, awaited internally)
		// allow the fire-and-forget touch to settle
		await new Promise((r) => setTimeout(r, 20))
		const seen = await getAgentLastSeen(db)
		const t = seen.get('rb1')
		expect(t).toBeInstanceOf(Date)
		expect(Date.now() - (t as Date).getTime()).toBeLessThan(120_000)
	})

	it('excludes revoked tokens', async () => {
		const { token, row } = await createAgentToken(db, 'rb1')
		await resolveAgentToken(db, token)
		await new Promise((r) => setTimeout(r, 20))
		await revokeAgentToken(db, row.id)
		expect((await getAgentLastSeen(db)).has('rb1')).toBe(false)
	})
})
