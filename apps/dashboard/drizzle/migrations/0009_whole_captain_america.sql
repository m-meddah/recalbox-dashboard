CREATE TABLE `game_calibration` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`engagement` text NOT NULL,
	`source` text NOT NULL,
	`calibrated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`notes` text,
	`snapshot_play_count` integer NOT NULL,
	`snapshot_last_played` integer
);
--> statement-breakpoint
CREATE TABLE `game_calibration_skip` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`skipped_at` integer DEFAULT (unixepoch()) NOT NULL,
	`reappear_at` integer NOT NULL,
	`skip_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_calibration_skip_reappear` ON `game_calibration_skip` (`reappear_at`);--> statement-breakpoint
CREATE TABLE `game_inherited_stats` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`last_played_at` integer,
	`imported_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_synced_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inherited_play_count` ON `game_inherited_stats` (`play_count`);--> statement-breakpoint
CREATE INDEX `idx_inherited_last_played` ON `game_inherited_stats` (`last_played_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `source` text DEFAULT 'scrobbler' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `duration_confidence` text DEFAULT 'measured' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_sessions_source` ON `sessions` (`source`);
--> statement-breakpoint
-- DATA MIGRATION: populate game_inherited_stats from games table (authoritative source for userdata).
-- games.play_count / games.last_played are already populated by the collection sync
-- from gamelist-userdata.ini, so they are the correct values to carry over.
INSERT INTO `game_inherited_stats` (`game_id`, `play_count`, `last_played_at`, `imported_at`, `last_synced_at`)
SELECT
  `id`,
  COALESCE(`play_count`, 0),
  `last_played`,
  unixepoch(),
  unixepoch()
FROM `games`
WHERE `play_count` > 0 OR `last_played` IS NOT NULL
ON CONFLICT(`game_id`) DO UPDATE SET
  `play_count` = excluded.`play_count`,
  `last_played_at` = excluded.`last_played_at`,
  `last_synced_at` = excluded.`last_synced_at`;
--> statement-breakpoint
-- AUTO-CALIBRATE: 1 launch more than 36 months ago → very likely a bounce.
INSERT INTO `game_calibration` (`game_id`, `engagement`, `source`, `snapshot_play_count`, `snapshot_last_played`)
SELECT
  `game_id`,
  'bounced',
  'auto_inferred',
  `play_count`,
  `last_played_at`
FROM `game_inherited_stats`
WHERE `play_count` = 1
  AND `last_played_at` IS NOT NULL
  AND `last_played_at` < unixepoch() - (36 * 30 * 86400)
ON CONFLICT(`game_id`) DO NOTHING;
--> statement-breakpoint
-- CLEANUP: remove fake sessions created by import-gamelist-sessions.ts.
-- These are identified by closedReason = 'gamelist-import' — that was the marker
-- used by the script. The data is now preserved in game_inherited_stats.
DELETE FROM `sessions` WHERE `closed_reason` = 'gamelist-import';