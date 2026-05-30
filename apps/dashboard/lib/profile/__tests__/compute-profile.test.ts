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

const { computeUserProfile } = await import('../compute-profile')
const { getUserProfile } = await import('../get-profile')

const NOW = new Date()
const MS_PER_DAY = 24 * 60 * 60 * 1000

async function seedGame(
	gameId: number,
	attrs: { system?: string; genre?: string; developer?: string; releaseDate?: Date },
) {
	await testDb
		.insert(schema.games)
		.values({
			id: gameId,
			name: `game-${gameId}`,
			system: attrs.system ?? 'snes',
			romPath: `/roms/game-${gameId}.sfc`,
			genre: attrs.genre ?? null,
			developer: attrs.developer ?? null,
			releaseDate: attrs.releaseDate ?? null,
			updatedAt: NOW,
		})
		.onConflictDoNothing()
}

async function insertSession(gameId: number, opts: { daysAgo: number; classification: string }) {
	const startedAt = new Date(NOW.getTime() - opts.daysAgo * MS_PER_DAY)
	await testDb.insert(schema.sessions).values({
		gameId,
		startedAt,
		endedAt: startedAt,
		durationSeconds: 3600,
		system: 'snes',
		romPath: `/roms/game-${gameId}.sfc`,
		source: 'scrobbler' as const,
		durationConfidence: 'measured' as const,
		classification: opts.classification as 'noise' | 'bounce' | 'taste' | 'meaningful' | 'marathon',
	})
}

async function insertRating(gameId: number, rating: 'love' | 'like' | 'dislike' | 'unknown') {
	await testDb
		.insert(schema.gameRatings)
		.values({ gameId, rating, source: 'post_session' as const })
		.onConflictDoNothing()
}

async function insertInherited(gameId: number, playCount: number, daysAgo = 0) {
	const lastPlayedAt = new Date(NOW.getTime() - daysAgo * MS_PER_DAY)
	await testDb
		.insert(schema.gameInheritedStats)
		.values({ gameId, playCount, lastPlayedAt })
		.onConflictDoNothing()
}

describe('computeUserProfile', () => {
	beforeEach(async () => {
		await testDb.delete(schema.sessions)
		await testDb.delete(schema.gameRatings)
		await testDb.delete(schema.gameInheritedStats)
		await testDb.delete(schema.games)
		await testDb.delete(schema.userProfile)
		await testDb.insert(schema.userProfile).values({ id: 1 }).onConflictDoNothing()
	})

	afterAll(() => sqlite.close())

	it('builds empty profile with no sessions', async () => {
		await computeUserProfile()
		const p = await getUserProfile()
		expect(p.systemsWeights).toHaveLength(0)
		expect(p.profileMaturity).toBe(0)
	})

	it('weights recent sessions more than old ones', async () => {
		await seedGame(1, { system: 'snes' })
		await seedGame(2, { system: 'snes' })
		await seedGame(3, { system: 'nes' })

		await insertSession(1, { daysAgo: 0, classification: 'meaningful' })
		await insertSession(2, { daysAgo: 365, classification: 'meaningful' })
		await insertSession(3, { daysAgo: 0, classification: 'meaningful' })

		await computeUserProfile()
		const p = await getUserProfile()

		const snes = p.systemsWeights.find((s) => s.key === 'snes')?.weight ?? 0
		const nes = p.systemsWeights.find((s) => s.key === 'nes')?.weight ?? 0

		expect(snes).toBeGreaterThan(nes)
	})

	it('marathon weights 2x meaningful (same system)', async () => {
		await seedGame(1, { system: 'snes' })
		await seedGame(2, { system: 'nes' })
		await insertSession(1, { daysAgo: 0, classification: 'marathon' })
		await insertSession(2, { daysAgo: 0, classification: 'meaningful' })

		await computeUserProfile()
		const p = await getUserProfile()

		const snesRaw = p.systemsWeights.find((s) => s.key === 'snes')?.rawScore ?? 0
		const nesRaw = p.systemsWeights.find((s) => s.key === 'nes')?.rawScore ?? 0

		expect(snesRaw).toBeCloseTo(nesRaw * 2, 1)
	})

	it('bounces produce negative contribution (genre filtered out)', async () => {
		await seedGame(1, { genre: 'RPG' })
		await seedGame(2, { genre: 'Platformer' })

		for (let i = 0; i < 5; i++) {
			await insertSession(1, { daysAgo: i, classification: 'bounce' })
		}
		await insertSession(2, { daysAgo: 0, classification: 'meaningful' })

		await computeUserProfile()
		const p = await getUserProfile()

		const platformer = p.genresWeights.find((g) => g.key === 'Platformer')?.weight ?? 0
		const rpg = p.genresWeights.find((g) => g.key === 'RPG')?.weight ?? 0

		expect(platformer).toBeGreaterThan(0)
		expect(rpg).toBe(0)
	})

	it('love rating amplifies contribution 2x', async () => {
		await seedGame(1, { system: 'snes' })
		await seedGame(2, { system: 'nes' })
		await insertSession(1, { daysAgo: 0, classification: 'meaningful' })
		await insertSession(2, { daysAgo: 0, classification: 'meaningful' })
		await insertRating(1, 'love')

		await computeUserProfile()
		const p = await getUserProfile()

		const snesRaw = p.systemsWeights.find((s) => s.key === 'snes')?.rawScore ?? 0
		const nesRaw = p.systemsWeights.find((s) => s.key === 'nes')?.rawScore ?? 0

		expect(snesRaw).toBeCloseTo(nesRaw * 2, 1)
	})

	it('identifies comfort games', async () => {
		await seedGame(10, { system: 'snes' })
		await seedGame(11, { system: 'snes' })

		await insertSession(10, { daysAgo: 0, classification: 'marathon' })
		await insertSession(10, { daysAgo: 7, classification: 'marathon' })
		await insertSession(10, { daysAgo: 14, classification: 'meaningful' })
		await insertSession(11, { daysAgo: 0, classification: 'bounce' })

		await computeUserProfile()
		const p = await getUserProfile()

		expect(p.comfortGames[0]).toBe(10)
		expect(p.comfortGames).not.toContain(11)
	})

	it('identifies bouncer games', async () => {
		await seedGame(20, { system: 'snes' })
		for (let i = 0; i < 4; i++) {
			await insertSession(20, { daysAgo: i, classification: 'bounce' })
		}

		await computeUserProfile()
		const p = await getUserProfile()

		expect(p.bouncerGames).toContain(20)
	})

	it('does NOT mark mixed game (bounce + meaningful) as bouncer', async () => {
		await seedGame(30, { system: 'snes' })
		await insertSession(30, { daysAgo: 0, classification: 'bounce' })
		await insertSession(30, { daysAgo: 1, classification: 'meaningful' })
		await insertSession(30, { daysAgo: 2, classification: 'meaningful' })

		await computeUserProfile()
		const p = await getUserProfile()

		expect(p.bouncerGames).not.toContain(30)
	})

	it('inherited data contributes with 70% penalty', async () => {
		await seedGame(40, { system: 'snes' })
		await seedGame(41, { system: 'nes' })

		await insertSession(40, { daysAgo: 0, classification: 'marathon' })
		await insertInherited(41, 10, 0)

		await computeUserProfile()
		const p = await getUserProfile()

		const snesRaw = p.systemsWeights.find((s) => s.key === 'snes')?.rawScore ?? 0
		const nesRaw = p.systemsWeights.find((s) => s.key === 'nes')?.rawScore ?? 0

		// marathon classification_weight=2.0 scrobbler vs marathon classification_weight=2.0 × 0.7 inherited
		expect(nesRaw).toBeCloseTo(snesRaw * 0.7, 1)
	})
})
