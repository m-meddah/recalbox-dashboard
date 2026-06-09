// apps/dashboard/lib/igdb/__tests__/auth-encryption.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { db, sqlite } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE igdb_credentials (
			id INTEGER PRIMARY KEY DEFAULT 1,
			client_id TEXT,
			client_secret TEXT,
			access_token TEXT,
			access_token_expires_at INTEGER,
			enabled INTEGER NOT NULL DEFAULT 0,
			last_tested_at INTEGER,
			last_test_status TEXT,
			updated_at INTEGER NOT NULL DEFAULT 0
		);
	`)
	return { db: drizzle(sqlite), sqlite }
})

vi.mock('@/lib/db', () => ({ db }))

beforeAll(() => {
	process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-chars-long-aaaa'
})
afterAll(() => {
	// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
	delete process.env.BETTER_AUTH_SECRET
	sqlite.close()
})
beforeEach(() => {
	sqlite.exec('DELETE FROM igdb_credentials')
})
afterEach(() => {
	vi.unstubAllGlobals()
})

describe('igdb auth encryption', () => {
	it('returns the decrypted access token for valid encrypted creds', async () => {
		const { encryptSecret } = await import('@/lib/crypto/credentials')
		const future = Date.now() + 60 * 60 * 1000
		sqlite
			.prepare(
				'INSERT INTO igdb_credentials (id, client_id, client_secret, access_token, access_token_expires_at, enabled) VALUES (1,?,?,?,?,1)',
			)
			.run('cid', encryptSecret('csecret'), encryptSecret('atoken'), future)

		const { getAccessToken } = await import('../auth')
		const res = await getAccessToken()
		expect(res).toEqual({ ok: true, token: 'atoken', clientId: 'cid' })
	})

	it('stores a refreshed access token encrypted', async () => {
		sqlite
			.prepare(
				'INSERT INTO igdb_credentials (id, client_id, client_secret, enabled) VALUES (1,?,?,1)',
			)
			.run('cid', 'plain-secret')

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }),
		})
		vi.stubGlobal('fetch', fetchMock)

		const { getAccessToken } = await import('../auth')
		const res = await getAccessToken()
		expect(res.ok).toBe(true)

		const raw = sqlite.prepare('SELECT access_token FROM igdb_credentials WHERE id = 1').get() as {
			access_token: string
		}
		expect(raw.access_token.startsWith('enc:v1:')).toBe(true)
		expect(raw.access_token).not.toContain('fresh-token')
	})

	it('stores clientSecret encrypted via saveAndTestCredentials', async () => {
		sqlite.prepare('INSERT INTO igdb_credentials (id) VALUES (1)').run()

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ access_token: 'tok', expires_in: 3600 }),
		})
		vi.stubGlobal('fetch', fetchMock)

		const { saveAndTestCredentials } = await import('../auth')
		const res = await saveAndTestCredentials('my-client-id', 'my-secret')
		expect(res.ok).toBe(true)

		const raw = sqlite.prepare('SELECT client_secret FROM igdb_credentials WHERE id = 1').get() as {
			client_secret: string
		}
		expect(raw.client_secret.startsWith('enc:v1:')).toBe(true)
		expect(raw.client_secret).not.toContain('my-secret')
	})
})
