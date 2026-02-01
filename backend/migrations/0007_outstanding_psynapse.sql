ALTER TABLE "comments" ADD COLUMN "needs_attention" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "flag_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai_intent" varchar(50);--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD COLUMN "needs_attention" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD COLUMN "flag_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD COLUMN "ai_intent" varchar(50);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_needs_attention" ON "comments" ("needs_attention");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_needs_attention" ON "instagram_comments" ("needs_attention");