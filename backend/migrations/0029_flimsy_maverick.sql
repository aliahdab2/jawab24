ALTER TABLE "instagram_comments" ADD COLUMN "resolved" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_resolved" ON "instagram_comments" ("resolved");