import { int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
	id: int('id').primaryKey({ autoIncrement: true }),
	gameId: int('game_id').notNull(),
	startedAt: int('started_at', { mode: 'timestamp' }).notNull(),
	endedAt: int('ended_at', { mode: 'timestamp' }),
	durationSeconds: int('duration_seconds'),
	system: text('system').notNull(),
	romPath: text('rom_path').notNull(),
})

export const games = sqliteTable('games', {
	id: int('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	system: text('system').notNull(),
	romPath: text('rom_path').notNull().unique(),
	screenshotPath: text('screenshot_path'),
	imagePath: text('image_path'),
	videoPath: text('video_path'),
	thumbnailPath: text('thumbnail_path'),
	rating: real('rating'),
	players: text('players'),
	releaseDate: int('release_date', { mode: 'timestamp' }),
	developer: text('developer'),
	publisher: text('publisher'),
	genre: text('genre'),
	description: text('description'),
	hash: text('hash'),
	region: text('region'),
	favorite: int('favorite', { mode: 'boolean' }).notNull().default(false),
	hidden: int('hidden', { mode: 'boolean' }).notNull().default(false),
	playCount: int('play_count').default(0),
	lastPlayed: int('last_played', { mode: 'timestamp' }),
	diskSource: text('disk_source'),
	syncedAt: int('synced_at', { mode: 'timestamp' }),
	scrapeStatus: text('scrape_status', { enum: ['pending', 'done', 'failed'] })
		.notNull()
		.default('pending'),
	updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
})

export const systemSnapshots = sqliteTable('system_snapshots', {
	id: int('id').primaryKey({ autoIncrement: true }),
	capturedAt: int('captured_at', { mode: 'timestamp' }).notNull(),
	cpuPercent: real('cpu_percent'),
	memUsedMb: real('mem_used_mb'),
	memTotalMb: real('mem_total_mb'),
	tempCelsius: real('temp_celsius'),
	uptimeSeconds: int('uptime_seconds'),
})
