CREATE TABLE "content_cta_classifications" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"platform" varchar(20) NOT NULL,
	"page_id" uuid NOT NULL,
	"caption_hash" varchar(64) NOT NULL,
	"cta_symbol" varchar(16) NOT NULL,
	"cta_word" text,
	"confidence" double precision NOT NULL,
	"evidence" text,
	"model" varchar(100) NOT NULL,
	"classified_at" timestamp DEFAULT now() NOT NULL,
	"uninvited_skips" integer DEFAULT 0 NOT NULL,
	"shadow_skips" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_cta_classifications" ADD CONSTRAINT "content_cta_classifications_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_cta_page_id" ON "content_cta_classifications" USING btree ("page_id");