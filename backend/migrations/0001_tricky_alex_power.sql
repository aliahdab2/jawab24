ALTER TABLE "instagram_media" DROP CONSTRAINT IF EXISTS "instagram_media_instagram_media_id_key";--> statement-breakpoint
ALTER TABLE "instagram_comments" DROP CONSTRAINT IF EXISTS "instagram_comments_instagram_comment_id_key";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_facebook_message_id_key";--> statement-breakpoint
ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "plans_slug_key";--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT IF EXISTS "templates_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "rules" DROP CONSTRAINT IF EXISTS "rules_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "logs" DROP CONSTRAINT IF EXISTS "logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_page_id_pages_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_post_id_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "instagram_media" DROP CONSTRAINT IF EXISTS "instagram_media_page_id_fkey";
--> statement-breakpoint
ALTER TABLE "instagram_comments" DROP CONSTRAINT IF EXISTS "instagram_comments_media_id_fkey";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_page_id_fkey";
--> statement-breakpoint
ALTER TABLE "usage" DROP CONSTRAINT IF EXISTS "usage_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT IF EXISTS "usage_logs_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "usage_logs" DROP CONSTRAINT IF EXISTS "usage_logs_page_id_fkey";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_plan_id_fkey";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_templates_translations";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_rules_priority";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_subscriptions_stripe_customer";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_subscriptions_external_subscription";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_plans_stripe_price";--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "dashboard_language" SET DEFAULT 'ar';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "default_reply_language" SET DEFAULT 'ar';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "supported_languages" SET DEFAULT ARRAY['en', 'ar'];--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "ai_model" SET DEFAULT 'gpt-4o-mini';--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "platform" SET DEFAULT 'facebook';--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "direction" SET DEFAULT 'incoming';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "currency" SET DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "interval" SET DEFAULT 'month';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "comment_reply_mode" varchar(20) DEFAULT 'public';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "dual_reply_config" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "comments_auto_reply" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "messages_auto_reply" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "business_hours_only" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "business_hours_start" varchar(5) DEFAULT '09:00';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "business_hours_end" varchar(5) DEFAULT '18:00';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "away_message" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "greeting_message" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "reply_delay" integer DEFAULT 0;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "logs" ADD CONSTRAINT "logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posts" ADD CONSTRAINT "posts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instagram_media" ADD CONSTRAINT "instagram_media_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instagram_comments" ADD CONSTRAINT "instagram_comments_media_id_instagram_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "instagram_media"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage" ADD CONSTRAINT "usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "instagram_media" ADD CONSTRAINT "instagram_media_instagram_media_id_unique" UNIQUE("instagram_media_id");--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD CONSTRAINT "instagram_comments_instagram_comment_id_unique" UNIQUE("instagram_comment_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_facebook_message_id_unique" UNIQUE("facebook_message_id");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_slug_unique" UNIQUE("slug");