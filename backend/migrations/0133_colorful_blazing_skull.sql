CREATE TABLE IF NOT EXISTS "trial_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"reason" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_ended_emailed_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trial_feedback_user_id" ON "trial_feedback" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trial_feedback_created_at" ON "trial_feedback" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_trial_ends_at" ON "subscriptions" ("trial_ends_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trial_feedback" ADD CONSTRAINT "trial_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trial_feedback" ADD CONSTRAINT "trial_feedback_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
