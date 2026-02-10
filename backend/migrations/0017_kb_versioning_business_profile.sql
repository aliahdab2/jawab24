-- KB versioning columns
ALTER TABLE "pages" ADD COLUMN "kb_version" integer DEFAULT 1;
ALTER TABLE "pages" ADD COLUMN "kb_active_version" integer DEFAULT 1;
ALTER TABLE "pages" ADD COLUMN "kb_updated_at" timestamp;

-- Business profile (structured JSONB from Facebook sync)
ALTER TABLE "pages" ADD COLUMN "business_profile" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "pages" ADD COLUMN "business_profile_updated_at" timestamp;
