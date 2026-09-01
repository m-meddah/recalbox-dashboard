import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	INSTALLER_TOKEN_NAME,
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

	describe('agent-declared version', () => {
		it('is recorded on a check-in that carries one', async () => {
			const { token, row } = await createAgentToken(db, 'rb1')
			await resolveAgentToken(db, token, '1.2.3')
			const list = await listAgentTokens(db, 'rb1')
			expect(list.find((t) => t.id === row.id)?.agentVersion).toBe('1.2.3')
		})

		it('a header-less check-in does not erase a previously recorded version', async () => {
			const { token, row } = await createAgentToken(db, 'rb1')
			await resolveAgentToken(db, token, '1.2.3')
			// Second check-in with no version (or a request that never sent the
			// header): must not blank out what is already known.
			await resolveAgentToken(db, token, null)
			const list = await listAgentTokens(db, 'rb1')
			expect(list.find((t) => t.id === row.id)?.agentVersion).toBe('1.2.3')
		})
	})

	describe('installer token cleanup on first check-in', () => {
		it('a re-download does not revoke a previously minted unused token', async () => {
			const first = await createAgentToken(db, 'rb1', INSTALLER_TOKEN_NAME)
			// Simulates a second download minting a second token — nothing about
			// minting a token should touch any other token.
			await createAgentToken(db, 'rb1', INSTALLER_TOKEN_NAME)
			const list = await listAgentTokens(db, 'rb1')
			expect(list.find((t) => t.id === first.row.id)?.revokedAt).toBeNull()
		})

		it("a token's first check-in revokes sibling unused installer tokens for the same box", async () => {
			const stale = await createAgentToken(db, 'rb1', INSTALLER_TOKEN_NAME)
			const live = await createAgentToken(db, 'rb1', INSTALLER_TOKEN_NAME)
			await resolveAgentToken(db, live.token) // first check-in of `live`
			const list = await listAgentTokens(db, 'rb1')
			expect(list.find((t) => t.id === stale.row.id)?.revokedAt).not.toBeNull()
			expect(list.find((t) => t.id === live.row.id)?.revokedAt).toBeNull()
		})

		it('a second check-in of the same token does not re-run the cleanup', async () => {
			const live = await createAgentToken(db, 'rb1', INSTALLER_TOKEN_NAME)
			await resolveAgentToken(db, live.token) // first check-in: cleanup runs
			const later = await createAgentToken(db, 'rb1', INSTALLER_TOKEN_NAME)
			await resolveAgentToken(db, live.token) // second check-in: must NOT revoke `later`
			const list = await listAgentTokens(db, 'rb1')
			expect(list.find((t) => t.id === later.row.id)?.revokedAt).toBeNull()
		})

		it("never touches another Recalbox's tokens", async () => {
			const otherBox = await createAgentToken(db, 'rb2', INSTALLER_TOKEN_NAME)
			const live = await createAgentToken(db, 'rb1', INSTALLER_TOKEN_NAME)
			await resolveAgentToken(db, live.token) // first check-in on rb1
			const otherList = await listAgentTokens(db, 'rb2')
			expect(otherList.find((t) => t.id === otherBox.row.id)?.revokedAt).toBeNull()
		})
	})
})
