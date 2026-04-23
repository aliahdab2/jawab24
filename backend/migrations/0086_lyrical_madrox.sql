CREATE TABLE IF NOT EXISTS "lead_digest_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(32) NOT NULL,
	"lead_count" integer NOT NULL,
	"lang" varchar(10),
	"resend_email_id" varchar(255),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_digest_sends_user_id" ON "lead_digest_sends" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_digest_sends_created_at" ON "lead_digest_sends" ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_digest_sends" ADD CONSTRAINT "lead_digest_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
