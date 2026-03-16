-- Fix Business and Pro: enable e-commerce
UPDATE "plans" SET "ecommerce_enabled" = true WHERE "slug" IN ('business', 'pro');--> statement-breakpoint
-- Fix Starter: update templates (3→5) and rules (2→7) to new values
UPDATE "plans" SET "max_templates" = 5, "max_rules" = 7 WHERE "slug" = 'starter';
