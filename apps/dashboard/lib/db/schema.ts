import type { StorageMount } from '@/lib/recalbox/storage'
import { sql } from 'drizzle-orm'
import { index, int, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const recalboxes = sqliteTable(
	'recalboxes',
	{
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
		ownerUserId: text('owner_user_id'),
	},
	(t) => ({
		ownerIdx: index('idx_recalboxes_owner').on(t.ownerUserId),
	}),
)

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
		source: text('source', { enum: ['scrobbler', 'agent', 'manual'] })
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

/**
 * Sources that represent real, automatically-recorded play: the self-hosted
 * scrobbler daemon and the serverless on-box agent. Stats/profile/play-stats
 * count these (but not 'manual'). NOTE: some queries embed this as a raw SQL
 * literal `IN ('scrobbler', 'agent')` — keep those in sync with this list.
 */
export const REAL_PLAY_SOURCES: Array<'scrobbler' | 'agent'> = ['scrobbler', 'agent']

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
		emulator: text('emulator'),
		core: text('core'),
		favorite: int('favorite', { mode: 'boolean' }).notNull().default(false),
		hidden: int('hidden', { mode: 'boolean' }).notNull().default(false),
		playCount: int('play_count').default(0),
		lastPlayed: int('last_played', { mode: 'timestamp' }),
		/** Cumulative play time in seconds (Recalbox "temps joué"). */
		playTimeSeconds: int('play_time_seconds').default(0),
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
		// Several queries join sessions onto games by rom_path ALONE, with no recalbox_id
		// predicate — so the unique index above cannot serve them: rom_path is not its
		// leading column. SQLite then falls back to building a throwaway "AUTOMATIC
		// COVERING INDEX", which means scanning every game row on each execution. That is
		// 71k rows and ~1.4s for the Wrapped preview banner alone, which renders on every
		// stats page (and all four period tabs get prefetched, so one visit pays it four
		// times over).
		romPathIdx: index('idx_games_rom_path').on(t.romPath),
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
		storage: text('storage', { mode: 'json' }).$type<StorageMount[]>(),
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
		// Which Recalboxes the recap covers: their ids, sorted and comma-joined. It belongs
		// in the KEY because the cached JSON is only valid for the box set it was computed
		// from — without it, the first user to open their recap would have it served to
		// everyone else.
		scope: text('scope').notNull(),
		data: text('data').notNull(),
		generatedAt: int('generated_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.year, t.locale, t.scope] }),
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
 * Statistiques héritées de gamelist-userdata.ini (playCount, lastPlayed, timeplayed).
 * Source of truth for the recommendation algorithm.
 * One row per game, upserted on each collection sync.
 */
export const gameInheritedStats = sqliteTable(
	'game_inherited_stats',
	{
		gameId: int('game_id').primaryKey(),
		playCount: int('play_count').notNull().default(0),
		lastPlayedAt: int('last_played_at', { mode: 'timestamp' }),
		/** Cumulative play time in seconds inherited from gamelist userdata. */
		playTimeSeconds: int('play_time_seconds').notNull().default(0),
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
	updatedAt: int('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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
			enum: ['exact_name', 'alt_name', 'cleaned_name', 'fuzzy', 'manual', 'not_found'],
		}),
		matchedAt: int('matched_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
		needsReview: int('needs_review', { mode: 'boolean' }).notNull().default(false),
		candidates: text('candidates'),
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
		fetchedAt: int('fetched_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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
		matchedAt: int('matched_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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
		fetchedAt: int('fetched_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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
		skippedAt: int('skipped_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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
		presentedAt: int('presented_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
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

export const invitations = sqliteTable(
	'invitations',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		role: text('role').notNull().default('member'),
		tokenHash: text('token_hash').notNull().unique(),
		// Epoch milliseconds (plain integer) — kept as a number for simple expiry math.
		expiresAt: int('expires_at').notNull(),
		invitedByUserId: text('invited_by_user_id').notNull(),
		acceptedAt: int('accepted_at'),
		createdAt: int('created_at').notNull(),
	},
	(table) => [index('invitations_token_hash_idx').on(table.tokenHash)],
)

// Per-Recalbox machine tokens used by the on-device agent to authenticate its
// outbound session pushes (Bearer). Only the SHA-256 hash is stored; the raw
// token is shown once at creation. Multiple rows per Recalbox allow rotation.
export const agentTokens = sqliteTable(
	'agent_tokens',
	{
		id: text('id').primaryKey(),
		recalboxId: text('recalbox_id').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		name: text('name'),
		createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
		lastUsedAt: int('last_used_at', { mode: 'timestamp' }),
		revokedAt: int('revoked_at', { mode: 'timestamp' }),
	},
	(t) => [
		index('idx_agent_tokens_recalbox').on(t.recalboxId),
		index('idx_agent_tokens_token_hash').on(t.tokenHash),
	],
)

/**
 * Remote-control command queue. A user enqueues a command for a Recalbox; the
 * on-device agent polls (outbound, NAT-friendly), claims pending rows, executes
 * them locally and reports the result back. Replaces live SSH control.
 */
export const agentCommands = sqliteTable(
	'agent_commands',
	{
		id: text('id').primaryKey(),
		recalboxId: text('recalbox_id').notNull(),
		// 'power' | 'launch' | 'conf' — validated against an allowlist before enqueue.
		type: text('type').notNull(),
		// Type-specific params (e.g. { action: 'reboot' }, { key, value }, { romPath, system }).
		payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
		// 'pending' → 'claimed' (agent picked it up) → 'done' | 'failed'.
		status: text('status').notNull().default('pending'),
		createdBy: text('created_by'),
		createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
		claimedAt: int('claimed_at', { mode: 'timestamp' }),
		completedAt: int('completed_at', { mode: 'timestamp' }),
		// Free-text result on success, or the error message on failure.
		result: text('result'),
	},
	(t) => [index('idx_agent_commands_recalbox_status').on(t.recalboxId, t.status)],
)

/**
 * Live "now playing" state, one row per Recalbox. The on-device agent writes it
 * from local MQTT (game start/stop); the SSE endpoint relays it to browsers via
 * a DB poll when the cloud has no direct MQTT link to the box (serverless mode).
 */
export const nowPlaying = sqliteTable('now_playing', {
	recalboxId: text('recalbox_id').primaryKey(),
	playing: int('playing', { mode: 'boolean' }).notNull().default(false),
	system: text('system'),
	systemFullName: text('system_full_name'),
	romPath: text('rom_path'),
	gameName: text('game_name'),
	imagePath: text('image_path'),
	emulator: text('emulator'),
	fromScreensaver: int('from_screensaver', { mode: 'boolean' }).notNull().default(false),
	startedAt: int('started_at', { mode: 'timestamp' }),
	updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
})

/**
 * Game artwork mirrored to object storage. Keyed by (recalbox, box file path).
 * `url` null = "wanted" (a browser requested it but it isn't uploaded yet) → the
 * agent polls these, reads the local file and uploads it (request-driven, lazy).
 */
export const artwork = sqliteTable(
	'artwork',
	{
		recalboxId: text('recalbox_id').notNull(),
		boxPath: text('box_path').notNull(),
		url: text('url'),
		contentType: text('content_type'),
		wantedAt: int('wanted_at', { mode: 'timestamp' }),
		uploadedAt: int('uploaded_at', { mode: 'timestamp' }),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.recalboxId, t.boxPath] }),
		uploadedIdx: index('idx_artwork_recalbox_uploaded').on(t.recalboxId, t.uploadedAt),
		// Every enrolled box asks "what is still wanted?" once a minute, forever. That
		// query filters on `url IS NULL`, which no plain index covers: the planner seeks
		// by recalbox_id and then tests the column on every row it lands on, so an IDLE
		// poll costs one row read per mirrored artwork — the price grows with the whole
		// collection instead of with the handful actually pending. A PARTIAL index holds
		// only the wanted rows, so the usual empty-queue poll reads ~nothing. This is the
		// difference between a few thousand row reads a day and hundreds of millions once
		// a box is on 24/7 with its collection mirrored.
		wantedIdx: index('idx_artwork_wanted').on(t.recalboxId).where(sql`${t.url} is null`),
	}),
)

/**
 * One ROM audit run. A run is per Recalbox and covers one or more systems; the
 * progress columns are what the audit page polls while it is in flight.
 */
export const romScans = sqliteTable(
	'rom_scans',
	{
		id: text('id').primaryKey(),
		recalboxId: text('recalbox_id').notNull(),
		// 'pending' (queued for the agent) → 'running' → 'done' | 'failed'.
		status: text('status').notNull().default('pending'),
		// 'ssh' (self-hosted, server-driven) | 'agent' (serverless, box-driven).
		transport: text('transport').notNull(),
		startedAt: int('started_at', { mode: 'timestamp' }).notNull(),
		// Bumped on every progress write: staleness is judged on this, not startedAt.
		updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
		completedAt: int('completed_at', { mode: 'timestamp' }),
		systemsTotal: int('systems_total').notNull().default(0),
		systemsDone: int('systems_done').notNull().default(0),
		currentSystem: text('current_system'),
		error: text('error'),
		createdBy: text('created_by'),
	},
	(t) => [index('idx_rom_scans_recalbox_started').on(t.recalboxId, t.startedAt)],
)

/**
 * Per-system audit aggregate — one row per (Recalbox, system). This is the only
 * table the serverless deploy grows per scan, and it is what the overview and
 * the missing-games list read: `matchedEntries` holds the DAT entry names the
 * collection covers, so the missing list is a set difference against the cached
 * DAT, with no per-file read and nothing extra stored.
 */
export const romSystemAudits = sqliteTable(
	'rom_system_audits',
	{
		recalboxId: text('recalbox_id').notNull(),
		system: text('system').notNull(),
		datName: text('dat_name'),
		datVersion: text('dat_version'),
		totalRomEntries: int('total_rom_entries').notNull().default(0),
		matchedRomEntries: int('matched_rom_entries').notNull().default(0),
		verifiedCount: int('verified_count').notNull().default(0),
		serialCount: int('serial_count').notNull().default(0),
		namedCount: int('named_count').notNull().default(0),
		unknownCount: int('unknown_count').notNull().default(0),
		filesScanned: int('files_scanned').notNull().default(0),
		totalBytes: int('total_bytes').notNull().default(0),
		mounts: text('mounts', { mode: 'json' }).$type<string[]>(),
		matchedEntries: text('matched_entries', { mode: 'json' }).$type<string[]>(),
		scannedAt: int('scanned_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [primaryKey({ columns: [t.recalboxId, t.system] })],
)

/**
 * Per-file scan detail. Self-hosted stores every entry; serverless stores only
 * the `unknown` ones (see lib/rom-audit/persist.ts) — the aggregate above
 * carries everything the UI needs for the rest.
 *
 * Keyed on `entryKey`, NOT on `path`: one 7z archive yields one manifest entry
 * per contained ROM, all sharing the same path.
 */
export const romFiles = sqliteTable(
	'rom_files',
	{
		recalboxId: text('recalbox_id').notNull(),
		// `path`, or `path#innerName` when the entry is inside an archive.
		entryKey: text('entry_key').notNull(),
		system: text('system').notNull(),
		mount: text('mount').notNull(),
		path: text('path').notNull(),
		innerName: text('inner_name'),
		size: int('size').notNull(),
		mtime: int('mtime').notNull(),
		kind: text('kind').notNull(),
		crc32: text('crc32'),
		sha1: text('sha1'),
		serial: text('serial'),
		matchLevel: text('match_level').notNull(),
		datEntryName: text('dat_entry_name'),
		canonicalTitle: text('canonical_title'),
		scannedAt: int('scanned_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.recalboxId, t.entryKey] }),
		index('idx_rom_files_recalbox_system').on(t.recalboxId, t.system),
		index('idx_rom_files_recalbox_crc').on(t.recalboxId, t.crc32),
	],
)

export * from '@/lib/auth/auth-schema'
