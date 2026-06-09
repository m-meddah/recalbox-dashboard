ALTER TABLE `recalboxes` ADD `owner_user_id` text;--> statement-breakpoint
CREATE INDEX `idx_recalboxes_owner` ON `recalboxes` (`owner_user_id`);