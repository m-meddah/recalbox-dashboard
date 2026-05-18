CREATE TABLE `recalboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`ssh_user` text NOT NULL,
	`ssh_password` text NOT NULL,
	`ssh_port` integer DEFAULT 22 NOT NULL,
	`mqtt_port` integer DEFAULT 1883 NOT NULL,
	`color` text,
	`icon_emoji` text,
	`is_default` integer DEFAULT false,
	`archived` integer DEFAULT false,
	`created_at` integer NOT NULL,
	`last_connected_at` integer
);
--> statement-breakpoint
DROP INDEX `games_rom_path_unique`;--> statement-breakpoint
ALTER TABLE `games` ADD `recalbox_id` text;--> statement-breakpoint
CREATE INDEX `idx_games_recalbox_id` ON `games` (`recalbox_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_games_recalbox_rom` ON `games` (`recalbox_id`,`rom_path`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ra_game_mapping` (
	`recalbox_id` text NOT NULL,
	`rom_path` text NOT NULL,
	`ra_game_id` integer NOT NULL,
	`match_kind` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`recalbox_id`, `rom_path`)
);
--> statement-breakpoint
INSERT INTO `__new_ra_game_mapping`("recalbox_id", "rom_path", "ra_game_id", "match_kind", "updated_at") SELECT "recalbox_id", "rom_path", "ra_game_id", "match_kind", "updated_at" FROM `ra_game_mapping`;--> statement-breakpoint
DROP TABLE `ra_game_mapping`;--> statement-breakpoint
ALTER TABLE `__new_ra_game_mapping` RENAME TO `ra_game_mapping`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `notifications` ADD `recalbox_id` text;--> statement-breakpoint
CREATE INDEX `idx_notifications_recalbox_id` ON `notifications` (`recalbox_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `recalbox_id` text;--> statement-breakpoint
CREATE INDEX `idx_sessions_recalbox_id` ON `sessions` (`recalbox_id`);--> statement-breakpoint
ALTER TABLE `system_snapshots` ADD `recalbox_id` text;--> statement-breakpoint
CREATE INDEX `idx_snapshots_recalbox_id` ON `system_snapshots` (`recalbox_id`);