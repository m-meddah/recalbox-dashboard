CREATE TABLE `artwork` (
	`recalbox_id` text NOT NULL,
	`box_path` text NOT NULL,
	`url` text,
	`content_type` text,
	`wanted_at` integer,
	`uploaded_at` integer,
	PRIMARY KEY(`recalbox_id`, `box_path`)
);
--> statement-breakpoint
CREATE INDEX `idx_artwork_recalbox_uploaded` ON `artwork` (`recalbox_id`,`uploaded_at`);