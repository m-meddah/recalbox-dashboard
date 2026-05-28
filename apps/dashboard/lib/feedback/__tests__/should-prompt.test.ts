import path from 'node:path'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

const sqlite = new Database(':memory:')
sqlite.pragma('journal_mode = WAL')
const testDb = drizzle(sqlite, { schema })
migrate(testDb, { migrationsFolder: MIGRATIONS_FOLDER })

vi.mock('@/lib/db/index', () => ({ db: testDb }))

const { shouldPromptForFeedback } = await import('../should-prompt')

describe('shouldPromptForFeedback', () => {
	beforeEach(async () => {
		await testDb.delete(schema.gameRatings)
		await testDb.delete(schema.pendingFeedback)
	})

	afterAll(() => sqlite.close())

	it('returns false for noise sessions', async () => {
		expect(await shouldPromptForFeedback({ gameId: 1, classification: 'noise' })).toBe(false)
	})

	it('returns true for bounce/taste/meaningful/marathon by default', async () => {
		for (const classification of ['bounce', 'taste', 'meaningful', 'marathon']) {
			expect(await shouldPromptForFeedback({ gameId: 1, classification })).toBe(true)
		}
	})

	it('returns false if a non-unknown rating exists recently', async () => {
		await testDb.insert(schema.gameRatings).values({
			gameId: 1,
			rating: 'love',
			source: 'manual',
			ratedAt: new Date(),
		})
		expect(await shouldPromptForFeedback({ gameId: 1, classification: 'meaningful' })).toBe(false)
	})

	it('returns true if recent rating is unknown', async () => {
		await testDb.insert(schema.gameRatings).values({
			gameId: 1,
			rating: 'unknown',
			source: 'post_session',
			ratedAt: new Date(),
		})
		expect(await shouldPromptForFeedback({ gameId: 1, classification: 'meaningful' })).toBe(true)
	})

	it('returns false if 5+ unanswered pending feedbacks exist', async () => {
		const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
		for (let i = 0; i < 5; i++) {
			await testDb.insert(schema.pendingFeedback).values({
				sessionId: i + 1000,
				gameId: i + 10,
				durationSeconds: 1800,
				classification: 'meaningful',
				expiresAt: futureExpiry,
			})
		}
		expect(await shouldPromptForFeedback({ gameId: 99, classification: 'meaningful' })).toBe(false)
	})

	it('does not count responded or expired entries towards the limit', async () => {
		const pastExpiry = new Date(Date.now() - 1000)
		const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)

		for (let i = 0; i < 3; i++) {
			await testDb.insert(schema.pendingFeedback).values({
				sessionId: i + 2000,
				gameId: i + 20,
				durationSeconds: 1800,
				classification: 'meaningful',
				expiresAt: pastExpiry,
			})
		}
		for (let i = 0; i < 3; i++) {
			await testDb.insert(schema.pendingFeedback).values({
				sessionId: i + 3000,
				gameId: i + 30,
				durationSeconds: 1800,
				classification: 'meaningful',
				respondedAt: new Date(),
				expiresAt: futureExpiry,
			})
		}

		expect(await shouldPromptForFeedback({ gameId: 99, classification: 'meaningful' })).toBe(true)
	})
})
