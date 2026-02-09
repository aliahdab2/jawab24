CREATE TABLE IF NOT EXISTS "shopify_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shopify_store_id" uuid NOT NULL,
	"shopify_product_id" varchar(255) NOT NULL,
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
CREATE TABLE IF NOT EXISTS "shopify_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_domain" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"shop_name" varchar(255),
	"shop_email" varchar(255),
	"shop_currency" varchar(10),
	"shop_timezone" varchar(100),
	"plan_name" varchar(100),
	"product_count" integer DEFAULT 0,
	"product_summary" text,
	"policies_summary" text,
	"last_sync_at" timestamp,
	"is_active" boolean DEFAULT true,
	"installed_at" timestamp DEFAULT now(),
	"uninstalled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "shopify_stores_shop_domain_unique" UNIQUE("shop_domain")
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "shopify_store_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "shopify_enabled" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shopify_products_store_id" ON "shopify_products" ("shopify_store_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shopify_products_product_id" ON "shopify_products" ("shopify_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shopify_products_status" ON "shopify_products" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shopify_stores_user_id" ON "shopify_stores" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shopify_stores_shop_domain" ON "shopify_stores" ("shop_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shopify_stores_is_active" ON "shopify_stores" ("is_active");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_products" ADD CONSTRAINT "shopify_products_shopify_store_id_shopify_stores_id_fk" FOREIGN KEY ("shopify_store_id") REFERENCES "shopify_stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
