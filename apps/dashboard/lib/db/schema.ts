import { index, int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const raCache = sqliteTable('ra_cache', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
})

export const raAchievements = sqliteTable(
	'ra_achievements',
	{
		id: int('id').primaryKey(),
		gameId: int('game_id').notNull(),
		title: text('title').notNull(),
		points: int('points').notNull(),
		imageUrl: text('image_url').notNull(),
		unlockedAt: int('unlocked_at', { mode: 'timestamp' }).notNull(),
		isHardcore: int('is_hardcore', { mode: 'boolean' }).default(false),
		syncedAt: int('synced_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		gameIdIdx: index('idx_ra_achievements_game_id').on(t.gameId),
		unlockedAtIdx: index('idx_ra_achievements_unlocked_at').on(t.unlockedAt),
	}),
)

export const raGameProgress = sqliteTable('ra_game_progress', {
	gameId: int('game_id').primaryKey(),
	title: text('title').notNull(),
	imageIcon: text('image_icon').notNull(),
	numAchievements: int('num_achievements').notNull(),
	numAwarded: int('num_awarded').notNull(),
	numAwardedHardcore: int('num_awarded_hardcore').notNull(),
	points: int('points').notNull(),
	maxPoints: int('max_points').notNull(),
	consoleId: int('console_id').notNull(),
	consoleName: text('console_name').notNull(),
	syncedAt: int('synced_at', { mode: 'timestamp' }).notNull(),
})

export const raGameMapping = sqliteTable('ra_game_mapping', {
	romPath: text('rom_path').primaryKey(),
	raGameId: int('ra_game_id').notNull(),
	matchKind: text('match_kind', { enum: ['auto', 'manual'] }).notNull(),
	updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
})

export const sessions = sqliteTable(
	'sessions',
	{
		id: int('id').primaryKey({ autoIncrement: true }),
		gameId: int('game_id'),
		startedAt: int('started_at', { mode: 'timestamp' }).notNull(),
		endedAt: int('ended_at', { mode: 'timestamp' }),
		durationSeconds: int('duration_seconds'),
		system: text('system').notNull(),
		romPath: text('rom_path').notNull(),
		autoClosed: int('auto_closed', { mode: 'boolean' }).default(false),
		closedReason: text('closed_reason'),
	},
	(t) => ({
		romPathIdx: index('idx_sessions_rom_path').on(t.romPath),
		startedAtIdx: index('idx_sessions_started_at').on(t.startedAt),
		endedAtIdx: index('idx_sessions_ended_at').on(t.endedAt),
	}),
)

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
	srSlug: text('sr_slug'),
	srHasPage: int('sr_has_page'),
	srUrl: text('sr_url'),
	srCheckedAt: int('sr_checked_at', { mode: 'timestamp' }),
})

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
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

export const srCache = sqliteTable('sr_cache', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
})
