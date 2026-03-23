-- Update Stripe price IDs for new pricing ($15/$39/$79)
UPDATE "plans" SET "stripe_price_id" = 'price_1TE8EtRrBx8E7qRi9TE0MJHe' WHERE "slug" = 'starter';
UPDATE "plans" SET "stripe_price_id" = 'price_1TE8EuRrBx8E7qRifnELAcnh' WHERE "slug" = 'business';
UPDATE "plans" SET "stripe_price_id" = 'price_1TE8EvRrBx8E7qRifGlPsLNe' WHERE "slug" = 'pro';
