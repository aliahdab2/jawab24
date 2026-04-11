CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"source_type" varchar(20) DEFAULT 'message' NOT NULL,
	"source_id" uuid,
	"sender_id" varchar(255) NOT NULL,
	"sender_name" varchar(255),
	"phone" varchar(50) NOT NULL,
	"extracted_data" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"extraction_status" varchar(20) DEFAULT 'completed' NOT NULL,
	"extraction_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leads_page_id" ON "leads" ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_leads_sender_page" ON "leads" ("sender_id","page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leads_status" ON "leads" ("page_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leads_created_at" ON "leads" ("page_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
