ALTER TABLE "messages" ADD COLUMN "needs_attention" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "flag_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ai_intent" varchar(50);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_needs_attention" ON "messages" ("needs_attention");