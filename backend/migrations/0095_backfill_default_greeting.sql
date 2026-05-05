-- Backfill default greeting for any workspace whose greetingMessageMulti is
-- missing or empty. Without a configured greeting, step 9b in the message
-- pipeline falls through to AI for first-message-from-new-customer DMs and
-- the AI flags simple opener taps ("Get Started" / "بدء الاستخدام") as
-- needs_attention. Strings match the placeholder shown in the settings UI
-- (frontend/src/i18n/{en,ar}/settings.json#greetingMessagePlaceholder).
-- sourceLang: 'default' matches the marker the smart-translation pipeline
-- uses (controllers/settings.ts:126), so the merchant's first manual edit
-- triggers normal auto-translation flow rather than being treated as a clear.
-- Idempotent: only updates rows where the field is missing or has no usable
-- value, never overwrites configured greetings.
UPDATE "workspaces"
SET "settings" = jsonb_set(
    COALESCE("settings", '{}'::jsonb),
    '{greetingMessageMulti}',
    '{"ar": "مرحباً بك! كيف يمكننا مساعدتك اليوم؟", "en": "Hello! How can we help you?", "sourceLang": "default"}'::jsonb
)
WHERE
    "settings" IS NULL
    OR NOT ("settings" ? 'greetingMessageMulti')
    OR "settings"->'greetingMessageMulti' = '{}'::jsonb
    OR (
        ("settings"->'greetingMessageMulti'->>'ar') IS NULL
        AND ("settings"->'greetingMessageMulti'->>'en') IS NULL
    );
