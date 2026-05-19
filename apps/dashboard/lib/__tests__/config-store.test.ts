import path from 'node:path'
import * as schema from '@/lib/db/schema'
import { PASSWORD_MASK, SETUP_COMPLETED_KEY, maskedConfig } from '@/lib/settings/schemas'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../drizzle/migrations')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return { sqlite, db }
}

// We need to mock the db module so ConfigStore uses our in-memory db
// and the defaults module so we control env vars.

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('maskedConfig', () => {
	it('replaces sshPassword with ***', () => {
		const cfg = {
			recalbox: {
				host: 'box.local',
				sshUser: 'root',
				sshPassword: 'secret',
				sshPort: 22,
				mqttPort: 1883,
			},
			scrobble: { minDurationSec: 10, maxDurationHours: 1, orphanRecoveryHours: 12 },
			ui: { locale: 'en', theme: 'system' as const, weekStartsOn: 1 as const },
			retroachievements: {
				enabled: false,
				username: '',
				apiKey: 'secret-key',
				autoSyncMinutes: 60,
			},
			superRetrogamers: {
				enabled: false,
				apiUrl: '',
				preferredRegion: '',
			},
			mqttPublish: {
				enabled: false,
				brokerUrl: '',
				topicPrefix: 'RecalboxDashboard/',
				homeAssistantDiscovery: false,
			},
		}
		const masked = maskedConfig(cfg)
		expect(masked.recalbox.sshPassword).toBe(PASSWORD_MASK)
		expect(masked.recalbox.host).toBe('box.local')
		expect(masked.scrobble.minDurationSec).toBe(10)
	})

	it('does not mutate the original config', () => {
		const cfg = {
			recalbox: {
				host: 'box.local',
				sshUser: 'root',
				sshPassword: 'secret',
				sshPort: 22,
				mqttPort: 1883,
			},
			scrobble: { minDurationSec: 10, maxDurationHours: 1, orphanRecoveryHours: 12 },
			ui: { locale: 'en', theme: 'system' as const, weekStartsOn: 1 as const },
			retroachievements: {
				enabled: false,
				username: '',
				apiKey: 'secret-key',
				autoSyncMinutes: 60,
			},
			superRetrogamers: {
				enabled: false,
				apiUrl: '',
				preferredRegion: '',
			},
			mqttPublish: {
				enabled: false,
				brokerUrl: '',
				topicPrefix: 'RecalboxDashboard/',
				homeAssistantDiscovery: false,
			},
		}
		maskedConfig(cfg)
		expect(cfg.recalbox.sshPassword).toBe('secret')
	})
})

describe('DB queries: settings', () => {
	let db: ReturnType<typeof makeDb>['db']
	let sqlite: ReturnType<typeof makeDb>['sqlite']

	beforeEach(() => {
		const made = makeDb()
		db = made.db
		sqlite = made.sqlite
	})

	afterEach(() => {
		sqlite.close()
	})

	it('getAllSettings returns empty object on fresh DB', () => {
		const rows = db.select().from(schema.settings).all()
		expect(rows).toHaveLength(0)
	})

	it('upsert + get returns correct value', () => {
		db.insert(schema.settings)
			.values({ key: 'recalbox.host', value: 'mybox.local', updatedAt: new Date() })
			.onConflictDoUpdate({
				target: schema.settings.key,
				set: { value: 'mybox.local', updatedAt: new Date() },
			})
			.run()
		const row = db
			.select()
			.from(schema.settings)
			.all()
			.find((r) => r.key === 'recalbox.host')
		expect(row?.value).toBe('mybox.local')
	})

	it('upsert overwrites existing value', () => {
		const insert = (value: string) =>
			db
				.insert(schema.settings)
				.values({ key: 'recalbox.host', value, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: schema.settings.key,
					set: { value, updatedAt: new Date() },
				})
				.run()

		insert('first.local')
		insert('second.local')

		const rows = db.select().from(schema.settings).all()
		const row = rows.find((r) => r.key === 'recalbox.host')
		expect(row?.value).toBe('second.local')
		expect(rows.filter((r) => r.key === 'recalbox.host')).toHaveLength(1)
	})

	it('setup_completed key is stored and retrieved', () => {
		db.insert(schema.settings)
			.values({ key: SETUP_COMPLETED_KEY, value: 'true', updatedAt: new Date() })
			.onConflictDoUpdate({
				target: schema.settings.key,
				set: { value: 'true', updatedAt: new Date() },
			})
			.run()
		const row = db
			.select()
			.from(schema.settings)
			.all()
			.find((r) => r.key === SETUP_COMPLETED_KEY)
		expect(row?.value).toBe('true')
	})
})

describe('SETUP_COMPLETED_KEY constant', () => {
	it('has expected value', () => {
		expect(SETUP_COMPLETED_KEY).toBe('__setup_completed__')
	})
})

describe('PASSWORD_MASK constant', () => {
	it('has expected value', () => {
		expect(PASSWORD_MASK).toBe('***')
	})
})
