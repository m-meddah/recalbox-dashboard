import { describe, expect, it, vi } from 'vitest'

// Real SQLite, seeded before the queries module grabs the db singleton: the whole
// point here is that the conditional UPDATE decides a single winner in the database,
// which no amount of mocking can demonstrate.
const { db } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE invitations (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'member',
			token_hash TEXT NOT NULL UNIQUE,
			expires_at INTEGER NOT NULL,
			invited_by_user_id TEXT NOT NULL,
			accepted_at INTEGER,
			created_at INTEGER NOT NULL
		);
	`)
	return { db: drizzle(sqlite), sqlite }
})

vi.mock('@/lib/db/index', () => ({ db }))

import { claimInvitation, insertInvitation, releaseInvitation } from '@/lib/db/invitation-queries'

async function seed(id: string) {
	await insertInvitation({
		id,
		email: `${id}@x.c`,
		role: 'member',
		tokenHash: `hash-${id}`,
		expiresAt: Date.now() + 60_000,
		invitedByUserId: 'admin1',
		acceptedAt: null,
		createdAt: Date.now(),
	})
}

describe('claimInvitation', () => {
	it('lets exactly one of two concurrent claims win', async () => {
		await seed('race')

		const results = await Promise.all([
			claimInvitation('race', 1000),
			claimInvitation('race', 1001),
		])

		expect(results.filter(Boolean)).toHaveLength(1)
	})

	it('lets exactly one of many concurrent claims win', async () => {
		await seed('storm')

		const results = await Promise.all(
			Array.from({ length: 12 }, (_, i) => claimInvitation('storm', 2000 + i)),
		)

		expect(results.filter(Boolean)).toHaveLength(1)
	})

	it('refuses a claim on an already-accepted invitation', async () => {
		await seed('taken')
		expect(await claimInvitation('taken', 1000)).toBe(true)

		expect(await claimInvitation('taken', 2000)).toBe(false)
	})

	it('refuses a claim on an unknown invitation', async () => {
		expect(await claimInvitation('nope', 1000)).toBe(false)
	})

	it('makes the invitation claimable again after a release', async () => {
		await seed('retry')
		expect(await claimInvitation('retry', 1000)).toBe(true)

		// A failed createUser must not burn the invitation.
		await releaseInvitation('retry')

		expect(await claimInvitation('retry', 2000)).toBe(true)
	})
})
