CREATE TABLE `agent_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`recalbox_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`claimed_at` integer,
	`completed_at` integer,
	`result` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_commands_recalbox_status` ON `agent_commands` (`recalbox_id`,`status`);