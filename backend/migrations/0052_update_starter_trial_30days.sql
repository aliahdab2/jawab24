-- Starter: 30-day trial (was 15 days)
UPDATE "plans" SET
  "trial_days" = 30
WHERE "slug" = 'starter';
