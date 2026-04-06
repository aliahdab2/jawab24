ALTER TABLE "waitlist_emails" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_emails" ADD COLUMN "phone" varchar(30);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_waitlist_phone_feature" ON "waitlist_emails" ("phone","feature");