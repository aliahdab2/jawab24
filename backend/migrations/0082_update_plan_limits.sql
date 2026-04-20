-- Align plans table with current pricing page:
--   Starter  — $15/mo,  1 page,    500 AI replies, branded,     no e-commerce
--   Business — $39/mo,  2 pages,  3000 AI replies, no branding, e-commerce
--   Pro      — $79/mo,  5 pages, 10000 AI replies, no branding, e-commerce + priority support
--
-- Yearly prices use the "~17% off" framing from the pricing toggle (10 months paid for 12).
-- Stripe price IDs are left alone — environment-specific, owned by migration 0053.
-- This migration is idempotent: safe to run on any environment (local, staging, prod).

INSERT INTO "plans" (
    "slug", "name", "description",
    "price", "yearly_price", "currency", "interval",
    "max_pages", "max_ai_replies_per_month",
    "facebook_enabled", "instagram_enabled", "whatsapp_enabled", "ecommerce_enabled",
    "show_branding", "priority_support",
    "trial_days", "is_active", "is_default", "sort_order"
) VALUES
    ('starter',  'Starter',  'For small projects',
     1500, 15000, 'USD', 'month',
     1,  500,
     true, true, false, false,
     true,  false,
     0, true, false, 1),

    ('business', 'Business', 'For active stores',
     3900, 39000, 'USD', 'month',
     2, 3000,
     true, true, false, true,
     false, false,
     0, true, true,  2),

    ('pro',      'Pro',      'For agencies',
     7900, 79000, 'USD', 'month',
     5, 10000,
     true, true, false, true,
     false, true,
     0, true, false, 3)
ON CONFLICT ("slug") DO UPDATE SET
    "name"                     = EXCLUDED."name",
    "description"              = EXCLUDED."description",
    "price"                    = EXCLUDED."price",
    "yearly_price"             = EXCLUDED."yearly_price",
    "currency"                 = EXCLUDED."currency",
    "interval"                 = EXCLUDED."interval",
    "max_pages"                = EXCLUDED."max_pages",
    "max_ai_replies_per_month" = EXCLUDED."max_ai_replies_per_month",
    "facebook_enabled"         = EXCLUDED."facebook_enabled",
    "instagram_enabled"        = EXCLUDED."instagram_enabled",
    "whatsapp_enabled"         = EXCLUDED."whatsapp_enabled",
    "ecommerce_enabled"        = EXCLUDED."ecommerce_enabled",
    "show_branding"            = EXCLUDED."show_branding",
    "priority_support"         = EXCLUDED."priority_support",
    "is_active"                = EXCLUDED."is_active",
    "is_default"               = EXCLUDED."is_default",
    "sort_order"               = EXCLUDED."sort_order",
    "updated_at"               = NOW();

-- Only one plan can be default: unset defaults on rows that aren't 'business'.
UPDATE "plans" SET "is_default" = false WHERE "slug" <> 'business' AND "is_default" = true;
