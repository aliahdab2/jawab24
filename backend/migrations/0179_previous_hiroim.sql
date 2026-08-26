CREATE TABLE "whatsapp_notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"template_name" varchar(512) NOT NULL,
	"language" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"provider_template_id" varchar(255),
	"error_message" text,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customer_notifications_log" ADD COLUMN "variables" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_notification_templates" ADD CONSTRAINT "whatsapp_notification_templates_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wa_notif_tpl_page" ON "whatsapp_notification_templates" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wa_notif_tpl_page_name_lang" ON "whatsapp_notification_templates" USING btree ("page_id","template_name","language");