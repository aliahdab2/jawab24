CREATE TABLE IF NOT EXISTS "notification_send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"fcm_message_id" text,
	"success" boolean NOT NULL,
	"error_code" varchar(100),
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_send_log_user_sent" ON "notification_send_log" ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_send_log_error_sent" ON "notification_send_log" ("error_code","sent_at");