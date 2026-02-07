ALTER TABLE "settings" ADD COLUMN "comment_escalation_minutes" integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "message_escalation_minutes" integer DEFAULT 30;