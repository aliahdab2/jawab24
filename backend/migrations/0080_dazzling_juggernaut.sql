-- Deploy 2 (Migrate + Contract collapsed): backfill workspace_id on existing inbox rows
-- and promote the column to NOT NULL on all three tables.
--
-- Deploy 1 (migration 0079) added workspace_id as nullable + indexes + FKs and threaded
-- the column through every write path in app code. Old rows (pre-Deploy 1) and any rows
-- written during the schema-ahead-of-code window still have NULL workspace_id. This
-- migration backfills them by joining through the owning page, then locks the column.
--
-- Total rows at backfill time on prod: ~12k (9408 messages, 2633 comments, 12 IG comments).
-- Runs in a single transaction in well under a second; safe at this scale. For larger
-- tables, split the backfill into chunks before applying SET NOT NULL.
--
-- The NOT NULL step will FAIL the entire migration if any row's owning page has a NULL
-- workspace_id (orphaned data). Verified clean on prod beforehand: SELECT COUNT(*) FROM
-- pages WHERE workspace_id IS NULL = 0.

UPDATE "comments" c
   SET "workspace_id" = p."workspace_id"
  FROM "posts" po
  JOIN "pages" p ON po."page_id" = p."id"
 WHERE c."post_id" = po."id"
   AND c."workspace_id" IS NULL;
--> statement-breakpoint

UPDATE "instagram_comments" ic
   SET "workspace_id" = p."workspace_id"
  FROM "instagram_media" im
  JOIN "pages" p ON im."page_id" = p."id"
 WHERE ic."media_id" = im."id"
   AND ic."workspace_id" IS NULL;
--> statement-breakpoint

UPDATE "messages" m
   SET "workspace_id" = p."workspace_id"
  FROM "pages" p
 WHERE m."page_id" = p."id"
   AND m."workspace_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "comments" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_comments" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "workspace_id" SET NOT NULL;
