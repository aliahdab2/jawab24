ALTER TABLE "pages" ADD COLUMN "kb_indexed_version" integer;
--> statement-breakpoint
-- Conservative backfill (D-106). A page keeps its live generation ONLY when the chunk
-- index actually matches the pointer it was being filtered by; everything else becomes
-- NULL, which means "no live generation" and reads as the full-KB path.
--
-- This is what makes the split behaviour-identical on deploy. A page whose newest chunk
-- is older than kb_active_version returns 0 rows from retrieval TODAY (the filter is an
-- exact match), so NULL — skip retrieval, use the full KB — produces the same prompt
-- without the dead embedding round-trip. Copying kb_active_version across unconditionally
-- would instead REVIVE those orphaned indexes and start serving chunks built from older
-- KB text: a silent content change on live pages, and the exact regression this migration
-- must not cause.
UPDATE "pages" p
SET "kb_indexed_version" = p."kb_active_version"
WHERE p."kb_active_version" IS NOT NULL
  AND (
    SELECT max(k."kb_version") FROM "kb_chunks" k WHERE k."page_id" = p."id"
  ) = p."kb_active_version";
