ALTER TABLE "pages" ADD COLUMN "reply_mode" varchar(10);--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "reply_mode" varchar(10) DEFAULT 'sales';