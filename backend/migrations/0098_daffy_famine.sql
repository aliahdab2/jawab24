-- Webhook idempotency for incoming messages.
--
-- platform_message_id was non-unique; FB/IG webhook retries on 5xx/timeout
-- raced past the check-then-insert in services/messages.ts findOrCreateFromWebhook
-- and produced duplicate rows, which led to duplicate replies sent to customers.
--
-- Pre-step: deduplicate existing rows so the constraint can be added safely.
-- Within each platform_message_id group we keep the row with the richest
-- state, ranked as:
--   1. replied = true wins (so we don't lose the reply we already sent —
--      a row with replied=true also has reply_text, replied_at, ai_intent,
--      flag_reason populated; deleting it would leave the surviving row
--      reporting "unreplied" in the inbox even though the customer was
--      answered).
--   2. tie-break on (created_at ASC, id ASC) — keep the original arrival.
-- No FK references messages.id, so the DELETE is safe.
-- COALESCE guards against any legacy NULL values.
DELETE FROM "messages" a
USING "messages" b
WHERE a.platform_message_id = b.platform_message_id
  AND a.id <> b.id
  AND (
    -- b is strictly "better" than a, so a is the loser.
    COALESCE(b.replied, false)::int > COALESCE(a.replied, false)::int
    OR (
      COALESCE(b.replied, false) = COALESCE(a.replied, false)
      AND (COALESCE(b.created_at, 'epoch'::timestamp), b.id)
        < (COALESCE(a.created_at, 'epoch'::timestamp), a.id)
    )
  );
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_platform_message_id_unique" UNIQUE("platform_message_id");
