-- Backfill conversations.sender_name from comments.from_name for senders we only
-- ever reached via comment-triggered DMs (customer commented, bot replied privately,
-- customer never sent a DM). The commenter's name was known at webhook time but
-- never propagated to the outgoing DM row until this PR fixed storeOutgoingMessage.
--
-- Production impact before this migration:
--   470 conversations with NULL sender_name
--   465 of them have a matching (page_id, from_id) row in the comments table
--   → 465 rows get their canonical name filled in
--
-- Idempotent: UPDATE is guarded by IS NULL / empty — re-running does nothing.

UPDATE "conversations" c
SET
    sender_name = sub.from_name,
    updated_at = NOW()
FROM (
    SELECT DISTINCT ON (p.page_id, cm.from_id)
        p.page_id,
        cm.from_id,
        cm.from_name
    FROM "comments" cm
    JOIN "posts" p ON p.id = cm.post_id
    WHERE cm.from_name IS NOT NULL AND cm.from_name != ''
    ORDER BY p.page_id, cm.from_id, cm.created_at DESC
) sub
WHERE c.page_id = sub.page_id
  AND c.sender_id = sub.from_id
  AND (c.sender_name IS NULL OR c.sender_name = '');
--> statement-breakpoint

-- Also update the legacy messages.sender_name column so the JOIN fallback path
-- reflects the same name — matches what the application-level dual-write does.
UPDATE "messages" m
SET
    sender_name = c.sender_name,
    updated_at = NOW()
FROM "conversations" c
WHERE m.conversation_id = c.id
  AND c.sender_name IS NOT NULL
  AND c.sender_name != ''
  AND (m.sender_name IS NULL OR m.sender_name = '');
