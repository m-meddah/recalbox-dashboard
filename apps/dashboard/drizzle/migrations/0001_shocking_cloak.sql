ALTER TABLE `games` ADD `image_path` text;--> statement-breakpoint
ALTER TABLE `games` ADD `video_path` text;--> statement-breakpoint
ALTER TABLE `games` ADD `thumbnail_path` text;--> statement-breakpoint
ALTER TABLE `games` ADD `hash` text;--> statement-breakpoint
ALTER TABLE `games` ADD `region` text;--> statement-breakpoint
ALTER TABLE `games` ADD `favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `play_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `games` ADD `last_played` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `disk_source` text;--> statement-breakpoint
ALTER TABLE `games` ADD `synced_at` integer;
