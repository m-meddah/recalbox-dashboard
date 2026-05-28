CREATE TABLE `game_ratings` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`rating` text NOT NULL,
	`source` text NOT NULL,
	`rated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`triggered_by_session_id` integer
);
--> statement-breakpoint
CREATE INDEX `idx_game_ratings_rating` ON `game_ratings` (`rating`);--> statement-breakpoint
CREATE INDEX `idx_game_ratings_source` ON `game_ratings` (`source`);--> statement-breakpoint
CREATE TABLE `pending_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`game_id` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	`classification` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`shown_at` integer,
	`responded_at` integer,
	`expires_at` integer NOT NULL,
	`pushed_in_app` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_feedback_session_id_unique` ON `pending_feedback` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_pending_feedback_pending` ON `pending_feedback` (`responded_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_pending_feedback_game` ON `pending_feedback` (`game_id`);--> statement-breakpoint
CREATE INDEX `idx_pending_feedback_pushed` ON `pending_feedback` (`pushed_in_app`);