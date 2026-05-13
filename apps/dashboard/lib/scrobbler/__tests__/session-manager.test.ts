import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema'
import { SessionManager } from '../session-manager'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db
}

function startEvent(romPath: string, startedAt: Date = new Date()): GameStartEvent {
	return { type: 'game:start', system: 'snes', systemFullName: 'Super Nintendo', gameName: 'Super Mario', romPath, startedAt }
}

function stopEvent(romPath: string, stoppedAt: Date = new Date()): GameStopEvent {
	return { type: 'game:stop', system: 'snes', gameName: 'Super Mario', romPath, stoppedAt }
}

describe('SessionManager', () => {
	let db: ReturnType<typeof makeDb>
	let manager: SessionManager

	beforeAll(() => {
		db = makeDb()
		manager = new SessionManager(db)
	})

	afterEach(async () => {
		db.delete(schema.sessions).run()
	})

	it('normal start then stop records a closed session', async () => {
		const startedAt = new Date(Date.now() - 30_000)
		const stoppedAt = new Date()

		await manager.openSession(startEvent('/roms/mario.sfc', startedAt))
		await manager.closeSession(stopEvent('/roms/mario.sfc', stoppedAt))

		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(1)
		const row = rows[0]!
		expect(row.romPath).toBe('/roms/mario.sfc')
		expect(row.endedAt).not.toBeNull()
		expect(row.durationSeconds).toBeGreaterThanOrEqual(29)
		expect(row.autoClosed).toBe(false)
	})

	it('second start auto-closes the first open session', async () => {
		const firstStart = new Date(Date.now() - 60_000)
		const secondStart = new Date()

		await manager.openSession(startEvent('/roms/mario.sfc', firstStart))
		await manager.openSession(startEvent('/roms/zelda.sfc', secondStart))

		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(2)

		const first = rows.find((r) => r.romPath === '/roms/mario.sfc')!
		expect(first.endedAt).not.toBeNull()
		expect(first.autoClosed).toBe(true)
		expect(first.closedReason).toBe('new_session_started')

		const second = rows.find((r) => r.romPath === '/roms/zelda.sfc')!
		expect(second.endedAt).toBeNull()
	})

	it('stop without prior start is ignored', async () => {
		await manager.closeSession(stopEvent('/roms/unknown.sfc', new Date()))
		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(0)
	})

	it('session shorter than MIN_DURATION_SEC is deleted on close', async () => {
		const startedAt = new Date(Date.now() - 5_000)
		const stoppedAt = new Date()

		await manager.openSession(startEvent('/roms/mario.sfc', startedAt))
		await manager.closeSession(stopEvent('/roms/mario.sfc', stoppedAt))

		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(0)
	})

	it('recoverOrphanSessions closes sessions older than maxAgeHours', async () => {
		const ancientStart = new Date(Date.now() - 14 * 3600 * 1000)
		const recentStart = new Date(Date.now() - 30_000)

		// Insert directly to avoid triggering auto-close between the two sessions
		db.insert(schema.sessions).values([
			{ startedAt: ancientStart, system: 'snes', romPath: '/roms/ancient.sfc' },
			{ startedAt: recentStart, system: 'snes', romPath: '/roms/recent.sfc' },
		]).run()

		const recovered = await manager.recoverOrphanSessions(12)
		expect(recovered).toBe(1)

		const rows = db.select().from(schema.sessions).all()
		const ancient = rows.find((r) => r.romPath === '/roms/ancient.sfc')!
		expect(ancient.endedAt).not.toBeNull()
		expect(ancient.durationSeconds).toBeLessThanOrEqual(3600)
		expect(ancient.closedReason).toBe('orphan_recovery')

		const recent = rows.find((r) => r.romPath === '/roms/recent.sfc')!
		expect(recent.endedAt).toBeNull()
	})

	it('crash recovery: after restart, recoverOrphanSessions handles all orphans', async () => {
		const orphanStart = new Date(Date.now() - 20 * 3600 * 1000)
		await manager.openSession(startEvent('/roms/orphan.sfc', orphanStart))

		// simulate daemon restart by creating a new manager with same db
		const newManager = new SessionManager(db)
		const recovered = await newManager.recoverOrphanSessions(12)
		expect(recovered).toBe(1)

		const rows = db.select().from(schema.sessions).all()
		expect(rows[0]!.endedAt).not.toBeNull()
		expect(rows[0]!.closedReason).toBe('orphan_recovery')
	})
})
