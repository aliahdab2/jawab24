ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id");