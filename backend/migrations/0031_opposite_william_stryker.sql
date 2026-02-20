CREATE TABLE IF NOT EXISTS "ai_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid,
	"model" varchar(100) NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"pipeline" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_log_user_id" ON "ai_usage_log" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_log_created_at" ON "ai_usage_log" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_log_user_date" ON "ai_usage_log" ("user_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
