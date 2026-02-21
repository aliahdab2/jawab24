CREATE TABLE IF NOT EXISTS "ecommerce_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ecommerce_store_id" uuid NOT NULL,
	"platform_product_id" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"product_type" varchar(255),
	"vendor" varchar(255),
	"status" varchar(20) DEFAULT 'active',
	"price_range" varchar(100),
	"currency" varchar(10),
	"total_inventory" integer DEFAULT 0,
	"has_variants" boolean DEFAULT false,
	"variant_summary" text,
	"tags" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ecommerce_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(20) NOT NULL,
	"store_domain" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"access_token_iv" varchar(64) NOT NULL,
	"refresh_token" text,
	"refresh_token_iv" varchar(64),
	"token_expires_at" timestamp,
	"store_name" varchar(255),
	"store_email" varchar(255),
	"store_currency" varchar(10),
	"store_timezone" varchar(100),
	"product_count" integer DEFAULT 0,
	"product_summary" text,
	"policies_summary" text,
	"platform_data" jsonb,
	"last_sync_at" timestamp,
	"is_active" boolean DEFAULT true,
	"installed_at" timestamp DEFAULT now(),
	"uninstalled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_ecommerce_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(20) NOT NULL,
	"store_domain" varchar(255) NOT NULL,
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
DROP TABLE "pending_shopify_installs";--> statement-breakpoint
DROP TABLE "shopify_products";--> statement-breakpoint
DROP TABLE "shopify_stores";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_shopify_store_id_shopify_stores_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_pages_shopify_store_id";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "ecommerce_store_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "ecommerce_enabled" boolean DEFAULT false;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ecommerce_products_store_product" ON "ecommerce_products" ("ecommerce_store_id","platform_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ecommerce_products_store_id" ON "ecommerce_products" ("ecommerce_store_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ecommerce_products_status" ON "ecommerce_products" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ecommerce_stores_platform_domain" ON "ecommerce_stores" ("platform","store_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ecommerce_stores_user_id" ON "ecommerce_stores" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ecommerce_stores_is_active" ON "ecommerce_stores" ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ecommerce_stores_token_expires_at" ON "ecommerce_stores" ("token_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_ecommerce_store_domain" ON "pending_ecommerce_installs" ("store_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_ecommerce_status" ON "pending_ecommerce_installs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_ecommerce_platform_status_expires" ON "pending_ecommerce_installs" ("platform","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_ecommerce_store_id" ON "pages" ("ecommerce_store_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_ecommerce_store_id_ecommerce_stores_id_fk" FOREIGN KEY ("ecommerce_store_id") REFERENCES "ecommerce_stores"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN IF EXISTS "shopify_store_id";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "shopify_enabled";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_ecommerce_store_id_ecommerce_stores_id_fk" FOREIGN KEY ("ecommerce_store_id") REFERENCES "ecommerce_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ecommerce_stores" ADD CONSTRAINT "ecommerce_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_ecommerce_installs" ADD CONSTRAINT "pending_ecommerce_installs_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
