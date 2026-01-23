CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"target_user_id" uuid,
	"action" varchar(50) NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"payment_reference" varchar(255),
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_audit_admin_user_id" ON "admin_audit_logs" ("admin_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_audit_target_user_id" ON "admin_audit_logs" ("target_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_audit_action" ON "admin_audit_logs" ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_audit_created_at" ON "admin_audit_logs" ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
