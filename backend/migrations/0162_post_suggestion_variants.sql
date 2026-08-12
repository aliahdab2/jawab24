-- «بوست اليوم» variants: one generation now returns SEVERAL takes on the same
-- subject and the merchant picks, instead of one take that the next regenerate
-- destroys (prod 2026-08-11: a page's best post of the day was overwritten by
-- its own third attempt). Industry norm — Meta Business Suite drafts 3–5
-- captions, Copy.ai/Predis/Ocoya all return variant sets.
--
-- Shape: ONE row per generation still (the cron partial-unique index and the
-- daily cap both count GENERATIONS, and neither changes). The takes live in a
-- JSONB array, and text/image_url/image_key keep mirroring the SELECTED take —
-- so already-shipped mobile bundles, which know nothing about variants, keep
-- rendering the right post from the columns they already read.
ALTER TABLE "post_suggestions" ADD COLUMN "variants" jsonb;--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD COLUMN "selected_variant" integer DEFAULT 0 NOT NULL;
