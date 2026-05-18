import { index, int, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const recalboxes = sqliteTable('recalboxes', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	host: text('host').notNull(),
	sshUser: text('ssh_user').notNull(),
	sshPassword: text('ssh_password').notNull(),
	sshPort: int('ssh_port').notNull().default(22),
	mqttPort: int('mqtt_port').notNull().default(1883),
	color: text('color'),
	iconEmoji: text('icon_emoji'),
	isDefault: int('is_default', { mode: 'boolean' }).default(false),
	archived: int('archived', { mode: 'boolean' }).default(false),
	createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
	lastConnectedAt: int('last_connected_at', { mode: 'timestamp' }),
})

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

export const raGameMapping = sqliteTable(
	'ra_game_mapping',
	{
		recalboxId: text('recalbox_id').notNull(),
		romPath: text('rom_path').notNull(),
		raGameId: int('ra_game_id').notNull(),
		matchKind: text('match_kind', { enum: ['auto', 'manual'] }).notNull(),
		updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.recalboxId, t.romPath] }),
	}),
)

export const sessions = sqliteTable(
	'sessions',
	{
		id: int('id').primaryKey({ autoIncrement: true }),
		recalboxId: text('recalbox_id'),
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
		recalboxIdIdx: index('idx_sessions_recalbox_id').on(t.recalboxId),
		romPathIdx: index('idx_sessions_rom_path').on(t.romPath),
		startedAtIdx: index('idx_sessions_started_at').on(t.startedAt),
		endedAtIdx: index('idx_sessions_ended_at').on(t.endedAt),
	}),
)

export const games = sqliteTable(
	'games',
	{
		id: int('id').primaryKey({ autoIncrement: true }),
		recalboxId: text('recalbox_id'),
		name: text('name').notNull(),
		system: text('system').notNull(),
		romPath: text('rom_path').notNull(),
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
	},
	(t) => ({
		recalboxRomUnique: unique('uq_games_recalbox_rom').on(t.recalboxId, t.romPath),
		recalboxIdIdx: index('idx_games_recalbox_id').on(t.recalboxId),
	}),
)

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
})

export const systemSnapshots = sqliteTable(
	'system_snapshots',
	{
		id: int('id').primaryKey({ autoIncrement: true }),
		recalboxId: text('recalbox_id'),
		capturedAt: int('captured_at', { mode: 'timestamp' }).notNull(),
		cpuPercent: real('cpu_percent'),
		memUsedMb: real('mem_used_mb'),
		memTotalMb: real('mem_total_mb'),
		tempCelsius: real('temp_celsius'),
		uptimeSeconds: int('uptime_seconds'),
	},
	(t) => ({
		recalboxIdIdx: index('idx_snapshots_recalbox_id').on(t.recalboxId),
	}),
)

export const srCache = sqliteTable('sr_cache', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
})

export const wrappedCache = sqliteTable(
	'wrapped_cache',
	{
		year: int('year').notNull(),
		locale: text('locale').notNull(),
		data: text('data').notNull(),
		generatedAt: int('generated_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.year, t.locale] }),
	}),
)

export const notifications = sqliteTable(
	'notifications',
	{
		id: int('id').primaryKey({ autoIncrement: true }),
		recalboxId: text('recalbox_id'),
		type: text('type').notNull(),
		data: text('data').notNull(),
		createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
		readAt: int('read_at', { mode: 'timestamp' }),
		pushedInApp: int('pushed_in_app', { mode: 'boolean' }).default(false),
		pushedWeb: int('pushed_web', { mode: 'boolean' }).default(false),
	},
	(t) => ({
		createdAtIdx: index('idx_notifications_created_at').on(t.createdAt),
		pushedInAppIdx: index('idx_notifications_pushed_in_app').on(t.pushedInApp),
		recalboxIdIdx: index('idx_notifications_recalbox_id').on(t.recalboxId),
	}),
)

export const pushSubscriptions = sqliteTable('push_subscriptions', {
	id: int('id').primaryKey({ autoIncrement: true }),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	userAgent: text('user_agent'),
	createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
	lastUsedAt: int('last_used_at', { mode: 'timestamp' }).notNull(),
})
