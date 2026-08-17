import { describe, expect, it, vi } from 'vitest'

// A recap cached at a moment when the cover had not been mirrored yet: imagePath is known,
// imageUrl is null. The agent uploaded the file shortly after, so the artwork row now has
// a URL — the cached recap must pick it up instead of showing a broken image for 24h.
const { db } = vi.hoisted(() => {
	const Database = require('better-sqlite3')
	const { drizzle } = require('drizzle-orm/better-sqlite3')
	const sqlite = new Database(':memory:')
	sqlite.exec(`
		CREATE TABLE wrapped_cache (
			year INTEGER NOT NULL, locale TEXT NOT NULL, scope TEXT NOT NULL,
			data TEXT NOT NULL, generated_at INTEGER NOT NULL,
			PRIMARY KEY (year, locale, scope)
		);
		CREATE TABLE artwork (
			recalbox_id TEXT NOT NULL, box_path TEXT NOT NULL, url TEXT,
			content_type TEXT, wanted_at INTEGER, uploaded_at INTEGER,
			PRIMARY KEY (recalbox_id, box_path)
		);
	`)

	const COVER = '/recalbox/share/roms/gamecube/media/images/wind-waker.png'

	const cached = {
		year: 2025,
		generatedAt: new Date('2025-12-31T10:00:00Z').toISOString(),
		user: { pseudo: 'me' },
		unlocks: [],
		slides: [
			{ type: 'intro' },
			{
				type: 'total-time',
				totalHours: 1,
				totalMinutes: 41,
				totalSessions: 3,
				comparisonMovies: 1,
			},
			{
				type: 'most-played-game',
				gameName: 'The Wind Waker',
				system: 'gamecube',
				playtimeHours: 1,
				playtimeMinutes: 41,
				sessionCount: 3,
				imagePath: COVER,
				imageUrl: null, // the miss that used to be frozen for a day
			},
		],
	}

	sqlite
		.prepare(
			'INSERT INTO wrapped_cache (year, locale, scope, data, generated_at) VALUES (?, ?, ?, ?, ?)',
		)
		.run(2025, 'en', 'box1', JSON.stringify(cached), 1767175200)

	// Same recap under another locale, pointing at a cover nobody has uploaded.
	const neverMirrored = structuredClone(cached)
	const missingSlide = neverMirrored.slides[2] as { imagePath: string }
	missingSlide.imagePath = '/recalbox/share/roms/gamecube/media/images/not-uploaded.png'
	sqlite
		.prepare(
			'INSERT INTO wrapped_cache (year, locale, scope, data, generated_at) VALUES (?, ?, ?, ?, ?)',
		)
		.run(2025, 'fr', 'box1', JSON.stringify(neverMirrored), 1767175200)

	// The upload that landed after the recap was cached.
	sqlite
		.prepare('INSERT INTO artwork (recalbox_id, box_path, url, uploaded_at) VALUES (?, ?, ?, ?)')
		.run('box1', COVER, 'https://blob.example.test/wind-waker.png', 1767175320)

	return { db: drizzle(sqlite) }
})

vi.mock('@/lib/db/index', () => ({ db }))

import { getCachedWrapped } from '@/lib/wrapped/cache'

describe('cached recap artwork healing', () => {
	it('fills in a cover that was uploaded after the recap was cached', async () => {
		const wrapped = await getCachedWrapped(2025, 'en', ['box1'])
		const slide = wrapped?.slides.find((s) => s.type === 'most-played-game')
		expect(slide && 'imageUrl' in slide && slide.imageUrl).toBe(
			'https://blob.example.test/wind-waker.png',
		)
	})

	it('leaves the cover null while the file still is not mirrored', async () => {
		// Same cached recap, but read for a box that has no artwork row for that path: there
		// is nothing to heal with, and it must stay null rather than borrow another box URL.
		const wrapped = await getCachedWrapped(2025, 'fr', ['box1'])
		const slide = wrapped?.slides.find((s) => s.type === 'most-played-game')
		expect(slide && 'imageUrl' in slide && slide.imageUrl).toBeNull()
	})
})
