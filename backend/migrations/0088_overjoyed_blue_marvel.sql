CREATE TABLE IF NOT EXISTS "email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"to_email" varchar(255) NOT NULL,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"resend_email_id" varchar(255),
	"error_message" text,
	"user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_digest_sends" ADD COLUMN "email_send_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_sends_type" ON "email_sends" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_sends_created_at" ON "email_sends" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_sends_user_id" ON "email_sends" ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
