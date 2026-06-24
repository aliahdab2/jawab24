CREATE TABLE IF NOT EXISTS "kb_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text NOT NULL,
	"type" varchar(50) DEFAULT 'offering' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"source_gap_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_facts_page_id" ON "kb_facts" ("page_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kb_facts" ADD CONSTRAINT "kb_facts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
