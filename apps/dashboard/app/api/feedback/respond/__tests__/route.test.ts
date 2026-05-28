import path from 'node:path'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../../../drizzle/migrations')

const sqlite = new Database(':memory:')
sqlite.pragma('journal_mode = WAL')
const testDb = drizzle(sqlite, { schema })
migrate(testDb, { migrationsFolder: MIGRATIONS_FOLDER })

vi.mock('@/lib/db/index', () => ({ db: testDb }))

const { POST } = await import('../route')

function makeReq(body: unknown): NextRequest {
	return new NextRequest('http://localhost/api/feedback/respond', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('POST /api/feedback/respond', () => {
	let feedbackId: number

	beforeEach(async () => {
		await testDb.delete(schema.gameRatings)
		await testDb.delete(schema.pendingFeedback)

		const [created] = await testDb
			.insert(schema.pendingFeedback)
			.values({
				sessionId: 1,
				gameId: 1,
				durationSeconds: 3600,
				classification: 'meaningful',
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
			})
			.returning({ id: schema.pendingFeedback.id })

		feedbackId = created?.id ?? 0
	})

	afterAll(() => sqlite.close())

	it('maps "excellent" to "love" rating', async () => {
		const res = await POST(makeReq({ feedbackId, response: 'excellent' }))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.ratingApplied).toBe('love')

		const rating = await testDb
			.select()
			.from(schema.gameRatings)
			.where(eq(schema.gameRatings.gameId, 1))
			.get()
		expect(rating?.rating).toBe('love')
		expect(rating?.source).toBe('post_session')
	})

	it('marks pending feedback as responded', async () => {
		await POST(makeReq({ feedbackId, response: 'good' }))

		const pf = await testDb
			.select()
			.from(schema.pendingFeedback)
			.where(eq(schema.pendingFeedback.id, feedbackId))
			.get()
		expect(pf?.respondedAt).not.toBeNull()
	})

	it('does not create rating for come_back_later', async () => {
		await POST(makeReq({ feedbackId, response: 'come_back_later' }))
		const ratings = await testDb.select().from(schema.gameRatings).all()
		expect(ratings).toHaveLength(0)
	})

	it('does not create rating for dismiss', async () => {
		await POST(makeReq({ feedbackId, response: 'dismiss' }))
		const ratings = await testDb.select().from(schema.gameRatings).all()
		expect(ratings).toHaveLength(0)
	})

	it('updates existing rating on conflict', async () => {
		await testDb.insert(schema.gameRatings).values({
			gameId: 1,
			rating: 'like',
			source: 'manual',
		})

		await POST(makeReq({ feedbackId, response: 'memorable' }))

		const rating = await testDb
			.select()
			.from(schema.gameRatings)
			.where(eq(schema.gameRatings.gameId, 1))
			.get()
		expect(rating?.rating).toBe('love')
		expect(rating?.source).toBe('post_session')
	})

	it('returns 404 for unknown feedbackId', async () => {
		const res = await POST(makeReq({ feedbackId: 99999, response: 'good' }))
		expect(res.status).toBe(404)
	})

	it('returns 400 for invalid response value', async () => {
		const res = await POST(makeReq({ feedbackId, response: 'not_valid' }))
		expect(res.status).toBe(400)
	})

	it('returns 400 for missing fields', async () => {
		const res = await POST(makeReq({}))
		expect(res.status).toBe(400)
	})
})
