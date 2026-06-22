CREATE TABLE `now_playing` (
	`recalbox_id` text PRIMARY KEY NOT NULL,
	`playing` integer DEFAULT false NOT NULL,
	`system` text,
	`system_full_name` text,
	`rom_path` text,
	`game_name` text,
	`image_path` text,
	`emulator` text,
	`from_screensaver` integer DEFAULT false NOT NULL,
	`started_at` integer,
	`updated_at` integer NOT NULL
);
