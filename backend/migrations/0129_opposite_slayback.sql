-- Stage 2 v1 leftover (PR #190, reverted 2026-05-24): databases that ran the v1
-- migration still carry its catalog_items table (price_minor / metadata /
-- archived_at shape) with orphaned rows no code has read since the revert.
-- Without this, CREATE TABLE IF NOT EXISTS below would silently keep the wrong
-- shape. Detect the v1 signature column and drop the dead table first.
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'catalog_items' AND column_name = 'price_minor'
 ) THEN
  DROP TABLE "catalog_items";
 END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"type" varchar(50) DEFAULT 'product' NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"price" numeric(12, 2),
	"currency" varchar(10),
	"image_url" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_catalog_items_page_id" ON "catalog_items" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_catalog_items_page_sort" ON "catalog_items" ("page_id","sort_order");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
