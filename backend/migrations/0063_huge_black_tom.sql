ALTER TABLE "pages" ADD COLUMN "whatsapp_phone_number_id" varchar(255);--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "whatsapp_business_account_id" varchar(255);--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "whatsapp_display_phone_number" varchar(30);--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "whatsapp_auto_reply_enabled" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_whatsapp_phone_number_id" ON "pages" ("whatsapp_phone_number_id");