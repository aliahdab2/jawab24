ALTER TABLE "settings" ADD COLUMN "away_message_ar" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "away_message_en" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "greeting_message_ar" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "greeting_message_en" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "away_message_source_lang" varchar(10);--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "greeting_message_source_lang" varchar(10);