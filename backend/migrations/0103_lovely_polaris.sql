ALTER TABLE "settings" ADD COLUMN "greeting_message_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Backfill: enable for existing merchants who already customized their greeting
-- (sourceLang is a real language code, not the seeded 'default' marker).
-- Preserves zero behavior change on deploy day for currently-configured merchants.
UPDATE "settings"
SET "greeting_message_enabled" = true
WHERE "greeting_message_multi" ->> 'sourceLang' IS NOT NULL
  AND "greeting_message_multi" ->> 'sourceLang' <> 'default';
--> statement-breakpoint
-- Mirror into workspaces.settings JSONB. The reply pipeline reads workspace
-- settings (Redis-cached JSONB), so this write is required for the gate to
-- behave consistently after deploy. Match owner row of each workspace.
UPDATE "workspaces" w
SET "settings" = jsonb_set(
    COALESCE(w."settings", '{}'::jsonb),
    '{greetingMessageEnabled}',
    'true'::jsonb
)
FROM "workspace_members" wm
JOIN "settings" s ON s."user_id" = wm."user_id"
WHERE wm."workspace_id" = w."id"
  AND wm."role" = 'owner'
  AND s."greeting_message_enabled" = true;