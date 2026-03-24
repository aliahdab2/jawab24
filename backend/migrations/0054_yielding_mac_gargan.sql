DROP INDEX IF EXISTS "idx_conversation_pauses_page_sender";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_messages_escalation" ON "messages" ("replied","needs_attention","direction","created_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversation_pauses_page_sender" ON "conversation_pauses" ("page_id","sender_id","paused_until");
