ALTER TABLE `agent_tokens` ADD `agent_version` text;--> statement-breakpoint
ALTER TABLE `recalboxes` ADD `agent_channel` text DEFAULT 'stable' NOT NULL;