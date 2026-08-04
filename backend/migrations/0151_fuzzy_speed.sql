ALTER TABLE "conversations" ADD COLUMN "referral_source" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "referral_ref" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "referral_ad_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "referral_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_ad_id" text;