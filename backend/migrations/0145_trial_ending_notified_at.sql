ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_ending_notified_at" timestamp;--> statement-breakpoint
-- Partial index: the reminder cron scans only un-warned trials, which is a tiny
-- slice of the table. Without the predicate the index would carry every
-- already-warned row for no benefit.
CREATE INDEX IF NOT EXISTS "idx_subscriptions_trial_reminder"
    ON "subscriptions" ("trial_ends_at")
    WHERE "trial_ending_notified_at" IS NULL;
