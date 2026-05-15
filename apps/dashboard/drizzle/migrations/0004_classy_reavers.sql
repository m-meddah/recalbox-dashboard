CREATE TABLE `ra_achievements` (
	`id` integer PRIMARY KEY NOT NULL,
	`game_id` integer NOT NULL,
	`title` text NOT NULL,
	`points` integer NOT NULL,
	`image_url` text NOT NULL,
	`unlocked_at` integer NOT NULL,
	`is_hardcore` integer DEFAULT false,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ra_achievements_game_id` ON `ra_achievements` (`game_id`);--> statement-breakpoint
CREATE INDEX `idx_ra_achievements_unlocked_at` ON `ra_achievements` (`unlocked_at`);--> statement-breakpoint
CREATE TABLE `ra_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ra_game_mapping` (
	`rom_path` text PRIMARY KEY NOT NULL,
	`ra_game_id` integer NOT NULL,
	`match_kind` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ra_game_progress` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`image_icon` text NOT NULL,
	`num_achievements` integer NOT NULL,
	`num_awarded` integer NOT NULL,
	`num_awarded_hardcore` integer NOT NULL,
	`points` integer NOT NULL,
	`max_points` integer NOT NULL,
	`console_id` integer NOT NULL,
	`console_name` text NOT NULL,
	`synced_at` integer NOT NULL
);
