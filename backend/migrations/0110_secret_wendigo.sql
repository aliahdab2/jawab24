ALTER TABLE "pending_ecommerce_installs" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "pending_ecommerce_installs" ADD COLUMN "refresh_token_iv" varchar(64);--> statement-breakpoint
ALTER TABLE "pending_ecommerce_installs" ADD COLUMN "token_expires_at" timestamp;