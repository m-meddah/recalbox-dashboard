// apps/dashboard/lib/db/__tests__/recalbox-queries-encryption.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { db, sqlite } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE recalboxes (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			host TEXT NOT NULL,
			ssh_user TEXT NOT NULL,
			ssh_password TEXT NOT NULL,
			ssh_port INTEGER NOT NULL DEFAULT 22,
			mqtt_port INTEGER NOT NULL DEFAULT 1883,
			color TEXT,
			icon_emoji TEXT,
			is_default INTEGER DEFAULT 0,
			archived INTEGER DEFAULT 0,
			created_at INTEGER NOT NULL,
			last_connected_at INTEGER,
			owner_user_id TEXT
		);
	`)
	return { db: drizzle(sqlite), sqlite }
})

vi.mock('@/lib/db/index', () => ({ db }))

beforeAll(() => {
	process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-chars-long-aaaa'
})
afterAll(() => {
	// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
	delete process.env.BETTER_AUTH_SECRET
	sqlite.close()
})
beforeEach(() => {
	sqlite.exec('DELETE FROM recalboxes')
})

describe('recalbox-queries encryption', () => {
	it('stores ssh_password encrypted but reads it back decrypted', async () => {
		const { insertRecalbox, getRecalbox } = await import('../recalbox-queries')
		insertRecalbox({
			id: 'r1',
			name: 'Box',
			host: '10.0.0.1',
			sshUser: 'root',
			sshPassword: 'recalboxroot',
			sshPort: 22,
			mqttPort: 1883,
			color: null,
			iconEmoji: null,
			isDefault: true,
			archived: false,
			createdAt: new Date(),
			ownerUserId: null,
		})

		const rawRow = sqlite.prepare('SELECT ssh_password FROM recalboxes WHERE id = ?').get('r1') as {
			ssh_password: string
		}
		expect(rawRow.ssh_password.startsWith('enc:v1:')).toBe(true)
		expect(rawRow.ssh_password).not.toContain('recalboxroot')

		const read = getRecalbox('r1')
		expect(read?.sshPassword).toBe('recalboxroot')
	})

	it('re-encrypts on updateRecalbox and decrypts on read', async () => {
		const { insertRecalbox, updateRecalbox, getRecalbox } = await import('../recalbox-queries')
		insertRecalbox({
			id: 'r2',
			name: 'Box2',
			host: '10.0.0.2',
			sshUser: 'root',
			sshPassword: 'old',
			sshPort: 22,
			mqttPort: 1883,
			color: null,
			iconEmoji: null,
			isDefault: false,
			archived: false,
			createdAt: new Date(),
			ownerUserId: null,
		})
		updateRecalbox('r2', { sshPassword: 'newpass' })

		const rawRow = sqlite.prepare('SELECT ssh_password FROM recalboxes WHERE id = ?').get('r2') as {
			ssh_password: string
		}
		expect(rawRow.ssh_password.startsWith('enc:v1:')).toBe(true)
		expect(getRecalbox('r2')?.sshPassword).toBe('newpass')
	})

	it('listRecalboxes decrypts every row', async () => {
		const { insertRecalbox, listRecalboxes } = await import('../recalbox-queries')
		insertRecalbox({
			id: 'r3',
			name: 'Box3',
			host: '10.0.0.3',
			sshUser: 'root',
			sshPassword: 'p3',
			sshPort: 22,
			mqttPort: 1883,
			color: null,
			iconEmoji: null,
			isDefault: false,
			archived: false,
			createdAt: new Date(),
			ownerUserId: null,
		})
		expect(listRecalboxes().map((r) => r.sshPassword)).toEqual(['p3'])
	})

	it('reads legacy plaintext rows unchanged', async () => {
		const { getRecalbox } = await import('../recalbox-queries')
		sqlite
			.prepare(
				'INSERT INTO recalboxes (id, name, host, ssh_user, ssh_password, created_at) VALUES (?,?,?,?,?,?)',
			)
			.run('r4', 'Legacy', '10.0.0.4', 'root', 'plain-legacy', Date.now())
		expect(getRecalbox('r4')?.sshPassword).toBe('plain-legacy')
	})
})
