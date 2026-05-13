PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_seconds` integer,
	`system` text NOT NULL,
	`rom_path` text NOT NULL,
	`auto_closed` integer DEFAULT false,
	`closed_reason` text
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "game_id", "started_at", "ended_at", "duration_seconds", "system", "rom_path", "auto_closed", "closed_reason") SELECT "id", "game_id", "started_at", "ended_at", "duration_seconds", "system", "rom_path", 0, NULL FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sessions_rom_path` ON `sessions` (`rom_path`);--> statement-breakpoint
CREATE INDEX `idx_sessions_started_at` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_ended_at` ON `sessions` (`ended_at`);