ALTER TABLE "settings" ADD COLUMN "greeting_message_multi" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "away_message_multi" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "dual_reply_nudge_multi" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "away_message_ar";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "away_message_en";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "greeting_message_ar";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "greeting_message_en";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "away_message_source_lang";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "greeting_message_source_lang";