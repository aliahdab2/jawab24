ALTER TABLE "plans" ADD COLUMN "stripe_yearly_price_id" varchar(255);--> statement-breakpoint
-- Set yearly Stripe price IDs
UPDATE "plans" SET "stripe_yearly_price_id" = 'price_1TE8EtRrBx8E7qRiIKnm37HB' WHERE "slug" = 'starter';
UPDATE "plans" SET "stripe_yearly_price_id" = 'price_1TE8EuRrBx8E7qRib2km68Sd' WHERE "slug" = 'business';
UPDATE "plans" SET "stripe_yearly_price_id" = 'price_1TE8EvRrBx8E7qRi7QsS1ckK' WHERE "slug" = 'pro';