ALTER TABLE `game_inherited_stats` ADD `play_time_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `play_time_seconds` integer DEFAULT 0;