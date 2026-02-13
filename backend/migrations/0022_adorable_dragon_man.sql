ALTER TABLE "settings" ADD COLUMN "dual_reply_nudge" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "message" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- Data migration: copy from old columns to new columns
UPDATE templates SET message = COALESCE(translations->>'ar', translations->>'en', '') WHERE translations IS NOT NULL;--> statement-breakpoint
UPDATE settings SET dual_reply_nudge = COALESCE(dual_reply_config->>'ar', dual_reply_config->>'en', '') WHERE dual_reply_config IS NOT NULL;--> statement-breakpoint

ALTER TABLE "settings" DROP COLUMN IF EXISTS "dual_reply_config";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN IF EXISTS "translations";