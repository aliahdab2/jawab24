ALTER TABLE "leads" ADD COLUMN "digest_emailed_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leads_digest_emailed_at" ON "leads" ("digest_emailed_at");