import path from 'node:path'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db
}

const testDb = makeDb()

vi.mock('@/lib/db', () => ({ db: testDb }))

// Import AFTER the mock is set up
const { getQualityMetrics } = await import('../quality-metrics')

type RecoInsert = Partial<typeof schema.recommendationLog.$inferInsert>
type SessionInsert = Partial<typeof schema.sessions.$inferInsert>

let sessionIdCounter = 1

function seedReco(opts: RecoInsert = {}) {
	return testDb.insert(schema.recommendationLog).values({
		gameId: Math.floor(Math.random() * 1_000_000),
		contextTimeMinutes: 60,
		contextMood: 'surprise',
		score: 100,
		confidence: 'high',
		launched: false,
		skipped: false,
		presentedAt: new Date(),
		...opts,
	} as typeof schema.recommendationLog.$inferInsert)
}

function seedSession(classification: string, overrides: SessionInsert = {}) {
	const id = sessionIdCounter++
	testDb
		.insert(schema.sessions)
		.values({
			id,
			gameId: 1,
			startedAt: new Date(),
			endedAt: new Date(),
			durationSeconds: 3600,
			system: 'snes',
			romPath: '/roms/game.sfc',
			durationConfidence: 'measured',
			source: 'scrobbler',
			classification,
			...overrides,
		} as typeof schema.sessions.$inferInsert)
		.run()
	return id
}

describe('getQualityMetrics', () => {
	beforeAll(() => {
		testDb.delete(schema.recommendationLog).run()
		testDb.delete(schema.sessions).run()
	})

	afterEach(() => {
		testDb.delete(schema.recommendationLog).run()
		testDb.delete(schema.sessions).run()
	})

	it('returns zeros for empty data', async () => {
		const m = await getQualityMetrics()
		expect(m.totalRecommendations).toBe(0)
		expect(m.launchRate).toBe(0)
		expect(m.hitRate).toBe(0)
		expect(m.bounceRate).toBe(0)
	})

	it('computes launch and skip rates', async () => {
		await seedReco({ launched: true })
		await seedReco({ launched: true })
		await seedReco({ skipped: true })
		await seedReco({})

		const m = await getQualityMetrics()
		expect(m.totalRecommendations).toBe(4)
		expect(m.launchRate).toBeCloseTo(0.5)
		expect(m.skipRate).toBeCloseTo(0.25)
		expect(m.totalIgnored).toBe(1)
	})

	it('computes hit and bounce rate from resulting sessions', async () => {
		const s1 = seedSession('marathon')
		const s2 = seedSession('bounce')
		await seedReco({ launched: true, resultingSessionId: s1 })
		await seedReco({ launched: true, resultingSessionId: s2 })

		const m = await getQualityMetrics()
		expect(m.totalLaunched).toBe(2)
		expect(m.hitRate).toBeCloseTo(0.5)
		expect(m.bounceRate).toBeCloseTo(0.5)
	})

	it('counts meaningful sessions as hits', async () => {
		const s1 = seedSession('meaningful')
		await seedReco({ launched: true, resultingSessionId: s1 })
		await seedReco({ launched: true })

		const m = await getQualityMetrics()
		expect(m.hitRate).toBeCloseTo(0.5)
		expect(m.bounceRate).toBe(0)
	})

	it('groups by mood', async () => {
		await seedReco({ contextMood: 'chill', launched: true })
		await seedReco({ contextMood: 'chill', skipped: true })
		await seedReco({ contextMood: 'discovery', launched: true })

		const m = await getQualityMetrics()
		expect(m.byMood.chill?.total).toBe(2)
		expect(m.byMood.chill?.launchRate).toBeCloseTo(0.5)
		expect(m.byMood.discovery?.total).toBe(1)
		expect(m.byMood.discovery?.launchRate).toBe(1)
	})

	it('groups by confidence', async () => {
		await seedReco({ confidence: 'high', launched: true })
		await seedReco({ confidence: 'high', launched: true })
		await seedReco({ confidence: 'exploration', skipped: true })

		const m = await getQualityMetrics()
		expect(m.byConfidence.high.launchRate).toBe(1)
		expect(m.byConfidence.exploration.launchRate).toBe(0)
	})

	it('respects time window', async () => {
		const old = new Date()
		old.setDate(old.getDate() - 40)
		await seedReco({ launched: true, presentedAt: new Date() })
		await seedReco({ launched: true, presentedAt: old })

		const m = await getQualityMetrics(30)
		expect(m.totalRecommendations).toBe(1)
	})
})
