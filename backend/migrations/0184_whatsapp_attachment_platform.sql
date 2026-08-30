-- Relabel WhatsApp rows that were stored as 'facebook'.
--
-- `storeAttachmentStub` (nonTextHandler) passed no platform for attachment stubs, so
-- `createMessage` fell back to its 'facebook' default — every WhatsApp voice note, image
-- and document since the channel launched. When such an attachment was the customer's
-- FIRST message, the conversation was created as 'facebook' too, and `findOrCreate`
-- never rewrites a conversation's platform. Symptom (Z NET, 2026-08-30): 43 rows and 7
-- conversations on a WhatsApp-only page; the dashboard reply on those threads resolved
-- to the Facebook sender and failed with PAGE_DISCONNECTED, and three of them rendered
-- as Messenger threads with no customer number.
--
-- The `wamid.` prefix is Meta's WhatsApp message-id namespace and appears on no other
-- channel, so it is the safe discriminator here — no page or channel lookup involved.

-- 1. Any message carrying a WhatsApp id is a WhatsApp message.
UPDATE "messages"
SET "platform" = 'whatsapp'
WHERE "platform_message_id" LIKE 'wamid.%'
  AND "platform" IS DISTINCT FROM 'whatsapp';
--> statement-breakpoint

-- 2. A conversation is WhatsApp when it holds WhatsApp ids and nothing from another
--    channel. Our own synthetic `reply_…` ids (templates / dashboard sends) carry no
--    channel information and inherit the conversation's platform, so they are ignored
--    on both sides of the test.
UPDATE "conversations" c
SET "platform" = 'whatsapp'
WHERE c."platform" IS DISTINCT FROM 'whatsapp'
  AND EXISTS (
    SELECT 1 FROM "messages" m
    WHERE m."conversation_id" = c."id" AND m."platform_message_id" LIKE 'wamid.%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "messages" m
    WHERE m."conversation_id" = c."id"
      AND m."platform_message_id" NOT LIKE 'wamid.%'
      AND m."platform_message_id" NOT LIKE 'reply_%'
  );
--> statement-breakpoint

-- 3. Our synthetic-id rows inside those conversations follow the conversation.
UPDATE "messages" m
SET "platform" = 'whatsapp'
FROM "conversations" c
WHERE m."conversation_id" = c."id"
  AND c."platform" = 'whatsapp'
  AND m."platform" IS DISTINCT FROM 'whatsapp'
  AND m."platform_message_id" LIKE 'reply_%';
