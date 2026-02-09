CREATE TABLE IF NOT EXISTS "pending_shopify_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"access_token_iv" varchar(64) NOT NULL,
	"scopes" text,
	"nonce" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"claimed_by_user_id" uuid,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_shopify_shop_domain" ON "pending_shopify_installs" ("shop_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_shopify_status" ON "pending_shopify_installs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_shopify_expires_at" ON "pending_shopify_installs" ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_shopify_store_id" ON "pages" ("shopify_store_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_shopify_store_id_shopify_stores_id_fk" FOREIGN KEY ("shopify_store_id") REFERENCES "shopify_stores"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_shopify_installs" ADD CONSTRAINT "pending_shopify_installs_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
