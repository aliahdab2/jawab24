-- Replace facebookMessageId/instagramMessageId with generic platformMessageId
-- Zero customers — safe to drop old columns

ALTER TABLE "messages" ADD COLUMN "platform_message_id" varchar(255);--> statement-breakpoint
UPDATE "messages" SET "platform_message_id" = COALESCE("instagram_message_id", REPLACE("facebook_message_id", 'ig_', ''), "facebook_message_id");--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "platform_message_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_platform_message_id" ON "messages" ("platform_message_id");--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_facebook_message_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_messages_facebook_message_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "facebook_message_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "instagram_message_id";
