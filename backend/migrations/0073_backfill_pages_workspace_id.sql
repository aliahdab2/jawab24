-- Backfill workspace_id for pages connected before the workspace feature was introduced
-- (migration 0034 added the column as nullable with no backfill).
-- For each page with workspace_id IS NULL, assign the workspace owned by the page's user.
-- This restores visibility for all pre-workspace pages so members can see the owner's pages.
UPDATE "pages"
SET "workspace_id" = w."id"
FROM "workspaces" w
WHERE "pages"."workspace_id" IS NULL
  AND "pages"."user_id" IS NOT NULL
  AND w."owner_id" = "pages"."user_id";
