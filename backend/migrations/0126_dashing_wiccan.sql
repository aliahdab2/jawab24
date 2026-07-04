DROP INDEX IF EXISTS "idx_pages_whatsapp_phone_number_id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_pages_whatsapp_phone_number_id" ON "pages" ("whatsapp_phone_number_id");