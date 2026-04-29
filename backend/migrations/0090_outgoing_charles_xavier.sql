ALTER TABLE "lead_digest_sends" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "lead_digest_muted_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_digest_sends_workspace_id" ON "lead_digest_sends" ("workspace_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_digest_sends" ADD CONSTRAINT "lead_digest_sends_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
