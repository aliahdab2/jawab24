CREATE TABLE IF NOT EXISTS "customer_notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecommerce_store_id" uuid NOT NULL,
	"notification_type" varchar(50) NOT NULL,
	"channel" varchar(20) DEFAULT 'sms' NOT NULL,
	"message_ar" text NOT NULL,
	"message_en" text NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"delay_minutes" integer DEFAULT 0,
	"include_coupon" boolean DEFAULT false,
	"coupon_code" varchar(50),
	"coupon_discount" varchar(20),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_notifications_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecommerce_store_id" uuid NOT NULL,
	"notification_type" varchar(50) NOT NULL,
	"platform_event_id" varchar(255),
	"customer_phone" varchar(20) NOT NULL,
	"customer_name" varchar(255),
	"channel" varchar(20) NOT NULL,
	"message_sent" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"provider_message_id" varchar(255),
	"error_message" text,
	"order_number" varchar(50),
	"cart_total" varchar(50),
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cust_notif_tmpl_store_type" ON "customer_notification_templates" ("ecommerce_store_id","notification_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cust_notif_tmpl_store" ON "customer_notification_templates" ("ecommerce_store_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cust_notif_log_store" ON "customer_notifications_log" ("ecommerce_store_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cust_notif_log_phone" ON "customer_notifications_log" ("customer_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cust_notif_log_status" ON "customer_notifications_log" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cust_notif_log_type_event" ON "customer_notifications_log" ("notification_type","platform_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cust_notif_log_pending_scheduled" ON "customer_notifications_log" ("status","scheduled_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_notification_templates" ADD CONSTRAINT "customer_notification_templates_ecommerce_store_id_ecommerce_stores_id_fk" FOREIGN KEY ("ecommerce_store_id") REFERENCES "ecommerce_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_notifications_log" ADD CONSTRAINT "customer_notifications_log_ecommerce_store_id_ecommerce_stores_id_fk" FOREIGN KEY ("ecommerce_store_id") REFERENCES "ecommerce_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
