import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stand in for a request scope. The real `after()` throws outside one, which is what
// sends resolveAgentToken down its inline-write fallback; capturing the task here
// exercises the branch that actually runs in a route.
const afterTasks: Array<() => unknown> = []
vi.mock('next/server', () => ({
	after: (task: () => unknown) => {
		afterTasks.push(task)
	},
}))

import { getAgentLastSeen } from '../agent-liveness'
import { createAgentToken, resolveAgentToken } from '../agent-queries'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

describe('resolveAgentToken inside a request scope', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
		afterTasks.length = 0
	})

	it('defers the lastUsedAt touch to after() instead of firing it loose', async () => {
		const { token } = await createAgentToken(db, 'rb1')
		await resolveAgentToken(db, token)

		// The whole point of the fix: the write is handed to the platform, which keeps
		// the invocation alive for it. A floating promise could be dropped once the
		// response flushed, and a lost touch makes a live box read as offline.
		expect(afterTasks).toHaveLength(1)
		expect((await getAgentLastSeen(db)).has('rb1')).toBe(false)
	})

	it('writes lastUsedAt when the deferred task runs', async () => {
		const { token } = await createAgentToken(db, 'rb1')
		await resolveAgentToken(db, token)

		await afterTasks[0]?.()

		expect((await getAgentLastSeen(db)).get('rb1')).toBeInstanceOf(Date)
	})

	it('still resolves the token while the touch is pending', async () => {
		const { token } = await createAgentToken(db, 'rb1')
		const resolved = await resolveAgentToken(db, token)

		expect(resolved?.recalboxId).toBe('rb1')
	})
})
