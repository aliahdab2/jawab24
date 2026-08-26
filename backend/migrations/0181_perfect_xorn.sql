ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "salla_store_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscriptions_salla_store_id" ON "subscriptions" USING btree ("salla_store_id") WHERE "subscriptions"."payment_method" = 'salla' AND "subscriptions"."status" IS DISTINCT FROM 'canceled';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_salla_store_id_required" CHECK ("subscriptions"."payment_method" IS DISTINCT FROM 'salla' OR "subscriptions"."salla_store_id" IS NOT NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
