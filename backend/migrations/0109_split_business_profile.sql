-- Stage 2.6 — Split `pages.business_profile` JSONB into a {merchant, suggestions}
-- container so the AI prompt-injection layer can read merchant-confirmed data
-- only, never falling back to stale Facebook-sourced fields.
--
-- Pre-migration shape (legacy flat):
--   business_profile = { name, phones, hours, address, ... }
--
-- Post-migration shape (container):
--   business_profile = {
--     merchant:    { ... }   -- editor-write-only; AI's BUSINESS_INFO block reads ONLY this
--     suggestions: { ... }   -- FB-sync-only; surfaced in editor as "Import from Facebook" buttons
--   }
--
-- Placement heuristic for existing data:
--   - If business_profile_updated_at > created_at + 60s, treat as merchant-edited
--     (the merchant touched it after page-connect FB sync). Move existing fields
--     into `merchant`, leave `suggestions` empty — the next FB sync will refill it.
--   - Otherwise treat as FB-default (never edited). Demote existing fields into
--     `suggestions`, leave `merchant` empty. The editor will surface the
--     suggestions as "Import from Facebook" buttons.
--   - If business_profile_updated_at IS NULL (very old rows pre-dating that
--     column), default to FB-default — conservative choice, no false positives.
--
-- Legacy `phone: string` → `phones[0]` coercion happens in the same statement.
--
-- Idempotent: rows whose business_profile already has a `merchant` key are
-- skipped. Running this twice is a no-op.

UPDATE "pages"
SET "business_profile" = (
    CASE
        -- Merchant edited the profile after connection → keep as merchant data.
        WHEN "business_profile_updated_at" IS NOT NULL
             AND "business_profile_updated_at" > "created_at" + INTERVAL '60 seconds'
        THEN jsonb_build_object(
            'merchant',
                -- Coerce legacy { phone: string } → { phones: [string] } in the same pass.
                CASE
                    WHEN "business_profile" ? 'phone' AND NOT ("business_profile" ? 'phones')
                    THEN ("business_profile" - 'phone')
                         || jsonb_build_object('phones', jsonb_build_array("business_profile"->>'phone'))
                    ELSE "business_profile"
                END,
            'suggestions', '{}'::jsonb
        )
        -- FB-default (never edited, or pre-dates the updated_at column).
        ELSE jsonb_build_object(
            'merchant', '{}'::jsonb,
            'suggestions',
                CASE
                    WHEN "business_profile" ? 'phone' AND NOT ("business_profile" ? 'phones')
                    THEN ("business_profile" - 'phone')
                         || jsonb_build_object('phones', jsonb_build_array("business_profile"->>'phone'))
                    ELSE "business_profile"
                END
        )
    END
)
WHERE "business_profile" IS NOT NULL
  AND jsonb_typeof("business_profile") = 'object'
  AND NOT ("business_profile" ? 'merchant');  -- skip already-migrated rows
