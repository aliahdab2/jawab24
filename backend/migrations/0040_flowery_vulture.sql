ALTER TABLE "settings" ADD COLUMN "reply_style" varchar(20) DEFAULT 'professional';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "brand_voice_notes" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "hold_low_confidence" boolean DEFAULT false;