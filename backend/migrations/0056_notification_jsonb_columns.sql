-- Migration: Convert notification title/body from per-language TEXT columns to JSONB
-- This enables multi-language support beyond just ar/en.

BEGIN;

-- 1. Add new JSONB columns (nullable for backfill)
ALTER TABLE notifications ADD COLUMN titles JSONB;
ALTER TABLE notifications ADD COLUMN bodies JSONB;

-- 2. Backfill from existing columns
UPDATE notifications SET
    titles = jsonb_build_object('en', title_en, 'ar', title_ar),
    bodies = jsonb_build_object('en', body_en, 'ar', body_ar);

-- 3. Set NOT NULL now that all rows have data
ALTER TABLE notifications ALTER COLUMN titles SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN bodies SET NOT NULL;

-- 4. Drop old columns
ALTER TABLE notifications DROP COLUMN title_en;
ALTER TABLE notifications DROP COLUMN title_ar;
ALTER TABLE notifications DROP COLUMN body_en;
ALTER TABLE notifications DROP COLUMN body_ar;

COMMIT;
