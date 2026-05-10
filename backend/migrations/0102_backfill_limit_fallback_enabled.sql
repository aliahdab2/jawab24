-- Backfill: existing rows that already have a custom fallback message stored
-- (from the brief window before the master toggle shipped) should keep their
-- previously-active behavior. Without this, those merchants would silently
-- stop sending the auto-reply at the limit when 0101 sets the new column to
-- false by default.
--
-- Idempotent: filtered to rows where the JSONB has any non-empty content.
-- Re-running this is safe because rows that match are already enabled.
UPDATE "settings"
SET "limit_fallback_enabled" = true
WHERE "limit_fallback_enabled" = false
  AND "limit_fallback_message_multi" IS NOT NULL
  AND "limit_fallback_message_multi" <> '{}'::jsonb
  AND EXISTS (
      SELECT 1
      FROM jsonb_each_text("limit_fallback_message_multi") AS m(k, v)
      WHERE m.k <> 'sourceLang' AND m.v IS NOT NULL AND length(trim(m.v)) > 0
  );
