ALTER TABLE "post_suggestions" ADD COLUMN "publish_state" varchar(20) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD COLUMN "published_post_id" text;--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD COLUMN "publish_error" text;--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD COLUMN "publish_claimed_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_post_suggestions_published_post" ON "post_suggestions" USING btree ("published_post_id") WHERE published_post_id IS NOT NULL;