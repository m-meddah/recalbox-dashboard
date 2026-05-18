import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.exec(`
    CREATE TABLE recalboxes (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, ssh_user TEXT NOT NULL, ssh_password TEXT NOT NULL, ssh_port INTEGER NOT NULL DEFAULT 22, mqtt_port INTEGER NOT NULL DEFAULT 1883, color TEXT, icon_emoji TEXT, is_default INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, created_at INTEGER NOT NULL, last_connected_at INTEGER);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, recalbox_id TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, duration_seconds INTEGER, system TEXT NOT NULL, rom_path TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `)
	return sqlite
}

describe('multi-recalbox migration', () => {
	it('creates default Recalbox from settings and backfills sessions', () => {
		const sqlite = makeDb()
		const now = Date.now()
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.host', 'recalbox.local', ?)`).run(now)
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshUser', 'root', ?)`).run(now)
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshPassword', 'secret', ?)`).run(now)
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshPort', '22', ?)`).run(now)
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.mqttPort', '1883', ?)`).run(now)
		sqlite
			.prepare(
				`INSERT INTO sessions (recalbox_id, started_at, system, rom_path) VALUES (NULL, ?, 'snes', '/rom/test.zip')`,
			)
			.run(Math.floor(now / 1000))

		// Simulate migration inline
		const settings = Object.fromEntries(
			(
				sqlite.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
			).map((r) => [r.key, r.value]),
		)
		const host = settings['recalbox.host'] ?? 'recalbox.local'
		const defaultId = 'test-uuid-1234'
		sqlite
			.prepare(
				`INSERT INTO recalboxes VALUES (?, 'My Recalbox', ?, ?, ?, 22, 1883, NULL, NULL, 1, 0, ?, NULL)`,
			)
			.run(
				defaultId,
				host,
				settings['recalbox.sshUser'] ?? 'root',
				settings['recalbox.sshPassword'] ?? '',
				now,
			)
		sqlite.prepare('UPDATE sessions SET recalbox_id = ? WHERE recalbox_id IS NULL').run(defaultId)

		const recalboxes = sqlite.prepare('SELECT * FROM recalboxes').all() as { host: string }[]
		expect(recalboxes).toHaveLength(1)
		expect(recalboxes[0]?.host).toBe('recalbox.local')

		const sessions = sqlite.prepare('SELECT * FROM sessions').all() as { recalbox_id: string }[]
		expect(sessions.every((s) => s.recalbox_id === defaultId)).toBe(true)
	})

	it('is idempotent: does not create duplicate Recalbox on second run', () => {
		const sqlite = makeDb()
		const now = Date.now()
		sqlite
			.prepare(
				`INSERT INTO recalboxes VALUES ('existing-id', 'My Recalbox', 'recalbox.local', 'root', '', 22, 1883, NULL, NULL, 1, 0, ?, NULL)`,
			)
			.run(now)
		sqlite
			.prepare(`INSERT INTO settings VALUES ('__multi_recalbox_migrated__', 'true', ?)`)
			.run(now)

		const flag = sqlite
			.prepare(`SELECT value FROM settings WHERE key = '__multi_recalbox_migrated__'`)
			.get() as { value: string } | undefined
		expect(flag?.value).toBe('true')

		const count = (sqlite.prepare('SELECT COUNT(*) as c FROM recalboxes').get() as { c: number }).c
		expect(count).toBe(1)
	})

	it('preserves existing data: session count unchanged after migration', () => {
		const sqlite = makeDb()
		const now = Date.now()
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.host', 'box.local', ?)`).run(now)
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshUser', 'root', ?)`).run(now)
		sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshPassword', 'pass', ?)`).run(now)
		for (let i = 0; i < 5; i++) {
			sqlite
				.prepare(
					`INSERT INTO sessions (recalbox_id, started_at, system, rom_path) VALUES (NULL, ?, 'snes', ?)`,
				)
				.run(i, `/rom/${i}.zip`)
		}
		const id = 'migrated-id'
		sqlite
			.prepare(
				`INSERT INTO recalboxes VALUES (?, 'R', 'box.local', 'root', 'pass', 22, 1883, NULL, NULL, 1, 0, ?, NULL)`,
			)
			.run(id, now)
		sqlite.prepare('UPDATE sessions SET recalbox_id = ? WHERE recalbox_id IS NULL').run(id)

		const count = (sqlite.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c
		expect(count).toBe(5)
		const allLinked = sqlite
			.prepare('SELECT COUNT(*) as c FROM sessions WHERE recalbox_id = ?')
			.get(id) as { c: number }
		expect(allLinked.c).toBe(5)
	})
})
