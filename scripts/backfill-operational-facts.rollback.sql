-- Rollback for backfill-operational-facts.ts.
--
-- Reverses ONLY the kb_extract promotion: for every page, removes the merchant
-- fields whose provenance.source = 'kb_extract' and drops their provenance
-- entries. Editor-owned and fb_sync fields are preserved untouched — this is
-- surgical, not a full reset.
--
-- Use if the operational-facts backfill produced bad structured data and you
-- need to restore the prior state immediately.
--
-- USAGE (manual):
--   docker exec -i jawab24-postgres psql -U postgres -d jawab24 < this-file
--
-- Cache: bumps kb_active_version so the next reply regenerates without reading
-- stale BUSINESS_INFO from cache. (On-save re-extraction is not wired yet, so a
-- rollback is durable today; once that deferred follow-up ships, also disable
-- its flag here or the next KB save will re-promote.)

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
targets AS (
    SELECT
        id,
        COALESCE(bp->'merchantProvenance', '{}'::jsonb) AS prov,
        COALESCE(bp->'merchant', '{}'::jsonb)          AS merchant,
        bp->'suggestions'                              AS suggestions
    FROM unwrapped
    WHERE bp ? 'merchantProvenance'
      AND EXISTS (
          SELECT 1 FROM jsonb_each(bp->'merchantProvenance') e
          WHERE e.value->>'source' = 'kb_extract'
      )
)
UPDATE pages SET
    business_profile = (
        SELECT jsonb_strip_nulls(jsonb_build_object(
            -- keep every merchant field whose provenance is NOT kb_extract
            'merchant', COALESCE(
                (
                    SELECT jsonb_object_agg(k, t.merchant->k)
                    FROM jsonb_object_keys(t.merchant) AS k
                    WHERE (t.prov->k->>'source') IS DISTINCT FROM 'kb_extract'
                ),
                '{}'::jsonb
            ),
            'suggestions', t.suggestions,
            -- keep every provenance entry that is NOT kb_extract
            'merchantProvenance', COALESCE(
                (
                    SELECT jsonb_object_agg(k, t.prov->k)
                    FROM jsonb_object_keys(t.prov) AS k
                    WHERE (t.prov->k->>'source') IS DISTINCT FROM 'kb_extract'
                ),
                '{}'::jsonb
            )
        ))
        FROM targets t WHERE t.id = pages.id
    ),
    kb_version = COALESCE(kb_version, 0) + 1,
    kb_active_version = COALESCE(kb_active_version, 0) + 1,
    business_profile_updated_at = NOW(),
    updated_at = NOW()
WHERE id IN (SELECT id FROM targets);

-- Report: how many rows still carry any kb_extract provenance (should be 0).
SELECT
    COUNT(*) FILTER (
        WHERE EXISTS (
            SELECT 1 FROM jsonb_each(
                CASE WHEN jsonb_typeof(business_profile) = 'string'
                    THEN (business_profile #>> '{}')::jsonb ELSE business_profile END
                -> 'merchantProvenance'
            ) e WHERE e.value->>'source' = 'kb_extract'
        )
    ) AS rows_still_kb_extract
FROM pages
WHERE business_profile IS NOT NULL;

COMMIT;
