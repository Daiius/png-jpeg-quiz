CREATE TABLE `encode_profile` (
	`id` varchar(32) NOT NULL,
	`jpeg_quality` int NOT NULL,
	`chroma_subsampling` enum('4:2:0','4:4:4') NOT NULL,
	`png_optimize` boolean NOT NULL,
	`is_standard` boolean NOT NULL DEFAULT false,
	`png_options` json NOT NULL,
	`jpeg_options` json NOT NULL,
	`preprocess` json NOT NULL,
	`tool_versions` json NOT NULL,
	`published_label` varchar(255) NOT NULL,
	`png_win_rate` double NOT NULL DEFAULT 0,
	CONSTRAINT `encode_profile_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `question` (
	`id` varchar(64) NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`category` enum('photo','illustration','screenshot','pixel-art','render','synthetic') NOT NULL,
	`color_count` int NOT NULL,
	`flat_ratio` double NOT NULL,
	`tags` json NOT NULL,
	`is_synthetic` boolean NOT NULL DEFAULT false,
	`derivation` json,
	`source` json NOT NULL,
	`explanation` text,
	`status` enum('draft','published','retired') NOT NULL DEFAULT 'draft',
	CONSTRAINT `question_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `question_display_asset` (
	`question_id` varchar(64) NOT NULL,
	`object_key` varchar(255) NOT NULL,
	`bytes` int NOT NULL,
	`content_type` varchar(64) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`uploaded_at` timestamp,
	CONSTRAINT `question_display_asset_question_id` PRIMARY KEY(`question_id`),
	CONSTRAINT `question_display_asset_object_key_unique` UNIQUE(`object_key`)
);
--> statement-breakpoint
CREATE TABLE `question_encoded_asset` (
	`id` varchar(64) NOT NULL,
	`question_id` varchar(64) NOT NULL,
	`profile_id` varchar(32) NOT NULL,
	`kind` enum('png','jpeg') NOT NULL,
	`object_key` varchar(255) NOT NULL,
	`bytes` int,
	`content_type` varchar(64),
	`sha256` varchar(64),
	`uploaded_at` timestamp,
	CONSTRAINT `question_encoded_asset_id` PRIMARY KEY(`id`),
	CONSTRAINT `question_encoded_asset_object_key_unique` UNIQUE(`object_key`),
	CONSTRAINT `question_encoded_asset_triple_uq` UNIQUE(`question_id`,`profile_id`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `question_encoding` (
	`question_id` varchar(64) NOT NULL,
	`profile_id` varchar(32) NOT NULL,
	`png_bytes` int NOT NULL,
	`jpeg_bytes` int NOT NULL,
	`answer` enum('png','jpeg') NOT NULL,
	`log2_ratio` double NOT NULL,
	`difficulty` double NOT NULL,
	CONSTRAINT `question_encoding_question_id_profile_id_pk` PRIMARY KEY(`question_id`,`profile_id`)
);
--> statement-breakpoint
CREATE TABLE `question_stats` (
	`question_id` varchar(64) NOT NULL,
	`profile_id` varchar(32) NOT NULL,
	`shown` int NOT NULL DEFAULT 0,
	`correct` int NOT NULL DEFAULT 0,
	`avg_elapsed_ms` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `question_stats_question_id_profile_id_pk` PRIMARY KEY(`question_id`,`profile_id`)
);
--> statement-breakpoint
CREATE TABLE `score_entry` (
	`id` varchar(64) NOT NULL,
	`session_id` varchar(64) NOT NULL,
	`display_name` varchar(64),
	`mode` varchar(32) NOT NULL,
	`profile_id` varchar(32) NOT NULL,
	`score` double NOT NULL,
	`correct_count` int NOT NULL,
	`max_streak` int NOT NULL,
	`question_count` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`flagged` boolean NOT NULL DEFAULT false,
	CONSTRAINT `score_entry_id` PRIMARY KEY(`id`),
	CONSTRAINT `score_entry_session_id_unique` UNIQUE(`session_id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(64) NOT NULL,
	`secret` varchar(128) NOT NULL,
	`mode` varchar(32) NOT NULL,
	`profile_id` varchar(32) NOT NULL,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	`status` enum('active','finished','abandoned') NOT NULL DEFAULT 'active',
	`current_index` int NOT NULL DEFAULT 0,
	`question_count` int NOT NULL,
	`correct_count` int NOT NULL DEFAULT 0,
	`streak` int NOT NULL DEFAULT 0,
	`max_streak` int NOT NULL DEFAULT 0,
	`score` double NOT NULL DEFAULT 0,
	`display_name` varchar(64),
	`client_meta` json,
	CONSTRAINT `session_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_question` (
	`session_id` varchar(64) NOT NULL,
	`question_index` int NOT NULL,
	`question_id` varchar(64) NOT NULL,
	`profile_id` varchar(32) NOT NULL,
	`served_at` timestamp NOT NULL DEFAULT (now()),
	`answered_at` timestamp,
	`answer` enum('png','jpeg'),
	`is_correct` boolean,
	`elapsed_ms` int,
	`awarded_points` double,
	`difficulty_at_serve` double NOT NULL,
	CONSTRAINT `session_question_session_id_question_index_pk` PRIMARY KEY(`session_id`,`question_index`),
	CONSTRAINT `session_question_unique_question` UNIQUE(`session_id`,`question_id`)
);
--> statement-breakpoint
CREATE INDEX `question_encoding_pick_idx` ON `question_encoding` (`profile_id`,`difficulty`);--> statement-breakpoint
CREATE INDEX `question_encoding_answer_idx` ON `question_encoding` (`profile_id`,`answer`);--> statement-breakpoint
CREATE INDEX `score_entry_rank_idx` ON `score_entry` (`mode`,`score`);--> statement-breakpoint
CREATE INDEX `score_entry_daily_idx` ON `score_entry` (`mode`,`created_at`);--> statement-breakpoint
CREATE INDEX `session_question_stats_idx` ON `session_question` (`question_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `session_question_answered_idx` ON `session_question` (`answered_at`);