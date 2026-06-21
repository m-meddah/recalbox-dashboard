import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	claimPendingCommands,
	completeCommand,
	enqueueCommand,
	listCommands,
} from '../agent-commands'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

describe('agent command queue', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('enqueues a pending command with its payload', async () => {
		const row = await enqueueCommand(db, 'rb1', 'power', { action: 'reboot' }, 'user1')
		expect(row.status).toBe('pending')
		expect(row.recalboxId).toBe('rb1')
		expect(row.payload).toEqual({ action: 'reboot' })
		expect(row.createdBy).toBe('user1')
	})

	it('claims pending commands once and marks them claimed', async () => {
		await enqueueCommand(db, 'rb1', 'power', { action: 'reboot' })
		await enqueueCommand(db, 'rb1', 'conf', { key: 'a.b', value: '1' })
		const first = await claimPendingCommands(db, 'rb1')
		expect(first).toHaveLength(2)
		expect(first.every((c) => c.status === 'claimed' && c.claimedAt)).toBe(true)
		// A second poll gets nothing — they are no longer pending.
		expect(await claimPendingCommands(db, 'rb1')).toHaveLength(0)
	})

	it('does not hand an agent another Recalbox’s commands', async () => {
		await enqueueCommand(db, 'rb1', 'power', { action: 'reboot' })
		await enqueueCommand(db, 'rb2', 'power', { action: 'reboot' })
		const claimed = await claimPendingCommands(db, 'rb1')
		expect(claimed).toHaveLength(1)
		expect(claimed[0]?.recalboxId).toBe('rb1')
	})

	it('completes a claimed command scoped to its Recalbox', async () => {
		const row = await enqueueCommand(db, 'rb1', 'conf', { key: 'a.b', value: '1' })
		await claimPendingCommands(db, 'rb1')
		const ok = await completeCommand(db, 'rb1', row.id, true, 'a.b=1')
		expect(ok).toBe(true)
		const [stored] = await listCommands(db, 'rb1')
		expect(stored?.status).toBe('done')
		expect(stored?.result).toBe('a.b=1')
		expect(stored?.completedAt).toBeTruthy()
	})

	it('marks failures as failed with the error', async () => {
		const row = await enqueueCommand(db, 'rb1', 'launch', { romPath: '/x', system: 'snes' })
		const ok = await completeCommand(db, 'rb1', row.id, false, 'launch not supported')
		expect(ok).toBe(true)
		const [stored] = await listCommands(db, 'rb1')
		expect(stored?.status).toBe('failed')
		expect(stored?.result).toBe('launch not supported')
	})

	it('refuses to complete a command belonging to another Recalbox', async () => {
		const row = await enqueueCommand(db, 'rb1', 'power', { action: 'reboot' })
		expect(await completeCommand(db, 'rb2', row.id, true)).toBe(false)
	})

	it('lists a Recalbox’s commands newest first', async () => {
		await enqueueCommand(db, 'rb1', 'power', { action: 'reboot' })
		await enqueueCommand(db, 'rb1', 'conf', { key: 'a.b', value: '1' })
		await enqueueCommand(db, 'rb2', 'power', { action: 'reboot' })
		const list = await listCommands(db, 'rb1')
		expect(list).toHaveLength(2)
		expect(list.every((c) => c.recalboxId === 'rb1')).toBe(true)
	})
})
