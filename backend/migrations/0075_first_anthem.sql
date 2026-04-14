CREATE TABLE IF NOT EXISTS "waitlist_email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"feature" varchar(50),
	"sent_by" uuid NOT NULL,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "waitlist_email_sends" ADD CONSTRAINT "waitlist_email_sends_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
