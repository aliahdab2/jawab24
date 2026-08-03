-- Zid dual-header auth: the OAuth token response carries a second credential
-- (`Authorization` field) that every Merchant API call must send as
-- `Authorization: Bearer` alongside the access token (X-Manager-Token).
-- AES-256-GCM encrypted like the other token columns. NULL for Shopify/Salla.
ALTER TABLE "ecommerce_stores" ADD COLUMN "authorization_token" text;--> statement-breakpoint
ALTER TABLE "ecommerce_stores" ADD COLUMN "authorization_token_iv" varchar(64);--> statement-breakpoint
ALTER TABLE "pending_ecommerce_installs" ADD COLUMN "authorization_token" text;--> statement-breakpoint
ALTER TABLE "pending_ecommerce_installs" ADD COLUMN "authorization_token_iv" varchar(64);
