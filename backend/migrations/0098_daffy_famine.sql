-- Webhook idempotency for incoming messages.
--
-- platform_message_id was non-unique; FB/IG webhook retries on 5xx/timeout
-- raced past the check-then-insert in services/messages.ts findOrCreateFromWebhook
-- and produced duplicate rows, which led to duplicate replies sent to customers.
--
-- Pre-step: deduplicate existing rows so the constraint can be added safely.
-- Strategy: keep the oldest row per platform_message_id (earliest created_at;
-- ties broken by id ascending). No FK references messages.id, so deletion is safe.
-- COALESCE guards against any legacy NULL created_at values.
DELETE FROM "messages" a
USING "messages" b
WHERE a.platform_message_id = b.platform_message_id
  AND (COALESCE(a.created_at, 'epoch'::timestamp), a.id)
    > (COALESCE(b.created_at, 'epoch'::timestamp), b.id);

ALTER TABLE "messages" ADD CONSTRAINT "messages_platform_message_id_unique" UNIQUE("platform_message_id");
