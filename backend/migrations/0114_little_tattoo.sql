CREATE TABLE IF NOT EXISTS "channel_trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_type" varchar(20) NOT NULL,
	"channel_id" varchar(255) NOT NULL,
	"first_user_id" uuid,
	"first_workspace_id" uuid,
	"first_trialed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_channel_trials_type_id" ON "channel_trials" ("channel_type","channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_channel_trials_first_user_id" ON "channel_trials" ("first_user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_trials" ADD CONSTRAINT "channel_trials_first_user_id_users_id_fk" FOREIGN KEY ("first_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_trials" ADD CONSTRAINT "channel_trials_first_workspace_id_workspaces_id_fk" FOREIGN KEY ("first_workspace_id") REFERENCES "workspaces"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
