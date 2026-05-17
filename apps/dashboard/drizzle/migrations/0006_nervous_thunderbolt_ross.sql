CREATE TABLE `wrapped_cache` (
	`year` integer NOT NULL,
	`locale` text NOT NULL,
	`data` text NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`year`, `locale`)
);
