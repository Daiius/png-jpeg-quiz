CREATE TABLE `question_overlay_asset` (
	`id` varchar(64) NOT NULL,
	`question_id` varchar(64) NOT NULL,
	`jpeg_quality` int NOT NULL,
	`chroma_subsampling` enum('4:2:0','4:4:4') NOT NULL,
	`metric` enum('de00','ssim') NOT NULL,
	`object_key` varchar(255) NOT NULL,
	`renderer_version` varchar(64) NOT NULL,
	`bytes` int,
	`content_type` varchar(64),
	`sha256` varchar(64),
	`uploaded_at` timestamp,
	CONSTRAINT `question_overlay_asset_id` PRIMARY KEY(`id`),
	CONSTRAINT `question_overlay_asset_object_key_unique` UNIQUE(`object_key`),
	CONSTRAINT `question_overlay_asset_quad_uq` UNIQUE(`question_id`,`jpeg_quality`,`chroma_subsampling`,`metric`)
);
--> statement-breakpoint
ALTER TABLE `question_encoding` ADD `de00_mean` double;--> statement-breakpoint
ALTER TABLE `question_encoding` ADD `de00_p99` double;--> statement-breakpoint
ALTER TABLE `question_encoding` ADD `de00_max` double;--> statement-breakpoint
ALTER TABLE `question_encoding` ADD `de00_over2_pct` double;