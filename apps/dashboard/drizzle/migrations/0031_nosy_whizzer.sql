-- wrapped_cache gains `scope` (the Recalbox ids the recap covers) in its primary key.
--
-- Hand-corrected: drizzle-kit generated the usual rebuild-and-copy, but its INSERT read
-- "scope" from the old table, where the column does not exist yet — the migration could
-- never run. Existing rows are dropped rather than backfilled, which is safe and in fact
-- required: they were computed over EVERY box, so they are wrong under the new key, and
-- any scope value we invented for them would be a lie. wrapped_cache is a pure cache with
-- a regeneration path, so the next visit simply rebuilds the recap.
DROP TABLE `wrapped_cache`;--> statement-breakpoint
CREATE TABLE `wrapped_cache` (
	`year` integer NOT NULL,
	`locale` text NOT NULL,
	`scope` text NOT NULL,
	`data` text NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`year`, `locale`, `scope`)
);
