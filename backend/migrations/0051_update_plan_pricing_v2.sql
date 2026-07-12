-- @not-journaled: superseded by seed-plans.ts — config/plans.ts is the source of
-- truth for price/replies and is upserted on every deploy. Kept for history.
-- Starter: $15, 500 replies (was 400)
UPDATE "plans" SET
  "max_ai_replies_per_month" = 500
WHERE "slug" = 'starter';--> statement-breakpoint
-- Business: $29, 2000 replies (was $39, 3000)
UPDATE "plans" SET
  "price" = 2900,
  "max_ai_replies_per_month" = 2500
WHERE "slug" = 'business';
