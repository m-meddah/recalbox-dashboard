ALTER TABLE `sessions` ADD `classification` text;--> statement-breakpoint
CREATE INDEX `idx_sessions_classification` ON `sessions` (`classification`);--> statement-breakpoint
CREATE INDEX `idx_sessions_game_classification` ON `sessions` (`game_id`,`classification`);--> statement-breakpoint
-- DATA MIGRATION: backfill classification for all existing sessions.
-- Thresholds mirror CLASSIFICATION_THRESHOLDS in lib/sessions/classify.ts.
-- noise < 120s | bounce 120-599s | taste 600-1799s | meaningful 1800-7199s | marathon >= 7200s
UPDATE `sessions`
SET `classification` = CASE
  WHEN `duration_seconds` IS NULL OR `duration_seconds` < 120 THEN 'noise'
  WHEN `duration_seconds` < 600  THEN 'bounce'
  WHEN `duration_seconds` < 1800 THEN 'taste'
  WHEN `duration_seconds` < 7200 THEN 'meaningful'
  ELSE 'marathon'
END
WHERE `classification` IS NULL;