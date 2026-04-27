ALTER TABLE "users" ADD COLUMN "last_active_workspace_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_last_active_workspace_id_workspaces_id_fk" FOREIGN KEY ("last_active_workspace_id") REFERENCES "workspaces"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Backfill last_active_workspace_id for existing users using the same heuristic the runtime
-- resolver uses: workspace with the most connected pages, then owner-first, then oldest membership.
-- Multi-workspace users (e.g. invitees with an orphan empty solo workspace) end up routed to
-- the workspace they actually work in. Users with a single membership get that single one.
-- Users with zero memberships are left null (they hit the existing NO_WORKSPACE 404 path).
UPDATE "users" u
SET "last_active_workspace_id" = (
    SELECT wm."workspace_id"
    FROM "workspace_members" wm
    LEFT JOIN (
        SELECT "workspace_id", COUNT(*) FILTER (WHERE "access_token" IS NOT NULL AND "access_token" <> '') AS connected_pages
        FROM "pages"
        GROUP BY "workspace_id"
    ) p ON p."workspace_id" = wm."workspace_id"
    WHERE wm."user_id" = u."id"
    ORDER BY COALESCE(p.connected_pages, 0) DESC,
             CASE WHEN wm."role" = 'owner' THEN 0 ELSE 1 END,
             wm."joined_at" ASC
    LIMIT 1
)
WHERE u."last_active_workspace_id" IS NULL;
