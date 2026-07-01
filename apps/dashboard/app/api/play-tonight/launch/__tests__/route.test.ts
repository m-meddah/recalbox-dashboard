import path from 'node:path'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, describe, expect, it, vi } from 'vitest'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db
}

const testDb = makeDb()

vi.mock('@/lib/db', () => ({ db: testDb }))

const getUser = vi.fn()
vi.mock('@/lib/auth/require-user', () => ({
	getUser: () => getUser(),
	unauthorized: () => new Response(null, { status: 401 }),
}))

const canControlRecalbox = vi.fn()
vi.mock('@/lib/auth/ownership', () => ({
	canControlRecalbox: (...a: unknown[]) => canControlRecalbox(...a),
}))

const getActiveRecalboxId = vi.fn()
vi.mock('@/lib/recalbox/active', () => ({
	getActiveRecalboxId: () => getActiveRecalboxId(),
}))

const getEsState = vi.fn()
vi.mock('@/lib/recalbox/es-state', () => ({
	getEsState: (...a: unknown[]) => getEsState(...a),
}))

const launchGame = vi.fn()
vi.mock('@/lib/recalbox/launch-game', () => ({
	launchGame: (...a: unknown[]) => launchGame(...a),
}))

const prefetchArtwork = vi.fn()
vi.mock('@/lib/recommendations/artwork-prefetch', () => ({
	prefetchArtwork: (...a: unknown[]) => prefetchArtwork(...a),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

const { POST } = await import('../route')

function req(body: unknown) {
	return { json: async () => body } as never
}

let gameIdCounter = 1

async function seedGame(attrs: { imagePath?: string | null; videoPath?: string | null }) {
	const id = gameIdCounter++
	await testDb.insert(schema.games).values({
		id,
		name: `game-${id}`,
		system: 'megadrive',
		romPath: `/roms/game-${id}.zip`,
		imagePath: attrs.imagePath ?? null,
		videoPath: attrs.videoPath ?? null,
		updatedAt: new Date(),
	})
	return id
}

afterEach(() => {
	getUser.mockReset()
	canControlRecalbox.mockReset()
	getActiveRecalboxId.mockReset()
	getEsState.mockReset()
	launchGame.mockReset()
	prefetchArtwork.mockReset()
})

describe('POST /api/play-tonight/launch', () => {
	it('prefetches the launched game artwork', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'admin' })
		canControlRecalbox.mockReturnValue(true)
		getActiveRecalboxId.mockResolvedValue('rb1')
		getEsState.mockResolvedValue(null)
		launchGame.mockResolvedValue(undefined)

		const gameId = await seedGame({
			imagePath: '/recalbox/share/roms/megadrive/images/sonic.png',
			videoPath: '/recalbox/share/roms/megadrive/videos/sonic.mp4',
		})

		const res = await POST(req({ gameId }))

		expect(res.status).toBe(200)
		expect(prefetchArtwork).toHaveBeenCalledWith('rb1', [
			expect.objectContaining({
				imageUrl: '/recalbox/share/roms/megadrive/images/sonic.png',
				videoUrl: '/recalbox/share/roms/megadrive/videos/sonic.mp4',
			}),
		])
	})

	it('still prefetches when the box is busy (no launch)', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'admin' })
		canControlRecalbox.mockReturnValue(true)
		getActiveRecalboxId.mockResolvedValue('rb1')
		getEsState.mockResolvedValue({ gameRunning: true, gameName: 'Other Game' })

		const gameId = await seedGame({ imagePath: '/recalbox/share/img.png', videoPath: null })

		const res = await POST(req({ gameId }))
		const body = await res.json()

		expect(body.busy).toBe(true)
		expect(launchGame).not.toHaveBeenCalled()
		expect(prefetchArtwork).toHaveBeenCalledWith('rb1', [
			expect.objectContaining({ imageUrl: '/recalbox/share/img.png', videoUrl: null }),
		])
	})

	it('does not prefetch when the user cannot control the box', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'member' })
		canControlRecalbox.mockReturnValue(false)
		getActiveRecalboxId.mockResolvedValue('rb1')

		const gameId = await seedGame({ imagePath: '/recalbox/share/img.png', videoPath: null })

		await POST(req({ gameId }))

		expect(prefetchArtwork).not.toHaveBeenCalled()
	})
})
