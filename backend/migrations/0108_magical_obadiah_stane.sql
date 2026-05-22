CREATE TABLE IF NOT EXISTS "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"price_minor" integer,
	"currency" varchar(8),
	"starts_at" timestamp,
	"ends_at" timestamp,
	"enrollment_closes_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"archived_at" timestamp,
	"source_tier" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_catalog_items_page_id" ON "catalog_items" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_catalog_items_page_type" ON "catalog_items" ("page_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_catalog_items_active" ON "catalog_items" ("page_id","archived_at","ends_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
