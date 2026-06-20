import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { type AgentSessionInput, ingestAgentSession } from '../ingest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

// In-memory better-sqlite3 (sync) cast to the libSQL DB type — drizzle's queries
// resolve when awaited, so the async production code works unchanged. Same trick
// the scrobbler session-manager tests use.
function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db
}

function sessionInput(overrides?: Partial<AgentSessionInput>): AgentSessionInput {
	return {
		startedAt: new Date('2026-06-20T20:00:00.000Z'),
		endedAt: new Date('2026-06-20T20:45:00.000Z'),
		durationSeconds: 2700,
		system: 'snes',
		romPath: '/roms/mario.sfc',
		gameName: 'Super Mario World',
		...overrides,
	}
}

describe('ingestAgentSession', () => {
	let db: ReturnType<typeof makeDb>
	beforeEach(() => {
		db = makeDb()
	})

	it('inserts a classified agent session', async () => {
		const res = await ingestAgentSession(db as unknown as DB, 'rb1', sessionInput())
		expect(res.created).toBe(true)

		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(1)
		const row = rows[0]
		expect(row?.recalboxId).toBe('rb1')
		expect(row?.source).toBe('agent')
		expect(row?.durationSeconds).toBe(2700)
		expect(row?.durationConfidence).toBe('measured')
		expect(row?.classification).toBe('meaningful') // 45 min
		expect(row?.endedAt).not.toBeNull()
		expect(row?.gameId).toBeNull() // no matching game in the collection
	})

	it('links gameId when a matching game exists for the same Recalbox', async () => {
		db.insert(schema.games)
			.values({
				recalboxId: 'rb1',
				name: 'Super Mario World',
				system: 'snes',
				romPath: '/roms/mario.sfc',
				updatedAt: new Date(),
			})
			.run()
		const gameId = db.select().from(schema.games).all()[0]?.id

		await ingestAgentSession(db as unknown as DB, 'rb1', sessionInput())
		const row = db.select().from(schema.sessions).all()[0]
		expect(row?.gameId).toBe(gameId)
	})

	it('does not link a game that belongs to a different Recalbox', async () => {
		db.insert(schema.games)
			.values({
				recalboxId: 'rb2',
				name: 'Super Mario World',
				system: 'snes',
				romPath: '/roms/mario.sfc',
				updatedAt: new Date(),
			})
			.run()

		await ingestAgentSession(db as unknown as DB, 'rb1', sessionInput())
		const row = db.select().from(schema.sessions).all()[0]
		expect(row?.gameId).toBeNull()
	})

	it('is idempotent for a retried push (same recalbox + rom + start)', async () => {
		const input = sessionInput()
		const a = await ingestAgentSession(db as unknown as DB, 'rb1', input)
		const b = await ingestAgentSession(db as unknown as DB, 'rb1', input)
		expect(a.created).toBe(true)
		expect(b.created).toBe(false)
		expect(b.sessionId).toBe(a.sessionId)
		expect(db.select().from(schema.sessions).all()).toHaveLength(1)
	})

	it('classifies a short session as a bounce', async () => {
		await ingestAgentSession(
			db as unknown as DB,
			'rb1',
			sessionInput({ durationSeconds: 300, endedAt: new Date('2026-06-20T20:05:00.000Z') }),
		)
		const row = db.select().from(schema.sessions).all()[0]
		expect(row?.classification).toBe('bounce') // 5 min
	})
})
