CREATE TABLE IF NOT EXISTS "fact_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"key_attr" varchar(60),
	"is_complete" boolean,
	"completeness_confirmed_at" timestamp,
	"source" varchar(20) DEFAULT 'kb_extract' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fact_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"attributes" jsonb,
	"price" numeric(12, 2),
	"currency" varchar(10),
	"starts_at" date,
	"ends_at" date,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fact_collections_page_id" ON "fact_collections" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fact_rows_collection_id" ON "fact_rows" ("collection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fact_rows_collection_sort" ON "fact_rows" ("collection_id","sort_order");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_collections" ADD CONSTRAINT "fact_collections_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fact_rows" ADD CONSTRAINT "fact_rows_collection_id_fact_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "fact_collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
