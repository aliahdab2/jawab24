CREATE TABLE IF NOT EXISTS "ai_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_hash" varchar(64) NOT NULL,
	"reply_text" text NOT NULL,
	"language" varchar(10),
	"hit_count" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"last_used_at" timestamp DEFAULT now(),
	CONSTRAINT "ai_cache_comment_hash_unique" UNIQUE("comment_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"facebook_comment_id" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"from_id" varchar(255),
	"from_name" varchar(255),
	"replied" boolean DEFAULT false,
	"reply_text" text,
	"reply_method" varchar(50),
	"template_id" uuid,
	"detected_language" varchar(10),
	"reply_language" varchar(10),
	"created_time" timestamp,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "comments_facebook_comment_id_unique" UNIQUE("facebook_comment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instagram_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid,
	"instagram_comment_id" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"from_id" varchar(255),
	"from_username" varchar(255),
	"replied" boolean DEFAULT false,
	"reply_text" text,
	"reply_method" varchar(50),
	"detected_language" varchar(10),
	"reply_language" varchar(10),
	"created_time" timestamp,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "instagram_comments_instagram_comment_id_unique" UNIQUE("instagram_comment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instagram_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid,
	"instagram_media_id" varchar(255) NOT NULL,
	"media_type" varchar(50),
	"caption" text,
	"permalink" text,
	"thumbnail_url" text,
	"auto_reply_enabled" boolean DEFAULT true,
	"created_time" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "instagram_media_instagram_media_id_unique" UNIQUE("instagram_media_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"page_id" uuid,
	"comment_id" uuid,
	"action" varchar(100),
	"status" varchar(50),
	"message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid,
	"facebook_message_id" varchar(255) NOT NULL,
	"instagram_message_id" varchar(255),
	"platform" varchar(20) DEFAULT 'facebook',
	"sender_id" varchar(255) NOT NULL,
	"sender_name" varchar(255),
	"message" text NOT NULL,
	"direction" varchar(10) DEFAULT 'incoming',
	"replied" boolean DEFAULT false,
	"reply_text" text,
	"reply_method" varchar(50),
	"created_time" timestamp,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "messages_facebook_message_id_unique" UNIQUE("facebook_message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"facebook_page_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"access_token" text NOT NULL,
	"auto_reply_enabled" boolean DEFAULT true,
	"instagram_account_id" varchar(255),
	"instagram_username" varchar(255),
	"instagram_auto_reply_enabled" boolean DEFAULT true,
	"knowledge_base" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pages_facebook_page_id_unique" UNIQUE("facebook_page_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"description" text,
	"price" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"interval" varchar(20) DEFAULT 'month',
	"stripe_price_id" varchar(255),
	"max_pages" integer DEFAULT 1,
	"max_ai_replies_per_month" integer DEFAULT 50,
	"max_templates" integer DEFAULT 3,
	"max_rules" integer DEFAULT 2,
	"facebook_enabled" boolean DEFAULT true,
	"instagram_enabled" boolean DEFAULT true,
	"whatsapp_enabled" boolean DEFAULT false,
	"show_branding" boolean DEFAULT true,
	"priority_support" boolean DEFAULT false,
	"trial_days" integer DEFAULT 0,
	"regional_pricing" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"is_default" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid,
	"facebook_post_id" varchar(255) NOT NULL,
	"message" text,
	"auto_reply_enabled" boolean DEFAULT true,
	"created_time" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "posts_facebook_post_id_unique" UNIQUE("facebook_post_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" varchar(255) NOT NULL,
	"keywords" text[],
	"template_id" uuid,
	"priority" integer DEFAULT 0,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"dashboard_language" varchar(10) DEFAULT 'ar',
	"default_reply_language" varchar(10) DEFAULT 'ar',
	"supported_languages" text[] DEFAULT ARRAY['en', 'ar'],
	"auto_detect_language" boolean DEFAULT true,
	"ai_enabled" boolean DEFAULT true,
	"ai_model" varchar(100) DEFAULT 'gpt-4o-mini',
	"comment_reply_mode" varchar(20) DEFAULT 'public',
	"dual_reply_config" jsonb DEFAULT '{}'::jsonb,
	"comments_auto_reply" boolean DEFAULT true,
	"messages_auto_reply" boolean DEFAULT true,
	"business_hours_only" boolean DEFAULT false,
	"business_hours_start" varchar(5) DEFAULT '09:00',
	"business_hours_end" varchar(5) DEFAULT '18:00',
	"away_message" text,
	"greeting_message" text,
	"reply_delay" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"trial_ends_at" timestamp,
	"current_period_start" timestamp DEFAULT now(),
	"current_period_end" timestamp,
	"external_subscription_id" varchar(255),
	"payment_method" varchar(50),
	"stripe_customer_id" varchar(255),
	"stripe_checkout_session_id" varchar(255),
	"cancel_at_period_end" boolean DEFAULT false,
	"canceled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" varchar(255) NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"keywords" text[],
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"ai_replies_count" integer DEFAULT 0,
	"template_replies_count" integer DEFAULT 0,
	"total_comments_processed" integer DEFAULT 0,
	"total_messages_processed" integer DEFAULT 0,
	"daily_breakdown" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"page_id" uuid,
	"platform" varchar(20),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facebook_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"email" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_facebook_id_unique" UNIQUE("facebook_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_cache_comment_hash" ON "ai_cache" ("comment_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_cache_last_used" ON "ai_cache" ("last_used_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_post_id" ON "comments" ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_facebook_comment_id" ON "comments" ("facebook_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_replied" ON "comments" ("replied");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_detected_language" ON "comments" ("detected_language");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_media_id" ON "instagram_comments" ("media_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_id" ON "instagram_comments" ("instagram_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_comments_replied" ON "instagram_comments" ("replied");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_media_page_id" ON "instagram_media" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instagram_media_id" ON "instagram_media" ("instagram_media_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_logs_user_id" ON "logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_logs_created_at" ON "logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_logs_action" ON "logs" ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_page_id" ON "messages" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_sender_id" ON "messages" ("sender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_facebook_message_id" ON "messages" ("facebook_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_direction" ON "messages" ("direction");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_platform" ON "messages" ("platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_user_id" ON "pages" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_facebook_page_id" ON "pages" ("facebook_page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_instagram_account_id" ON "pages" ("instagram_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plans_slug" ON "plans" ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plans_is_active" ON "plans" ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posts_page_id" ON "posts" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posts_facebook_post_id" ON "posts" ("facebook_post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rules_user_id" ON "rules" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settings_user_id" ON "settings" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_user_id" ON "subscriptions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_status" ON "subscriptions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_plan_id" ON "subscriptions" ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_templates_user_id" ON "templates" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_user_id" ON "usage" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_period" ON "usage" ("period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_user_period" ON "usage" ("user_id","period_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_user_id" ON "usage_logs" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_event_type" ON "usage_logs" ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_created_at" ON "usage_logs" ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE no action ON UPDATE no action;
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
 ALTER TABLE "instagram_media" ADD CONSTRAINT "instagram_media_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "logs" ADD CONSTRAINT "logs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "logs" ADD CONSTRAINT "logs_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "pages" ADD CONSTRAINT "pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules" ADD CONSTRAINT "rules_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE set null ON UPDATE no action;
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
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
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
