CREATE TABLE `recommendation_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`presented_at` integer DEFAULT (unixepoch()) NOT NULL,
	`game_id` integer NOT NULL,
	`context_time_minutes` integer NOT NULL,
	`context_mood` text NOT NULL,
	`score` real NOT NULL,
	`confidence` text NOT NULL,
	`reasons` text,
	`launched` integer DEFAULT false NOT NULL,
	`launched_at` integer,
	`skipped` integer DEFAULT false NOT NULL,
	`skipped_at` integer,
	`resulting_session_id` integer
);
--> statement-breakpoint
CREATE INDEX `reco_log_game_idx` ON `recommendation_log` (`game_id`);--> statement-breakpoint
CREATE INDEX `reco_log_presented_idx` ON `recommendation_log` (`presented_at`);--> statement-breakpoint
CREATE TABLE `recommendation_skip` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`skipped_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recommendation_skip_expires_idx` ON `recommendation_skip` (`expires_at`);