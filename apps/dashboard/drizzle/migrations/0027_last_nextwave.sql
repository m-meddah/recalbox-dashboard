CREATE TABLE `rom_files` (
	`recalbox_id` text NOT NULL,
	`entry_key` text NOT NULL,
	`system` text NOT NULL,
	`mount` text NOT NULL,
	`path` text NOT NULL,
	`inner_name` text,
	`size` integer NOT NULL,
	`mtime` integer NOT NULL,
	`kind` text NOT NULL,
	`crc32` text,
	`sha1` text,
	`serial` text,
	`match_level` text NOT NULL,
	`dat_entry_name` text,
	`canonical_title` text,
	`scanned_at` integer NOT NULL,
	PRIMARY KEY(`recalbox_id`, `entry_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_rom_files_recalbox_system` ON `rom_files` (`recalbox_id`,`system`);--> statement-breakpoint
CREATE INDEX `idx_rom_files_recalbox_crc` ON `rom_files` (`recalbox_id`,`crc32`);--> statement-breakpoint
CREATE TABLE `rom_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`recalbox_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`transport` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`systems_total` integer DEFAULT 0 NOT NULL,
	`systems_done` integer DEFAULT 0 NOT NULL,
	`current_system` text,
	`error` text,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_rom_scans_recalbox_started` ON `rom_scans` (`recalbox_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `rom_system_audits` (
	`recalbox_id` text NOT NULL,
	`system` text NOT NULL,
	`dat_name` text,
	`dat_version` text,
	`total_rom_entries` integer DEFAULT 0 NOT NULL,
	`matched_rom_entries` integer DEFAULT 0 NOT NULL,
	`verified_count` integer DEFAULT 0 NOT NULL,
	`serial_count` integer DEFAULT 0 NOT NULL,
	`named_count` integer DEFAULT 0 NOT NULL,
	`unknown_count` integer DEFAULT 0 NOT NULL,
	`files_scanned` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`mounts` text,
	`matched_entries` text,
	`scanned_at` integer NOT NULL,
	PRIMARY KEY(`recalbox_id`, `system`)
);
