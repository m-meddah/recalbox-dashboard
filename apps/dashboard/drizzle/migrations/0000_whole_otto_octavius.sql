CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`system` text NOT NULL,
	`rom_path` text NOT NULL,
	`screenshot_path` text,
	`rating` real,
	`players` integer,
	`release_date` text,
	`developer` text,
	`publisher` text,
	`genre` text,
	`description` text,
	`scrape_status` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_rom_path_unique` ON `games` (`rom_path`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_seconds` integer,
	`system` text NOT NULL,
	`rom_path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` integer NOT NULL,
	`cpu_percent` real,
	`mem_used_mb` real,
	`mem_total_mb` real,
	`temp_celsius` real,
	`uptime_seconds` integer
);
