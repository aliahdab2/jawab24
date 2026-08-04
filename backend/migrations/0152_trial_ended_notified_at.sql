ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "trial_ended_notified_at" timestamp;--> statement-breakpoint
-- Partial index, same shape as idx_subscriptions_trial_reminder (0145): the
-- trial-ended sweep scans only un-notified rows, a tiny slice of the table.
CREATE INDEX IF NOT EXISTS "idx_subscriptions_trial_ended_notice"
    ON "subscriptions" ("trial_ends_at")
    WHERE "trial_ended_notified_at" IS NULL;
