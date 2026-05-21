ALTER TABLE "pages" ADD COLUMN "consecutive_send_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "auto_pause_reason" varchar(30);--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "auto_paused_at" timestamp;