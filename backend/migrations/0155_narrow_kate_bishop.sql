CREATE TABLE "post_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"suggested_for" date NOT NULL,
	"source" varchar(20) NOT NULL,
	"post_type" varchar(30),
	"text" text NOT NULL,
	"image_url" text,
	"image_key" text,
	"status" varchar(20) DEFAULT 'ready' NOT NULL,
	"opened_at" timestamp,
	"copied_at" timestamp,
	"downloaded_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "post_suggestions" ADD CONSTRAINT "post_suggestions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_post_suggestions_page_date" ON "post_suggestions" USING btree ("page_id","suggested_for");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_post_suggestions_cron_once" ON "post_suggestions" USING btree ("page_id","suggested_for") WHERE source = 'cron';