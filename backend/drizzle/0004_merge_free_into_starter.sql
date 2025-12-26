-- Migration: Merge Free Trial into Starter plan
-- This simplifies pricing from 4 plans to 3 plans

-- Step 1: Update Starter plan to include 30-day trial
UPDATE "plans" 
SET 
    "description" = 'Auto-reply to your Facebook & Instagram page - 30 days free trial',
    "trial_days" = 30,
    "is_default" = true,
    "sort_order" = 0,
    "updated_at" = now()
WHERE "slug" = 'starter';

-- Step 2: Update sort order for other plans
UPDATE "plans" SET "sort_order" = 1, "updated_at" = now() WHERE "slug" = 'business';
UPDATE "plans" SET "sort_order" = 2, "updated_at" = now() WHERE "slug" = 'pro';

-- Step 3: Migrate existing Free Trial users to Starter
UPDATE "subscriptions" 
SET 
    "plan_id" = (SELECT "id" FROM "plans" WHERE "slug" = 'starter'),
    "updated_at" = now()
WHERE "plan_id" = (SELECT "id" FROM "plans" WHERE "slug" = 'free');

-- Step 4: Deactivate Free Trial plan (keep for historical data)
UPDATE "plans" 
SET 
    "is_active" = false,
    "is_default" = false,
    "updated_at" = now()
WHERE "slug" = 'free';


