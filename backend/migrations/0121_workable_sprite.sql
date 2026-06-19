ALTER TABLE "leads" ADD COLUMN "needs_follow_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "follow_up_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "follow_up_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leads_needs_follow_up" ON "leads" ("page_id","needs_follow_up");