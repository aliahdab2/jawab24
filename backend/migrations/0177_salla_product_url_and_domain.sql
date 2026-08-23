-- Salla store links, two parts (2026-08-23).
--
-- 1. `ecommerce_products.product_url` — the platform's own canonical storefront
--    URL (Salla `urls.customer`). Salla products have no slug; the `/p/{slug}`
--    URL the code used to derive never matched a real store, so every real Salla
--    row was stored without a link and the model invented one for the customer.
--    Nullable and additive: Shopify/Zid rows stay NULL and keep deriving their
--    URL from `handle` (`productUrlFor`). Filled by the next product sync.
ALTER TABLE "ecommerce_products" ADD COLUMN IF NOT EXISTS "product_url" text;
--> statement-breakpoint
-- 2. Canonicalise `store_domain` for Salla rows written before the border
--    normalised it. Salla's store/info `domain` is a full URL (with a path for
--    demo/development stores), stored verbatim; every reader prepended https://
--    and the catalog block rendered `https://https://demostore…`.
--
--    Canonical form = lower(host) + path, no scheme, no trailing slash — the
--    same as `normalizeStoreDomain` in services/storeDomain.ts. The column is
--    the unique key `(platform, store_domain)` and `createStore`'s ON CONFLICT
--    target, so this MUST be rewritten: a reinstall now arrives bare-host and
--    would otherwise insert a second store next to the URL-form row.
--
--    Collisions are skipped with a WARNING, never resolved here — deactivating
--    a row in SQL would strand `pages.ecommerce_store_id` links, and which of
--    two stores holds the live token is not knowable from the schema. At
--    authoring time production had exactly 1 affected store row and 0
--    collisions (`SELECT … WHERE platform='salla' AND store_domain ~* '^https?://'`).
--
--    `product_summary` gets the doubled scheme collapsed in the same pass so
--    the catalog block is right immediately, not only after the next sync.
DO $$
DECLARE
    rec RECORD;
    stripped text;
    host text;
    path text;
    canonical text;
BEGIN
    FOR rec IN
        SELECT id, store_domain FROM ecommerce_stores
        WHERE platform = 'salla' AND store_domain ~* '^https?://'
    LOOP
        stripped := regexp_replace(rec.store_domain, '^https?://', '', 'i');
        stripped := regexp_replace(stripped, '/+$', '');
        host := lower(split_part(stripped, '/', 1));
        path := CASE WHEN position('/' IN stripped) > 0 THEN substr(stripped, position('/' IN stripped)) ELSE '' END;
        canonical := host || path;

        IF EXISTS (
            SELECT 1 FROM ecommerce_stores
            WHERE platform = 'salla' AND store_domain = canonical AND id <> rec.id
        ) THEN
            RAISE WARNING 'ecommerce_stores % keeps % — normalised form % already belongs to another store', rec.id, rec.store_domain, canonical;
        ELSE
            UPDATE ecommerce_stores
               SET store_domain = canonical,
                   product_summary = replace(product_summary, 'https://https://', 'https://'),
                   updated_at = now()
             WHERE id = rec.id;
        END IF;
    END LOOP;

    -- Pending installs are keyed on the same value (claim → getStoreByDomain →
    -- createStore). No unique index here, so a plain UPDATE cannot collide.
    FOR rec IN
        SELECT id, store_domain FROM pending_ecommerce_installs
        WHERE platform = 'salla' AND store_domain ~* '^https?://'
    LOOP
        stripped := regexp_replace(rec.store_domain, '^https?://', '', 'i');
        stripped := regexp_replace(stripped, '/+$', '');
        host := lower(split_part(stripped, '/', 1));
        path := CASE WHEN position('/' IN stripped) > 0 THEN substr(stripped, position('/' IN stripped)) ELSE '' END;
        UPDATE pending_ecommerce_installs SET store_domain = host || path WHERE id = rec.id;
    END LOOP;
END $$;
