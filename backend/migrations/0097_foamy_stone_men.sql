ALTER TABLE "instagram_media" ADD COLUMN "reply_to_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reply_to_all" boolean DEFAULT false NOT NULL;