-- Migration: Add Stripe fields to subscriptions and plans tables
-- Date: 2026-01-02

-- Add Stripe fields to subscriptions table
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE;

-- Add Stripe Price ID to plans table
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_external_subscription ON subscriptions(external_subscription_id);
CREATE INDEX IF NOT EXISTS idx_plans_stripe_price ON plans(stripe_price_id);

-- Comments
COMMENT ON COLUMN subscriptions.stripe_customer_id IS 'Stripe Customer ID (cus_xxxxx)';
COMMENT ON COLUMN subscriptions.stripe_checkout_session_id IS 'Stripe Checkout Session ID for tracking';
COMMENT ON COLUMN subscriptions.cancel_at_period_end IS 'Whether subscription will cancel at period end';
COMMENT ON COLUMN plans.stripe_price_id IS 'Stripe Price ID (price_xxxxx) for this plan';

