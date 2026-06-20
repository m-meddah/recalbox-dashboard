CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`recalbox_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_token_hash_unique` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_agent_tokens_recalbox` ON `agent_tokens` (`recalbox_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_tokens_token_hash` ON `agent_tokens` (`token_hash`);