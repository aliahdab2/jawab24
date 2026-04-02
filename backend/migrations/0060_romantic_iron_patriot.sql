ALTER TABLE "pages" ADD COLUMN "token_last_verified_at" timestamp;

-- Backfill: set last verified to updated_at for active pages
-- so they don't all get checked in the first sweep
UPDATE "pages"
SET "token_last_verified_at" = "updated_at"
WHERE "access_token" != '' AND "access_token" IS NOT NULL;