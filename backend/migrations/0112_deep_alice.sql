CREATE TABLE IF NOT EXISTS "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"description" varchar(500),
	"stripe_checkout_session_id" varchar(255) NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"topup_purchase_id" uuid,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_by_admin_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_requests_user_id" ON "payment_requests" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_requests_status" ON "payment_requests" ("status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_topup_purchase_id_topup_purchases_id_fk" FOREIGN KEY ("topup_purchase_id") REFERENCES "topup_purchases"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_created_by_admin_user_id_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_status_check" CHECK ("status" IN ('pending', 'paid', 'expired'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_amount_positive" CHECK ("amount_cents" > 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
