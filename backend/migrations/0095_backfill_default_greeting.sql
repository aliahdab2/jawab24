-- Backfill default greeting for any workspace whose greetingMessageMulti is
-- missing or empty. Without a configured greeting, step 9b in the message
-- pipeline falls through to AI for first-message-from-new-customer DMs and
-- the AI flags simple opener taps ("Get Started" / "بدء الاستخدام") as
-- needs_attention. Strings match the placeholder shown in the settings UI
-- (frontend/src/i18n/{en,ar}/settings.json#greetingMessagePlaceholder).
-- sourceLang: 'default' matches the marker the smart-translation pipeline
-- uses (controllers/settings.ts:126), so the merchant's first manual edit
-- triggers normal auto-translation flow rather than being treated as a clear.
--
-- Idempotent: only updates rows where the field is missing or has no usable
-- value, never overwrites configured greetings.
--
-- Defensive against non-object JSON values: jsonb_set fails with
-- "cannot set path in scalar" when the target (or any traversed parent) is a
-- JSON scalar (null/string/number/boolean). COALESCE only handles SQL NULL,
-- not JSON null. We use jsonb_typeof() guards in both the WHERE filter and
-- the SET expression so corrupt rows get fixed rather than aborting the run.
UPDATE "workspaces"
SET "settings" = jsonb_set(
    CASE
        WHEN "settings" IS NULL OR jsonb_typeof("settings") <> 'object'
        THEN '{}'::jsonb
        ELSE "settings"
    END,
    '{greetingMessageMulti}',
    '{"ar": "مرحباً بك! كيف يمكننا مساعدتك اليوم؟", "en": "Hello! How can we help you?", "sourceLang": "default"}'::jsonb
)
WHERE
    "settings" IS NULL
    OR jsonb_typeof("settings") <> 'object'
    OR NOT ("settings" ? 'greetingMessageMulti')
    OR jsonb_typeof("settings"->'greetingMessageMulti') <> 'object'
    OR "settings"->'greetingMessageMulti' = '{}'::jsonb
    OR (
        ("settings"->'greetingMessageMulti'->>'ar') IS NULL
        AND ("settings"->'greetingMessageMulti'->>'en') IS NULL
    );
