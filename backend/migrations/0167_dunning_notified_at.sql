ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "renewal_failure_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "suspension_notified_at" timestamp;--> statement-breakpoint
-- Partial indexes, 0145 precedent (hand-amended: drizzle-kit drops .where()).
-- Each dunning sweep branch scans only un-notified past_due stripe rows — a
-- tiny slice of the table; a full-scope index would carry every stamped row
-- for no benefit.
CREATE INDEX IF NOT EXISTS "idx_subscriptions_dunning_failed"
    ON "subscriptions" ("updated_at")
    WHERE "renewal_failure_notified_at" IS NULL AND "status" = 'past_due' AND "payment_method" = 'stripe';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_dunning_suspension"
    ON "subscriptions" ("current_period_end")
    WHERE "suspension_notified_at" IS NULL AND "status" = 'past_due' AND "payment_method" = 'stripe';
