ALTER TABLE "workspace_invites" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "phone" varchar(20);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workspace_invites_ws_phone" ON "workspace_invites" ("workspace_id","phone");