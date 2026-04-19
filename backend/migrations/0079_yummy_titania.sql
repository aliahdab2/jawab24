-- Deploy 1 of 3 (Expand): adds workspace_id column + composite index + FK on comments,
-- instagram_comments, and messages. Column starts nullable; deferred backfill runs via
-- scripts/backfill-workspace-id.ts in Deploy 2, then NOT NULL tightening in Deploy 3.
--
-- Note for large tables in production: if any of these tables have grown significantly and
-- this migration causes noticeable write lock, drop this file and instead apply the DDL
-- manually with `CREATE INDEX CONCURRENTLY` and `ADD CONSTRAINT ... NOT VALID` during a
-- low-traffic window, then insert a row into `__drizzle_migrations` to mark it applied.
-- Plain CREATE INDEX is safe at current scale (column is all-NULL when added).
ALTER TABLE "comments" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_workspace_created_at" ON "comments" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ig_comments_workspace_created_at" ON "instagram_comments" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_workspace_created_at" ON "messages" ("workspace_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instagram_comments" ADD CONSTRAINT "instagram_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
