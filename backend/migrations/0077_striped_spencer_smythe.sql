CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"sender_id" varchar(255) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"sender_name" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversations_page_sender" ON "conversations" ("page_id","sender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_page_id" ON "conversations" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_conversation_id" ON "messages" ("conversation_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Backfill: create one conversation row per distinct (page_id, sender_id) in messages,
-- then link every message to its conversation. Idempotent — safe to re-run.
--
-- sender_name: the most recent non-null name from any message for this sender
--   (picked via array_agg with ORDER BY and FILTER — the Postgres idiom for "latest non-null").
-- platform: any non-null platform string, falling back to 'facebook' for pre-platform-column rows.
INSERT INTO "conversations" (id, page_id, sender_id, platform, sender_name, created_at, updated_at)
SELECT
    gen_random_uuid(),
    page_id,
    sender_id,
    COALESCE(MAX(platform) FILTER (WHERE platform IS NOT NULL), 'facebook'),
    (array_agg(sender_name ORDER BY created_at DESC)
     FILTER (WHERE sender_name IS NOT NULL AND sender_name != ''))[1],
    MIN(created_at),
    NOW()
FROM "messages"
WHERE page_id IS NOT NULL
GROUP BY page_id, sender_id
ON CONFLICT (page_id, sender_id) DO NOTHING;
--> statement-breakpoint

-- Link every existing message to its conversation. Only updates rows where
-- conversation_id is currently NULL, so re-running is a no-op.
UPDATE "messages" m
SET conversation_id = c.id
FROM "conversations" c
WHERE m.page_id = c.page_id
  AND m.sender_id = c.sender_id
  AND m.conversation_id IS NULL;
