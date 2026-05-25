import path from 'node:path'
import * as schema from '@/lib/db/schema'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SessionManager } from '../session-manager'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db
}

function startEvent(
	romPath: string,
	startedAt: Date = new Date(),
	overrides?: Partial<GameStartEvent>,
): GameStartEvent {
	return {
		type: 'game:start',
		system: 'snes',
		systemFullName: 'Super Nintendo',
		gameName: 'Super Mario',
		romPath,
		startedAt,
		...overrides,
	}
}

/** Mirrors the onStart guard in scrobbler/index.ts */
async function scrobblerOnStart(
	manager: SessionManager,
	event: GameStartEvent,
	recalboxId = 'rb1',
): Promise<void> {
	if (event.fromScreensaver) return
	await manager.openSession(event, recalboxId)
}

/** Mirrors the onScreensaverStop handler in scrobbler/index.ts */
async function scrobblerOnScreensaverStop(
	manager: SessionManager,
	lastKnownGame: GameStartEvent | null,
	recalboxId = 'rb1',
): Promise<void> {
	if (!lastKnownGame?.fromScreensaver) return
	const realEvent: GameStartEvent = { ...lastKnownGame, fromScreensaver: false, startedAt: new Date() }
	await manager.openSession(realEvent, recalboxId)
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

		await manager.openSession(startEvent('/roms/mario.sfc', startedAt), 'rb1')
		await manager.closeSession(stopEvent('/roms/mario.sfc', stoppedAt))

		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(1)
		// biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength(1)
		const row = rows[0]!
		expect(row.romPath).toBe('/roms/mario.sfc')
		expect(row.endedAt).not.toBeNull()
		expect(row.durationSeconds).toBeGreaterThanOrEqual(29)
		expect(row.autoClosed).toBe(false)
	})

	it('second start auto-closes the first open session', async () => {
		const firstStart = new Date(Date.now() - 60_000)
		const secondStart = new Date()

		await manager.openSession(startEvent('/roms/mario.sfc', firstStart), 'rb1')
		await manager.openSession(startEvent('/roms/zelda.sfc', secondStart), 'rb1')

		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(2)

		// biome-ignore lint/style/noNonNullAssertion: test context
		const first = rows.find((r) => r.romPath === '/roms/mario.sfc')!
		expect(first.endedAt).not.toBeNull()
		expect(first.autoClosed).toBe(true)
		expect(first.closedReason).toBe('new_session_started')

		// biome-ignore lint/style/noNonNullAssertion: test context
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

		await manager.openSession(startEvent('/roms/mario.sfc', startedAt), 'rb1')
		await manager.closeSession(stopEvent('/roms/mario.sfc', stoppedAt))

		const rows = db.select().from(schema.sessions).all()
		expect(rows).toHaveLength(0)
	})

	it('recoverOrphanSessions closes sessions older than maxAgeHours', async () => {
		const ancientStart = new Date(Date.now() - 14 * 3600 * 1000)
		const recentStart = new Date(Date.now() - 30_000)

		// Insert directly to avoid triggering auto-close between the two sessions
		db.insert(schema.sessions)
			.values([
				{ startedAt: ancientStart, system: 'snes', romPath: '/roms/ancient.sfc' },
				{ startedAt: recentStart, system: 'snes', romPath: '/roms/recent.sfc' },
			])
			.run()

		const recovered = await manager.recoverOrphanSessions(12)
		expect(recovered).toBe(1)

		const rows = db.select().from(schema.sessions).all()
		// biome-ignore lint/style/noNonNullAssertion: test context
		const ancient = rows.find((r) => r.romPath === '/roms/ancient.sfc')!
		expect(ancient.endedAt).not.toBeNull()
		expect(ancient.durationSeconds).toBeLessThanOrEqual(3600)
		expect(ancient.closedReason).toBe('orphan_recovery')

		// biome-ignore lint/style/noNonNullAssertion: test context
		const recent = rows.find((r) => r.romPath === '/roms/recent.sfc')!
		expect(recent.endedAt).toBeNull()
	})

	describe('demo mode / screensaver filtering', () => {
		it('does not record a session when fromScreensaver is true', async () => {
			const event = startEvent('/roms/demo.sfc', new Date(Date.now() - 60_000), {
				fromScreensaver: true,
			})
			await scrobblerOnStart(manager, event)

			const rows = db.select().from(schema.sessions).all()
			expect(rows).toHaveLength(0)
		})

		it('does not record a session even if the demo runs long enough to pass MIN_DURATION_SEC', async () => {
			// 5-minute demo — would normally be scrobbled
			const event = startEvent('/roms/demo_long.sfc', new Date(Date.now() - 300_000), {
				fromScreensaver: true,
			})
			await scrobblerOnStart(manager, event)
			await manager.closeSession(stopEvent('/roms/demo_long.sfc', new Date()))

			const rows = db.select().from(schema.sessions).all()
			expect(rows).toHaveLength(0)
		})

		it('records a session when user takes over a demo game (wakeup during demo mode)', async () => {
			// demo starts → ignored by scrobbler
			const demoGame = startEvent('/roms/metroid.sfc', new Date(Date.now() - 120_000), {
				fromScreensaver: true,
			})
			await scrobblerOnStart(manager, demoGame)
			expect(db.select().from(schema.sessions).all()).toHaveLength(0)

			// user presses a button → screensaver:stop → scrobbler opens session from now
			await scrobblerOnScreensaverStop(manager, demoGame)

			// user plays for 60s then quits
			await manager.closeSession(stopEvent('/roms/metroid.sfc', new Date(Date.now() + 60_000)))

			const rows = db.select().from(schema.sessions).all()
			expect(rows).toHaveLength(1)
			// biome-ignore lint/style/noNonNullAssertion: guarded by toHaveLength(1)
			const row = rows[0]!
			expect(row.romPath).toBe('/roms/metroid.sfc')
			expect(row.endedAt).not.toBeNull()
			expect(row.durationSeconds).toBeGreaterThanOrEqual(59)
		})

		it('does not open a session on screensaver:stop when no demo was running', async () => {
			// video screensaver (no rungame) → wakeup → nothing should happen
			await scrobblerOnScreensaverStop(manager, null)

			const rows = db.select().from(schema.sessions).all()
			expect(rows).toHaveLength(0)
		})

		it('does not open a duplicate session on screensaver:stop when game was launched normally', async () => {
			// normal game already running (fromScreensaver absent) → wakeup → no new session
			const normalGame = startEvent('/roms/mario.sfc', new Date(Date.now() - 60_000))
			await scrobblerOnStart(manager, normalGame)
			expect(db.select().from(schema.sessions).all()).toHaveLength(1)

			await scrobblerOnScreensaverStop(manager, normalGame)

			// still only one session
			expect(db.select().from(schema.sessions).all()).toHaveLength(1)
		})

		it('still records a normal session when fromScreensaver is false', async () => {
			const event = startEvent('/roms/mario.sfc', new Date(Date.now() - 60_000), {
				fromScreensaver: false,
			})
			await scrobblerOnStart(manager, event)

			const rows = db.select().from(schema.sessions).all()
			expect(rows).toHaveLength(1)
		})

		it('still records a normal session when fromScreensaver is absent', async () => {
			const event = startEvent('/roms/mario.sfc', new Date(Date.now() - 60_000))
			await scrobblerOnStart(manager, event)

			const rows = db.select().from(schema.sessions).all()
			expect(rows).toHaveLength(1)
		})
	})

	it('crash recovery: after restart, recoverOrphanSessions handles all orphans', async () => {
		const orphanStart = new Date(Date.now() - 20 * 3600 * 1000)
		await manager.openSession(startEvent('/roms/orphan.sfc', orphanStart), 'rb1')

		// simulate daemon restart by creating a new manager with same db
		const newManager = new SessionManager(db)
		const recovered = await newManager.recoverOrphanSessions(12)
		expect(recovered).toBe(1)

		const rows = db.select().from(schema.sessions).all()
		expect(rows[0]?.endedAt).not.toBeNull()
		expect(rows[0]?.closedReason).toBe('orphan_recovery')
	})
})
