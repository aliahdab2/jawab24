-- @not-journaled: obsolete — plans.maxProducts is not enforced anywhere (see
-- services/ecommerce.ts). No-op on a fresh DB. Kept for history.
-- Remove product limits from all plans — products are context for AI, not a monetization lever
UPDATE "plans" SET "max_products" = NULL;
