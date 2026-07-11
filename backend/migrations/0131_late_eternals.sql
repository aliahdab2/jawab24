ALTER TABLE "catalog_items" ADD COLUMN "starts_at" date;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "ends_at" date;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "attributes" jsonb;