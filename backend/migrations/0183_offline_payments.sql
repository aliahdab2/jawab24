CREATE TABLE "offline_payment_receipts" (
	"offline_payment_id" uuid PRIMARY KEY NOT NULL,
	"mime_type" varchar(32) NOT NULL,
	"byte_length" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rail" varchar(32) NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_interval" varchar(5) NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"transfer_reference" varchar(64) NOT NULL,
	"transfer_reference_normalized" varchar(64) NOT NULL,
	"sender_name" varchar(120),
	"note" varchar(500),
	"status" varchar(16) DEFAULT 'pending_review' NOT NULL,
	"review_note" varchar(500),
	"reviewed_by_admin_user_id" uuid,
	"reviewed_at" timestamp,
	"granted_subscription_id" uuid,
	"granted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offline_payments_status_check" CHECK ("offline_payments"."status" IN ('pending_review', 'approved', 'rejected')),
	CONSTRAINT "offline_payments_interval_check" CHECK ("offline_payments"."billing_interval" IN ('month', 'year')),
	CONSTRAINT "offline_payments_amount_positive" CHECK ("offline_payments"."amount_cents" > 0),
	CONSTRAINT "offline_payments_review_consistency" CHECK (("offline_payments"."status" = 'pending_review') = ("offline_payments"."reviewed_at" IS NULL)),
	CONSTRAINT "offline_payments_grant_consistency" CHECK (("offline_payments"."status" = 'approved') = ("offline_payments"."granted_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "offline_payment_receipts" ADD CONSTRAINT "offline_payment_receipts_offline_payment_id_offline_payments_id_fk" FOREIGN KEY ("offline_payment_id") REFERENCES "public"."offline_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_reviewed_by_admin_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_granted_subscription_id_subscriptions_id_fk" FOREIGN KEY ("granted_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_offline_payments_user" ON "offline_payments" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_offline_payments_status" ON "offline_payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_offline_payments_reference" ON "offline_payments" USING btree ("rail","transfer_reference_normalized") WHERE "offline_payments"."status" <> 'rejected';