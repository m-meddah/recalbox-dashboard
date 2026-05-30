CREATE TABLE `game_hltb_mapping` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`hltb_id` integer,
	`hltb_name` text,
	`match_confidence` real,
	`match_method` text,
	`matched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_hltb_mapping_hltb_idx` ON `game_hltb_mapping` (`hltb_id`);--> statement-breakpoint
CREATE TABLE `hltb_cache` (
	`hltb_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`main_story_seconds` integer,
	`main_extras_seconds` integer,
	`completionist_seconds` integer,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hltb_cache_expires_idx` ON `hltb_cache` (`expires_at`);