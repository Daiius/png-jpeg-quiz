ALTER TABLE `session_question` MODIFY COLUMN `served_at` timestamp(3) NOT NULL DEFAULT (now());--> statement-breakpoint
ALTER TABLE `session_question` MODIFY COLUMN `answered_at` timestamp(3);