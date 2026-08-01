import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import * as authSchema from '../auth-schema'
import { buildRateLimitConfig } from '../rate-limit'

/**
 * Integration guard for the `storage: 'database'` switch. A model-name or column
 * mismatch between auth-schema.ts and Better Auth would not throw at import time —
 * it would surface as rate limiting silently never engaging in production. So this
 * drives the real limiter against a real adapter and demands an actual 429.
 */
function createAuth() {
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE user (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
			email_verified INTEGER DEFAULT 0 NOT NULL, image TEXT,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
			role TEXT, banned INTEGER DEFAULT 0, ban_reason TEXT, ban_expires INTEGER
		);
		CREATE TABLE session (
			id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
			ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL, impersonated_by TEXT
		);
		CREATE TABLE account (
			id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
			user_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT,
			access_token_expires_at INTEGER, refresh_token_expires_at INTEGER,
			scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
		);
		CREATE TABLE verification (
			id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
			expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
		);
		CREATE TABLE rate_limit (
			id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE,
			count INTEGER NOT NULL, last_request INTEGER NOT NULL
		);
	`)
	const db = drizzle(sqlite, { schema: authSchema })
	const auth = betterAuth({
		database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
		baseURL: 'http://localhost:3000',
		secret: 'not-a-real-better-auth-secret-for-tests',
		emailAndPassword: { enabled: true, disableSignUp: true },
		rateLimit: buildRateLimitConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
	})
	return { auth, sqlite }
}

function signInRequest() {
	return new Request('http://localhost:3000/api/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
		body: JSON.stringify({ email: 'victim@example.com', password: 'not-a-real-password-guess' }),
	})
}

describe('rate limiting backed by the database', () => {
	const { auth, sqlite } = createAuth()
	const statuses: number[] = []

	beforeAll(async () => {
		// The strict rule allows 5 per minute; the 6th must be refused.
		for (let i = 0; i < 6; i++) {
			statuses.push((await auth.handler(signInRequest())).status)
		}
	})

	it('refuses the 6th sign-in attempt in the window', () => {
		expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true)
		expect(statuses[5]).toBe(429)
	})

	it('persists the counter to the rate_limit table', () => {
		const rows = sqlite.prepare('SELECT key, count FROM rate_limit').all() as {
			key: string
			count: number
		}[]

		// Proof the DB backend is really wired: a memory store would leave this empty.
		expect(rows.length).toBeGreaterThan(0)
		const signIn = rows.find((r) => r.key.includes('/sign-in/email'))
		expect(signIn?.count).toBeGreaterThanOrEqual(5)
	})
})
