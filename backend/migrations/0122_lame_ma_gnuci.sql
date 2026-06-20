CREATE TABLE IF NOT EXISTS "trial_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_type" varchar(20) NOT NULL,
	"identity_hash" varchar(64) NOT NULL,
	"first_user_id" uuid,
	"first_trialed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_trial_grants_type_hash" ON "trial_grants" ("identity_type","identity_hash");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_first_user_id_users_id_fk" FOREIGN KEY ("first_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
