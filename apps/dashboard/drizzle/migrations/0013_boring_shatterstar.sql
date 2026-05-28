CREATE TABLE `game_igdb_mapping` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`igdb_id` integer,
	`igdb_name` text,
	`match_confidence` real,
	`match_method` text,
	`matched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_igdb_mapping_igdb_idx` ON `game_igdb_mapping` (`igdb_id`);--> statement-breakpoint
CREATE INDEX `game_igdb_mapping_review_idx` ON `game_igdb_mapping` (`needs_review`);--> statement-breakpoint
CREATE TABLE `igdb_credentials` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`client_id` text,
	`client_secret` text,
	`access_token` text,
	`access_token_expires_at` integer,
	`enabled` integer DEFAULT false NOT NULL,
	`last_tested_at` integer,
	`last_test_status` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `igdb_game_cache` (
	`igdb_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`similar_games` text,
	`themes` text,
	`game_modes` text,
	`player_perspectives` text,
	`rating` real,
	`rating_count` integer,
	`raw_payload` text,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `igdb_cache_expires_idx` ON `igdb_game_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `igdb_platform_mapping` (
	`recalbox_system` text PRIMARY KEY NOT NULL,
	`igdb_platform_id` integer NOT NULL,
	`igdb_platform_name` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO igdb_credentials (id) VALUES (1);
--> statement-breakpoint
INSERT OR IGNORE INTO igdb_platform_mapping (recalbox_system, igdb_platform_id, igdb_platform_name) VALUES
  ('snes', 19, 'Super Nintendo'),
  ('nes', 18, 'NES'),
  ('n64', 4, 'Nintendo 64'),
  ('gamecube', 21, 'Nintendo GameCube'),
  ('gc', 21, 'Nintendo GameCube'),
  ('wii', 5, 'Wii'),
  ('wiiu', 41, 'Wii U'),
  ('switch', 130, 'Nintendo Switch'),
  ('gb', 33, 'Game Boy'),
  ('gbc', 22, 'Game Boy Color'),
  ('gba', 24, 'Game Boy Advance'),
  ('nds', 20, 'Nintendo DS'),
  ('3ds', 37, 'Nintendo 3DS'),
  ('virtualboy', 87, 'Virtual Boy'),
  ('fds', 51, 'Family Computer Disk System'),
  ('megadrive', 29, 'Sega Mega Drive/Genesis'),
  ('genesis', 29, 'Sega Mega Drive/Genesis'),
  ('mastersystem', 64, 'Sega Master System'),
  ('gamegear', 35, 'Sega Game Gear'),
  ('sg1000', 84, 'SG-1000'),
  ('sega32x', 30, 'Sega 32X'),
  ('segacd', 78, 'Sega CD'),
  ('saturn', 32, 'Sega Saturn'),
  ('dreamcast', 23, 'Dreamcast'),
  ('psx', 7, 'PlayStation'),
  ('ps2', 8, 'PlayStation 2'),
  ('psp', 38, 'PlayStation Portable'),
  ('neogeo', 80, 'Neo Geo AES'),
  ('neogeocd', 136, 'Neo Geo CD'),
  ('ngp', 119, 'Neo Geo Pocket'),
  ('ngpc', 120, 'Neo Geo Pocket Color'),
  ('arcade', 52, 'Arcade'),
  ('mame', 52, 'Arcade'),
  ('fbneo', 52, 'Arcade'),
  ('pcengine', 86, 'TurboGrafx-16/PC Engine'),
  ('pcenginecd', 150, 'Turbografx-16/PC Engine CD'),
  ('supergrafx', 128, 'PC Engine SuperGrafx'),
  ('atari2600', 59, 'Atari 2600'),
  ('atari5200', 66, 'Atari 5200'),
  ('atari7800', 60, 'Atari 7800'),
  ('lynx', 61, 'Atari Lynx'),
  ('jaguar', 62, 'Atari Jaguar'),
  ('atarist', 63, 'Atari ST/STE'),
  ('3do', 50, '3DO Interactive Multiplayer'),
  ('amiga', 16, 'Amiga'),
  ('amigacd32', 114, 'Amiga CD32'),
  ('amstradcpc', 25, 'Amstrad CPC'),
  ('c64', 15, 'Commodore C64/128'),
  ('zxspectrum', 26, 'ZX Spectrum'),
  ('msx1', 27, 'MSX'),
  ('msx2', 53, 'MSX2'),
  ('wswan', 57, 'WonderSwan'),
  ('wswanc', 123, 'WonderSwan Color'),
  ('colecovision', 68, 'ColecoVision'),
  ('intellivision', 67, 'Intellivision'),
  ('vectrex', 70, 'Vectrex'),
  ('x68000', 121, 'Sharp X68000'),
  ('naomi', 52, 'Arcade'),
  ('naomi2', 52, 'Arcade'),
  ('atomiswave', 52, 'Arcade'),
  ('model3', 52, 'Arcade'),
  ('pcenginecd', 150, 'TurboGrafx-CD')
  ON CONFLICT(recalbox_system) DO NOTHING;
