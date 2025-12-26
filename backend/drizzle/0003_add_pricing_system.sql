-- Migration: Add Pricing & Subscription System
-- This creates tables for configurable pricing plans, subscriptions, and usage tracking

-- 1. Plans Table - Configurable pricing plans
CREATE TABLE IF NOT EXISTS "plans" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" varchar(100) NOT NULL,
    "slug" varchar(50) UNIQUE NOT NULL,
    "description" text,
    "price" integer NOT NULL DEFAULT 0,
    "currency" varchar(3) DEFAULT 'USD',
    "interval" varchar(20) DEFAULT 'month',
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
    "regional_pricing" jsonb DEFAULT '{}',
    "is_active" boolean DEFAULT true,
    "is_default" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

-- 2. Subscriptions Table
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE RESTRICT,
    "status" varchar(20) DEFAULT 'active',
    "trial_ends_at" timestamp,
    "current_period_start" timestamp DEFAULT now(),
    "current_period_end" timestamp,
    "external_subscription_id" varchar(255),
    "payment_method" varchar(50),
    "canceled_at" timestamp,
    "cancel_reason" text,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

-- 3. Usage Table - Monthly usage tracking
CREATE TABLE IF NOT EXISTS "usage" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "period_start" timestamp NOT NULL,
    "period_end" timestamp NOT NULL,
    "ai_replies_count" integer DEFAULT 0,
    "template_replies_count" integer DEFAULT 0,
    "total_comments_processed" integer DEFAULT 0,
    "total_messages_processed" integer DEFAULT 0,
    "daily_breakdown" jsonb DEFAULT '{}',
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

-- 4. Usage Logs Table - Detailed usage events
CREATE TABLE IF NOT EXISTS "usage_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "event_type" varchar(50) NOT NULL,
    "page_id" uuid REFERENCES "pages"("id") ON DELETE SET NULL,
    "platform" varchar(20),
    "metadata" jsonb DEFAULT '{}',
    "created_at" timestamp DEFAULT now()
);

-- Indexes for plans
CREATE INDEX IF NOT EXISTS "idx_plans_slug" ON "plans" ("slug");
CREATE INDEX IF NOT EXISTS "idx_plans_is_active" ON "plans" ("is_active");

-- Indexes for subscriptions
CREATE INDEX IF NOT EXISTS "idx_subscriptions_user_id" ON "subscriptions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_status" ON "subscriptions" ("status");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_plan_id" ON "subscriptions" ("plan_id");

-- Indexes for usage
CREATE INDEX IF NOT EXISTS "idx_usage_user_id" ON "usage" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_usage_period" ON "usage" ("period_start", "period_end");
CREATE INDEX IF NOT EXISTS "idx_usage_user_period" ON "usage" ("user_id", "period_start");

-- Indexes for usage_logs
CREATE INDEX IF NOT EXISTS "idx_usage_logs_user_id" ON "usage_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_usage_logs_event_type" ON "usage_logs" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_usage_logs_created_at" ON "usage_logs" ("created_at");

-- Insert default plans
INSERT INTO "plans" ("name", "slug", "description", "price", "max_pages", "max_ai_replies_per_month", "max_templates", "max_rules", "show_branding", "trial_days", "is_default", "sort_order") VALUES
    ('Free Trial', 'free', 'Auto-reply to your Facebook & Instagram pages - 30 days free', 0, 1, 60, 3, 2, true, 30, true, 0),
    ('Starter', 'starter', 'Auto-reply to 1 Facebook/Instagram page', 500, 1, 60, 3, 2, true, 0, false, 1),
    ('Business', 'business', 'Auto-reply to 3 Facebook/Instagram pages with unlimited templates', 2500, 3, 1500, NULL, NULL, false, 0, false, 2),
    ('Pro', 'pro', 'Auto-reply to 10 Facebook/Instagram pages - for agencies', 7000, 10, 9000, NULL, NULL, false, 0, false, 3)
ON CONFLICT ("slug") DO NOTHING;

