ALTER TABLE "pages" ADD COLUMN "whatsapp_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "whatsapp_token_last_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "whatsapp_disconnect_reason" varchar(30);