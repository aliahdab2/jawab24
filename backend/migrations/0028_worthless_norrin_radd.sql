ALTER TABLE "comments" ADD COLUMN "resolved" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_resolved" ON "comments" ("resolved");