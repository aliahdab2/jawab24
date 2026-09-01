CREATE TABLE "invoice_documents" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"mime_type" varchar(32) DEFAULT 'application/pdf' NOT NULL,
	"byte_length" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(32) NOT NULL,
	"series" varchar(8) DEFAULT 'JW24' NOT NULL,
	"year" integer NOT NULL,
	"seq" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"customer_email" varchar(255),
	"customer_address" text,
	"lang" varchar(2) DEFAULT 'ar' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"plan_id" uuid,
	"line_description" text NOT NULL,
	"line_detail" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"subtotal_cents" integer NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_note" text,
	"payment_method" varchar(64),
	"notes" text,
	"paid_at" timestamp,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'issued' NOT NULL,
	"email_send_id" uuid,
	"sent_at" timestamp,
	"voided_at" timestamp,
	"void_reason" varchar(500),
	"created_by_admin_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('issued', 'sent', 'void')),
	CONSTRAINT "invoices_lang_check" CHECK ("invoices"."lang" IN ('ar', 'en')),
	CONSTRAINT "invoices_total_check" CHECK ("invoices"."total_cents" = "invoices"."subtotal_cents" + "invoices"."vat_cents"),
	CONSTRAINT "invoices_amounts_non_negative" CHECK ("invoices"."subtotal_cents" >= 0 AND "invoices"."vat_cents" >= 0),
	CONSTRAINT "invoices_seq_positive" CHECK ("invoices"."seq" > 0),
	CONSTRAINT "invoices_void_consistency" CHECK (("invoices"."status" = 'void') = ("invoices"."voided_at" IS NOT NULL)),
	CONSTRAINT "invoices_sent_consistency" CHECK ("invoices"."status" <> 'sent' OR "invoices"."sent_at" IS NOT NULL),
	CONSTRAINT "invoices_period_check" CHECK (("invoices"."period_start" IS NULL) = ("invoices"."period_end" IS NULL) AND ("invoices"."period_end" IS NULL OR "invoices"."period_end" > "invoices"."period_start"))
);
--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_email_send_id_email_sends_id_fk" FOREIGN KEY ("email_send_id") REFERENCES "public"."email_sends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_admin_user_id_users_id_fk" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_number" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_series_year_seq" ON "invoices" USING btree ("series","year","seq");--> statement-breakpoint
CREATE INDEX "idx_invoices_user" ON "invoices" USING btree ("user_id","issue_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_invoices_status" ON "invoices" USING btree ("status","issue_date" DESC NULLS LAST);