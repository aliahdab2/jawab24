ALTER TABLE "settings" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Riyadh';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "after_hours_smart_reply" boolean DEFAULT true;