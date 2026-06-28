ALTER TABLE "pending_ecommerce_installs" ADD COLUMN "merchant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "pending_ecommerce_installs" ADD COLUMN "store_name" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_ecommerce_platform_merchant" ON "pending_ecommerce_installs" ("platform","merchant_id");