-- Starter: $15, 400 replies, no e-commerce, 15-day trial
UPDATE "plans" SET
  "price" = 1500,
  "max_ai_replies_per_month" = 400,
  "ecommerce_enabled" = false,
  "trial_days" = 15
WHERE "slug" = 'starter';--> statement-breakpoint
-- Business: $39, 3000 replies
UPDATE "plans" SET
  "price" = 3900,
  "max_ai_replies_per_month" = 3000
WHERE "slug" = 'business';--> statement-breakpoint
-- Pro: $79, 10000 replies
UPDATE "plans" SET
  "price" = 7900,
  "max_ai_replies_per_month" = 10000
WHERE "slug" = 'pro';
