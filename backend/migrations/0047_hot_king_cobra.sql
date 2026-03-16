ALTER TABLE "plans" ALTER COLUMN "max_templates" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "max_rules" SET DEFAULT 7;--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "ecommerce_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_products" integer DEFAULT 50;--> statement-breakpoint
-- Enable e-commerce on Starter plan with 50 product limit
UPDATE "plans" SET "ecommerce_enabled" = true, "max_products" = 50 WHERE "slug" = 'starter';--> statement-breakpoint
-- Business: 200 product limit, 2 pages
UPDATE "plans" SET "max_products" = 200, "max_pages" = 2 WHERE "slug" = 'business';--> statement-breakpoint
-- Pro: unlimited products, 5 pages
UPDATE "plans" SET "max_products" = NULL, "max_pages" = 5 WHERE "slug" = 'pro';