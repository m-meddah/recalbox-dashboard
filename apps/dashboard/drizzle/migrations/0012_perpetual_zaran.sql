CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`systems_weights` text DEFAULT '[]' NOT NULL,
	`genres_weights` text DEFAULT '[]' NOT NULL,
	`decades_weights` text DEFAULT '[]' NOT NULL,
	`developers_weights` text DEFAULT '[]' NOT NULL,
	`comfort_games` text DEFAULT '[]' NOT NULL,
	`bouncer_games` text DEFAULT '[]' NOT NULL,
	`total_signal_sessions` integer DEFAULT 0 NOT NULL,
	`profile_maturity` real DEFAULT 0 NOT NULL,
	`computed_at` integer,
	`compute_duration_ms` integer
);
--> statement-breakpoint
INSERT OR IGNORE INTO `user_profile` (`id`) VALUES (1);
