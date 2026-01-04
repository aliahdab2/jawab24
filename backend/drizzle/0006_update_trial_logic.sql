-- Migration: Update to Cardless Trial Logic on Starter Plan

-- 1. Disable the "Free Trial" plan (slug: free)
UPDATE "plans" 
SET "is_active" = false, "is_default" = false, "updated_at" = now() 
WHERE "slug" = 'free';

-- 2. Update "Starter" plan to be Default and have 30 trial days
UPDATE "plans" 
SET "trial_days" = 30, "is_default" = true, "updated_at" = now() 
WHERE "slug" = 'starter';

-- 3. Ensure no other plan is default (safety check)
UPDATE "plans" 
SET "is_default" = false 
WHERE "slug" != 'starter';
