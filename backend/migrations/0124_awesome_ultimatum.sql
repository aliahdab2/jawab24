CREATE TABLE IF NOT EXISTS "ai_cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage_date" date NOT NULL,
	"api_key_id" varchar(64) DEFAULT '' NOT NULL,
	"model" varchar(100) DEFAULT '' NOT NULL,
	"line_item" varchar(100) DEFAULT '' NOT NULL,
	"amount_usd" numeric(14, 6) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"source" varchar(32) DEFAULT 'openai_costs' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_credit_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_usd" numeric(14, 2) NOT NULL,
	"anchored_at" date NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_cost_snapshots_grain" ON "ai_cost_snapshots" ("usage_date","api_key_id","model","line_item");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_cost_snapshots_date" ON "ai_cost_snapshots" ("usage_date");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_credit_balance" ADD CONSTRAINT "ai_credit_balance_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
