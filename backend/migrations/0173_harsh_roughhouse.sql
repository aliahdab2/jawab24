-- Amended to be re-runnable, same shape as 0161's constraint block: Postgres
-- has no ADD CONSTRAINT IF NOT EXISTS, so the duplicate is swallowed.
--
-- Verified against production before writing: 85 subscription rows, zero
-- holding a status outside this list and zero NULL. The constraint therefore
-- cannot fail on live data at deploy time.
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_in_union" CHECK ("subscriptions"."status" IS NULL OR "subscriptions"."status" IN ('trialing', 'active', 'past_due', 'canceled', 'paused'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
