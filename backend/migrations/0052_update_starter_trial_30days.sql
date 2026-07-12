-- @not-journaled: superseded by seed-plans.ts — trialDays comes from config/plans.ts
-- and is upserted on every deploy. Kept for history.
-- Starter: 30-day trial (was 15 days)
UPDATE "plans" SET
  "trial_days" = 30
WHERE "slug" = 'starter';
