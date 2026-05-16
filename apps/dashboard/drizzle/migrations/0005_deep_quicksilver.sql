CREATE TABLE `sr_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `games` ADD `sr_slug` text;--> statement-breakpoint
ALTER TABLE `games` ADD `sr_has_page` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `sr_url` text;--> statement-breakpoint
ALTER TABLE `games` ADD `sr_checked_at` integer;