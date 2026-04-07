ALTER TABLE "instagram_media" ADD COLUMN "trigger_keyword" varchar(100);--> statement-breakpoint
ALTER TABLE "instagram_media" ADD COLUMN "trigger_reply" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "trigger_keyword" varchar(100);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "trigger_reply" text;