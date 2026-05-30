import { sql } from 'drizzle-orm'
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
		source: text('source', { enum: ['scrobbler', 'manual'] })
			.notNull()
			.default('scrobbler'),
		durationConfidence: text('duration_confidence', { enum: ['measured', 'estimated'] })
			.notNull()
			.default('measured'),
		classification: text('classification', {
			enum: ['noise', 'bounce', 'taste', 'meaningful', 'marathon'],
		}),
	},
	(t) => ({
		recalboxIdIdx: index('idx_sessions_recalbox_id').on(t.recalboxId),
		romPathIdx: index('idx_sessions_rom_path').on(t.romPath),
		startedAtIdx: index('idx_sessions_started_at').on(t.startedAt),
		endedAtIdx: index('idx_sessions_ended_at').on(t.endedAt),
		sourceIdx: index('idx_sessions_source').on(t.source),
		classificationIdx: index('idx_sessions_classification').on(t.classification),
		gameClassificationIdx: index('idx_sessions_game_classification').on(t.gameId, t.classification),
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

/**
 * Statistiques héritées de gamelist-userdata.ini (playCount, lastPlayed).
 * Source of truth for the recommendation algorithm.
 * One row per game, upserted on each collection sync.
 */
export const gameInheritedStats = sqliteTable(
	'game_inherited_stats',
	{
		gameId: int('game_id').primaryKey(),
		playCount: int('play_count').notNull().default(0),
		lastPlayedAt: int('last_played_at', { mode: 'timestamp' }),
		importedAt: int('imported_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
		lastSyncedAt: int('last_synced_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => ({
		playCountIdx: index('idx_inherited_play_count').on(t.playCount),
		lastPlayedIdx: index('idx_inherited_last_played').on(t.lastPlayedAt),
	}),
)

export type GameInheritedStats = typeof gameInheritedStats.$inferSelect
export type NewGameInheritedStats = typeof gameInheritedStats.$inferInsert

/**
 * Manual or auto-inferred engagement verdict for a game based on inherited stats.
 * Used by the recommendation algorithm to qualify historical play intent.
 */
export const gameCalibration = sqliteTable('game_calibration', {
	gameId: int('game_id').primaryKey(),
	engagement: text('engagement', { enum: ['high', 'medium', 'bounced', 'unknown'] }).notNull(),
	source: text('source', { enum: ['user', 'auto_inferred'] }).notNull(),
	calibratedAt: int('calibrated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
	notes: text('notes'),
	snapshotPlayCount: int('snapshot_play_count').notNull(),
	snapshotLastPlayed: int('snapshot_last_played', { mode: 'timestamp' }),
})

export type GameCalibration = typeof gameCalibration.$inferSelect
export type NewGameCalibration = typeof gameCalibration.$inferInsert

/**
 * Lets the user defer calibration of a game to a later date.
 * After skipCount reaches 3 the game is auto-calibrated as 'unknown'.
 */
export const gameCalibrationSkip = sqliteTable(
	'game_calibration_skip',
	{
		gameId: int('game_id').primaryKey(),
		skippedAt: int('skipped_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
		reappearAt: int('reappear_at', { mode: 'timestamp' }).notNull(),
		skipCount: int('skip_count').notNull().default(1),
	},
	(t) => ({
		reappearIdx: index('idx_calibration_skip_reappear').on(t.reappearAt),
	}),
)

export type GameCalibrationSkip = typeof gameCalibrationSkip.$inferSelect

export const gameRatings = sqliteTable(
	'game_ratings',
	{
		gameId: int('game_id').primaryKey(),
		rating: text('rating', { enum: ['love', 'like', 'dislike', 'unknown'] }).notNull(),
		source: text('source', { enum: ['post_session', 'manual'] }).notNull(),
		ratedAt: int('rated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
		triggeredBySessionId: int('triggered_by_session_id'),
	},
	(t) => ({
		ratingIdx: index('idx_game_ratings_rating').on(t.rating),
		sourceIdx: index('idx_game_ratings_source').on(t.source),
	}),
)

export type GameRating = typeof gameRatings.$inferSelect
export type NewGameRating = typeof gameRatings.$inferInsert

export const pendingFeedback = sqliteTable(
	'pending_feedback',
	{
		id: int('id').primaryKey({ autoIncrement: true }),
		sessionId: int('session_id').notNull().unique(),
		gameId: int('game_id').notNull(),
		durationSeconds: int('duration_seconds').notNull(),
		classification: text('classification').notNull(),
		createdAt: int('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
		shownAt: int('shown_at', { mode: 'timestamp' }),
		respondedAt: int('responded_at', { mode: 'timestamp' }),
		expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
		pushedInApp: int('pushed_in_app', { mode: 'boolean' }).notNull().default(false),
	},
	(t) => ({
		pendingIdx: index('idx_pending_feedback_pending').on(t.respondedAt, t.expiresAt),
		gameIdx: index('idx_pending_feedback_game').on(t.gameId),
		pushedIdx: index('idx_pending_feedback_pushed').on(t.pushedInApp),
	}),
)

export type PendingFeedback = typeof pendingFeedback.$inferSelect

export type WeightedItem = {
	key: string
	weight: number
	rawScore: number
}

/**
 * Singleton profil de goûts inféré automatiquement depuis les sessions,
 * stats héritées et ratings. Recalculé en arrière-plan (id = 1, toujours).
 */
export const userProfile = sqliteTable('user_profile', {
	id: int('id').primaryKey(),
	systemsWeights: text('systems_weights', { mode: 'json' })
		.$type<WeightedItem[]>()
		.notNull()
		.default(sql`'[]'`),
	genresWeights: text('genres_weights', { mode: 'json' })
		.$type<WeightedItem[]>()
		.notNull()
		.default(sql`'[]'`),
	decadesWeights: text('decades_weights', { mode: 'json' })
		.$type<WeightedItem[]>()
		.notNull()
		.default(sql`'[]'`),
	developersWeights: text('developers_weights', { mode: 'json' })
		.$type<WeightedItem[]>()
		.notNull()
		.default(sql`'[]'`),
	comfortGames: text('comfort_games', { mode: 'json' })
		.$type<number[]>()
		.notNull()
		.default(sql`'[]'`),
	bouncerGames: text('bouncer_games', { mode: 'json' })
		.$type<number[]>()
		.notNull()
		.default(sql`'[]'`),
	totalSignalSessions: int('total_signal_sessions').notNull().default(0),
	profileMaturity: real('profile_maturity').notNull().default(0),
	computedAt: int('computed_at', { mode: 'timestamp' }),
	computeDurationMs: int('compute_duration_ms'),
})

export type UserProfile = typeof userProfile.$inferSelect

// ── IGDB integration (optional) ──────────────────────────────────────────────

export const igdbCredentials = sqliteTable('igdb_credentials', {
	id: int('id').primaryKey().default(1),
	clientId: text('client_id'),
	clientSecret: text('client_secret'),
	accessToken: text('access_token'),
	accessTokenExpiresAt: int('access_token_expires_at', { mode: 'timestamp' }),
	enabled: int('enabled', { mode: 'boolean' }).notNull().default(false),
	lastTestedAt: int('last_tested_at', { mode: 'timestamp' }),
	lastTestStatus: text('last_test_status', {
		enum: ['ok', 'invalid_credentials', 'network_error', 'unknown_error'],
	}),
	updatedAt: int('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
})

export type IgdbCredentials = typeof igdbCredentials.$inferSelect

export const gameIgdbMapping = sqliteTable(
	'game_igdb_mapping',
	{
		gameId: int('game_id').primaryKey(),
		igdbId: int('igdb_id'),
		igdbName: text('igdb_name'),
		matchConfidence: real('match_confidence'),
		matchMethod: text('match_method', {
			enum: ['exact_name', 'cleaned_name', 'fuzzy', 'manual', 'not_found'],
		}),
		matchedAt: int('matched_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		needsReview: int('needs_review', { mode: 'boolean' }).notNull().default(false),
	},
	(t) => ({
		igdbIdIdx: index('game_igdb_mapping_igdb_idx').on(t.igdbId),
		reviewIdx: index('game_igdb_mapping_review_idx').on(t.needsReview),
	}),
)

export type GameIgdbMapping = typeof gameIgdbMapping.$inferSelect

export const igdbPlatformMapping = sqliteTable('igdb_platform_mapping', {
	recalboxSystem: text('recalbox_system').primaryKey(),
	igdbPlatformId: int('igdb_platform_id').notNull(),
	igdbPlatformName: text('igdb_platform_name').notNull(),
})

export type IgdbPlatformMapping = typeof igdbPlatformMapping.$inferSelect

export const igdbGameCache = sqliteTable(
	'igdb_game_cache',
	{
		igdbId: int('igdb_id').primaryKey(),
		name: text('name').notNull(),
		similarGames: text('similar_games', { mode: 'json' }).$type<number[]>(),
		themes: text('themes', { mode: 'json' }).$type<string[]>(),
		gameModes: text('game_modes', { mode: 'json' }).$type<string[]>(),
		playerPerspectives: text('player_perspectives', { mode: 'json' }).$type<string[]>(),
		rating: real('rating'),
		ratingCount: int('rating_count'),
		rawPayload: text('raw_payload', { mode: 'json' }),
		fetchedAt: int('fetched_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		expiresIdx: index('igdb_cache_expires_idx').on(t.expiresAt),
	}),
)

export type IgdbGameCache = typeof igdbGameCache.$inferSelect

// ── HLTB ─────────────────────────────────────────────────────────────────────

export const gameHltbMapping = sqliteTable(
	'game_hltb_mapping',
	{
		gameId: int('game_id').primaryKey(),
		hltbId: int('hltb_id'),
		hltbName: text('hltb_name'),
		matchConfidence: real('match_confidence'),
		matchMethod: text('match_method', {
			enum: ['exact', 'cleaned', 'fuzzy', 'not_found'],
		}),
		matchedAt: int('matched_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		needsReview: int('needs_review', { mode: 'boolean' }).notNull().default(false),
	},
	(t) => ({
		hltbIdIdx: index('game_hltb_mapping_hltb_idx').on(t.hltbId),
	}),
)

export type GameHltbMapping = typeof gameHltbMapping.$inferSelect

export const hltbCache = sqliteTable(
	'hltb_cache',
	{
		hltbId: int('hltb_id').primaryKey(),
		name: text('name').notNull(),
		mainStorySeconds: int('main_story_seconds'),
		mainExtrasSeconds: int('main_extras_seconds'),
		completionistSeconds: int('completionist_seconds'),
		fetchedAt: int('fetched_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		expiresIdx: index('hltb_cache_expires_idx').on(t.expiresAt),
	}),
)

export type HltbCache = typeof hltbCache.$inferSelect

// ── Recommendations ──────────────────────────────────────────────────────────

export const recommendationSkip = sqliteTable(
	'recommendation_skip',
	{
		gameId: int('game_id').primaryKey(),
		skippedAt: int('skipped_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		expiresIdx: index('recommendation_skip_expires_idx').on(t.expiresAt),
	}),
)

export type RecommendationSkip = typeof recommendationSkip.$inferSelect

export const recommendationLog = sqliteTable(
	'recommendation_log',
	{
		id: int('id').primaryKey({ autoIncrement: true }),
		presentedAt: int('presented_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		gameId: int('game_id').notNull(),
		contextTimeMinutes: int('context_time_minutes').notNull(),
		contextMood: text('context_mood').notNull(),
		score: real('score').notNull(),
		confidence: text('confidence').notNull(),
		reasons: text('reasons', { mode: 'json' }).$type<unknown[]>(),
		launched: int('launched', { mode: 'boolean' }).notNull().default(false),
		launchedAt: int('launched_at', { mode: 'timestamp' }),
		skipped: int('skipped', { mode: 'boolean' }).notNull().default(false),
		skippedAt: int('skipped_at', { mode: 'timestamp' }),
		resultingSessionId: int('resulting_session_id'),
	},
	(t) => ({
		gameIdx: index('reco_log_game_idx').on(t.gameId),
		presentedIdx: index('reco_log_presented_idx').on(t.presentedAt),
	}),
)

export type RecommendationLog = typeof recommendationLog.$inferSelect
