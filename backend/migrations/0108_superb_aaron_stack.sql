CREATE TABLE IF NOT EXISTS "topup_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pack" varchar(16) NOT NULL,
	"replies_added" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"source" varchar(16) DEFAULT 'stripe' NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"external_ref" varchar(255),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"succeeded_at" timestamp,
	"refunded_at" timestamp,
	CONSTRAINT "topup_purchases_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "topup_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_topup_purchases_user_id" ON "topup_purchases" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_topup_purchases_status" ON "topup_purchases" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_topup_purchases_source" ON "topup_purchases" ("source");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_purchases" ADD CONSTRAINT "topup_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_purchases" ADD CONSTRAINT "topup_purchases_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed', 'refunded'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_purchases" ADD CONSTRAINT "topup_purchases_source_check" CHECK ("source" IN ('stripe', 'manual', 'admin'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_purchases" ADD CONSTRAINT "topup_purchases_stripe_id_required" CHECK ("source" != 'stripe' OR "stripe_payment_intent_id" IS NOT NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
