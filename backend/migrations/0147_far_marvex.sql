ALTER TABLE "subscriptions" ADD COLUMN "shopify_shop_domain" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscriptions_shopify_shop_domain" ON "subscriptions" ("shopify_shop_domain") WHERE "payment_method" = 'shopify' AND "status" IS DISTINCT FROM 'canceled';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shopify_domain_required" CHECK ("payment_method" IS DISTINCT FROM 'shopify' OR "shopify_shop_domain" IS NOT NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
