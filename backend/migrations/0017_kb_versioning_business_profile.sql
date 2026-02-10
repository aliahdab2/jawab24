ALTER TABLE "pages" ADD COLUMN "kb_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "kb_active_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "kb_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "business_profile" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "business_profile_updated_at" timestamp;