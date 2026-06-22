import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	type NowPlayingRow,
	getAllNowPlaying,
	getNowPlaying,
	nowPlayingToEvent,
	upsertNowPlaying,
} from '../now-playing'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

describe('now-playing queries', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('upserts and reads back a playing state', async () => {
		await upsertNowPlaying(db, 'rb1', {
			playing: true,
			system: 'snes',
			systemFullName: 'Super Nintendo',
			romPath: '/x/smw.sfc',
			gameName: 'Super Mario World',
			startedAt: new Date('2026-06-21T20:00:00Z'),
		})
		const row = await getNowPlaying(db, 'rb1')
		expect(row?.playing).toBe(true)
		expect(row?.gameName).toBe('Super Mario World')
		expect(row?.systemFullName).toBe('Super Nintendo')
	})

	it('upsert replaces the single row (start → stop)', async () => {
		await upsertNowPlaying(db, 'rb1', { playing: true, romPath: '/x/smw.sfc' })
		await upsertNowPlaying(db, 'rb1', { playing: false, romPath: '/x/smw.sfc' })
		const all = await getAllNowPlaying(db)
		expect(all).toHaveLength(1)
		expect(all[0]?.playing).toBe(false)
	})

	it('keeps one row per recalbox', async () => {
		await upsertNowPlaying(db, 'rb1', { playing: true })
		await upsertNowPlaying(db, 'rb2', { playing: true })
		expect(await getAllNowPlaying(db)).toHaveLength(2)
	})
})

describe('nowPlayingToEvent', () => {
	const base: NowPlayingRow = {
		recalboxId: 'rb1',
		playing: true,
		system: 'snes',
		systemFullName: 'Super Nintendo',
		romPath: '/x/smw.sfc',
		gameName: 'Super Mario World',
		imagePath: '/x/smw.png',
		emulator: 'libretro',
		fromScreensaver: false,
		startedAt: new Date('2026-06-21T20:00:00Z'),
		updatedAt: new Date('2026-06-21T20:00:05Z'),
	}

	it('maps a playing row to a game:start event', () => {
		const e = nowPlayingToEvent(base)
		expect(e.type).toBe('game:start')
		if (e.type === 'game:start') {
			expect(e.systemFullName).toBe('Super Nintendo')
			expect(e.imagePath).toBe('/x/smw.png')
			expect(e.startedAt).toEqual(new Date('2026-06-21T20:00:00Z'))
		}
	})

	it('maps a stopped row to a game:stop event for the last game', () => {
		const e = nowPlayingToEvent({ ...base, playing: false })
		expect(e.type).toBe('game:stop')
		if (e.type === 'game:stop') {
			expect(e.romPath).toBe('/x/smw.sfc')
		}
	})

	it('falls back to updatedAt when startedAt is missing', () => {
		const e = nowPlayingToEvent({ ...base, startedAt: null })
		if (e.type === 'game:start') {
			expect(e.startedAt).toEqual(new Date('2026-06-21T20:00:05Z'))
		}
	})
})
