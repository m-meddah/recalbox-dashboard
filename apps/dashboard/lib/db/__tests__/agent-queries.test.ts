import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	createAgentToken,
	listAgentTokens,
	resolveAgentToken,
	revokeAgentToken,
} from '../agent-queries'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

describe('agent token queries', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('creates a token and resolves it to its Recalbox', async () => {
		const { token, row } = await createAgentToken(db, 'rb1', 'Living room Pi')
		expect(token.startsWith('sra_')).toBe(true)
		const resolved = await resolveAgentToken(db, token)
		expect(resolved).toEqual({ recalboxId: 'rb1', tokenId: row.id })
	})

	it('returns null for an unknown token', async () => {
		await createAgentToken(db, 'rb1')
		expect(await resolveAgentToken(db, 'sra_nope')).toBeNull()
	})

	it('returns null after the token is revoked', async () => {
		const { token, row } = await createAgentToken(db, 'rb1')
		await revokeAgentToken(db, row.id)
		expect(await resolveAgentToken(db, token)).toBeNull()
	})

	it('lists only the tokens of the given Recalbox', async () => {
		await createAgentToken(db, 'rb1', 'a')
		await createAgentToken(db, 'rb1', 'b')
		await createAgentToken(db, 'rb2', 'c')
		const list = await listAgentTokens(db, 'rb1')
		expect(list).toHaveLength(2)
		expect(list.every((t) => t.recalboxId === 'rb1')).toBe(true)
	})

	it('stores only the hash, never the raw token', async () => {
		const { token, row } = await createAgentToken(db, 'rb1')
		expect(row.tokenHash).not.toBe(token)
		expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
	})
})
