CREATE TABLE IF NOT EXISTS "conversation_pauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"sender_id" varchar(255) NOT NULL,
	"paused_until" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD COLUMN "handoff_pause_duration_minutes" integer DEFAULT 30;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversation_pauses_page_sender" ON "conversation_pauses" ("page_id","sender_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_pauses" ADD CONSTRAINT "conversation_pauses_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
