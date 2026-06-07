ALTER TABLE "comments" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderation_action" varchar(20);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderated_by" varchar(50);--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD COLUMN "moderation_action" varchar(20);--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD COLUMN "moderated_by" varchar(50);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_hidden_at" ON "comments" ("hidden_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_hidden_at" ON "instagram_comments" ("hidden_at");