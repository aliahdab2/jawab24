-- Remove product limits from all plans — products are context for AI, not a monetization lever
UPDATE "plans" SET "max_products" = NULL;
