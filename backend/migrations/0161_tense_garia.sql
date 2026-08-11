ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "zid_store_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscriptions_zid_store_id" ON "subscriptions" USING btree ("zid_store_id") WHERE "subscriptions"."payment_method" = 'zid' AND "subscriptions"."status" IS DISTINCT FROM 'canceled';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_zid_store_id_required" CHECK ("subscriptions"."payment_method" IS DISTINCT FROM 'zid' OR "subscriptions"."zid_store_id" IS NOT NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
