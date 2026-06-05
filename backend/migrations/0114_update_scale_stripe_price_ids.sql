-- Stripe price IDs for the hidden high-volume Scale plans
--   Scale 20K → $149/mo, Scale 30K → $199/mo (recurring, monthly).
--
-- Manual data script — like 0053_update_stripe_price_ids.sql, this is NOT registered
-- in meta/_journal.json, so drizzle's migrate() does NOT run it automatically. Apply it
-- by hand to each env AFTER the plans are seeded (seed-plans.ts never sets Stripe IDs).
-- The IDs below are LIVE-mode; a test/staging env should use its own test-mode price IDs.
--
-- Until these are set, change-plan/checkout to a Scale plan returns
-- 400 "Plan does not have a Stripe Price ID configured".
UPDATE "plans" SET "stripe_price_id" = 'price_1TeqxiRrBx8E7qRi9BEWzdxT' WHERE "slug" = 'scale-20k';
UPDATE "plans" SET "stripe_price_id" = 'price_1TeqyVRrBx8E7qRiBYJqZ34p' WHERE "slug" = 'scale-30k';
