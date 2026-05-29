-- Stage 2.6.1 / Option B EMERGENCY ROLLBACK.
--
-- Reverses promote-business-profile-fb-sync.ts. Use ONLY if the migration
-- produced an unintended state and you need to restore the pre-Option-B
-- gate behavior immediately. NOT part of normal operation.
--
-- What it does:
--   - For every row with merchantProvenance set, drops the provenance
--     map and resets merchant to {} for fields whose provenance is
--     'fb_sync' (i.e. fields promoted by the migration). Editor-owned
--     fields (provenance.source = 'editor') are preserved — that's
--     merchant data, not migration data.
--   - Bumps kb_active_version so the next reply regenerates without
--     reading stale BUSINESS_INFO from the cache.
--
-- USAGE (manual):
--   docker exec -i jawab24-postgres psql -U postgres -d jawab24 < this-file
--
-- AFTER ROLLBACK: redeploy a build WITHOUT applyFbSyncToMerchant wired
-- into buildBusinessProfileContainer (revert the pages.ts change), or
-- the next FB sync will re-promote the same data.

BEGIN;

WITH unwrapped AS (
    SELECT
        id,
        CASE
            WHEN jsonb_typeof(business_profile) = 'string'
                THEN (business_profile #>> '{}')::jsonb
            ELSE business_profile
        END AS bp
    FROM pages
    WHERE business_profile IS NOT NULL
),
to_revert AS (
    SELECT
        id,
        bp,
        bp->'merchantProvenance' AS prov,
        COALESCE(bp->'merchant', '{}'::jsonb) AS merchant,
        COALESCE(bp->'suggestions', '{}'::jsonb) AS suggestions
    FROM unwrapped
    WHERE bp ? 'merchantProvenance'
)
UPDATE pages SET
    business_profile = (
        SELECT jsonb_build_object(
            'merchant', COALESCE(
                (
                    -- Keep only fields whose provenance is 'editor'
                    SELECT jsonb_object_agg(k, t.merchant->k)
                    FROM jsonb_object_keys(t.merchant) AS k
                    WHERE t.prov->k->>'source' = 'editor'
                ),
                '{}'::jsonb
            ),
            'suggestions', t.suggestions
            -- merchantProvenance dropped entirely
        )
        FROM to_revert t WHERE t.id = pages.id
    ),
    kb_version = COALESCE(kb_version, 0) + 1,
    kb_active_version = COALESCE(kb_active_version, 0) + 1,
    business_profile_updated_at = NOW(),
    updated_at = NOW()
WHERE id IN (SELECT id FROM to_revert);

-- Report
SELECT
    COUNT(*) AS rows_reverted,
    COUNT(*) FILTER (WHERE business_profile->'merchant' = '{}'::jsonb) AS now_empty_merchant
FROM pages
WHERE jsonb_typeof(business_profile) = 'object'
  AND business_profile ? 'suggestions'
  AND NOT (business_profile ? 'merchantProvenance');

COMMIT;
