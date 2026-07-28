-- Constraints the generated 0141 could not express (drizzle-kit 0.20 emits
-- neither CHECK constraints nor partial/unique composite indexes for these).
-- Written by hand, same precedent as the pgvector columns.

-- 1. `source` is a trust label the renderer's wording depends on: only the
--    merchant's own authorship may create a collection. The schema comment said
--    fb_sync is invalid here; nothing enforced it, so a future sync path could
--    have written one and the AI would have spoken an unconfirmed Facebook list
--    as if the merchant had authored it (D-046 forbids exactly that).
DO $$ BEGIN
 ALTER TABLE "fact_collections"
   ADD CONSTRAINT "fact_collections_source_check"
   CHECK ("source" IN ('kb_extract', 'editor'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 2. One collection per label per page. Two collections sharing a label render
--    TWO blocks each with its own coverage statement; if their completeness
--    differs, the prompt carries contradictory absence directives for the same
--    list and the reply becomes unpredictable. A re-import must update the
--    existing collection, not silently add a rival.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fact_collections_page_label"
  ON "fact_collections" ("page_id", "label");
