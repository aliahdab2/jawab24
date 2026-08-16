CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"method" varchar(24) NOT NULL,
	"collected_by" varchar(16) NOT NULL,
	"covers_period_start" timestamp,
	"covers_period_end" timestamp,
	"commission_pct" integer DEFAULT 0 NOT NULL,
	"commission_cents" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'recorded' NOT NULL,
	"external_ref" varchar(255),
	"note" text,
	"idempotency_key" varchar(64),
	"recorded_by_user_id" uuid,
	"confirmed_by_admin_user_id" uuid,
	"paid_at" timestamp NOT NULL,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" IN ('stripe', 'cash', 'sham_cash', 'bank_transfer', 'other')),
	CONSTRAINT "payments_collected_by_check" CHECK ("payments"."collected_by" IN ('stripe', 'partner', 'admin')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('recorded', 'settled', 'void')),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_commission_sane" CHECK ("payments"."commission_pct" BETWEEN 0 AND 100 AND "payments"."commission_cents" BETWEEN 0 AND "payments"."amount_cents"),
	CONSTRAINT "payments_settled_consistency" CHECK (("payments"."status" = 'settled') = ("payments"."settled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_admin_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payments_user_id" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_payments_partner_id" ON "payments" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payments_paid_at" ON "payments" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "idx_payments_user_covers_end" ON "payments" USING btree ("user_id","covers_period_end");