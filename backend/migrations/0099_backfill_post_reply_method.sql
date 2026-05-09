-- Backfill: distinguish per-post keyword-trigger replies (Post Reply) from
-- AI-fallback templates. Both previously persisted as reply_method='template',
-- which conflated them in analytics (the dashboard counted Post Replies as
-- "Smart Replies", contradicting the AI quota-exhaustion banner).
--
-- New value: 'post_reply' for keyword-trigger sends. 'template' now means
-- canned/fallback strings only (AI fallback or greeting/away message).
--
-- Heuristic for retrofitting historical rows: a row is a Post Reply send iff
--   1. reply_method = 'template'
--   2. the parent post has trigger_keyword + trigger_reply configured
--   3. the row's reply_text exactly matches the post's trigger_reply
-- The reply_text equality check is the precise discriminator — fallback templates
-- ('Thanks for your comment!', 'شكراً لتعليقك!') will never match a merchant's
-- configured trigger_reply.
--
-- Outgoing DMs stored by the comment-trigger path (commentProcessor.ts
-- storeOutgoingMessage call) inherit the same reply_method as the comment.
-- The DM's text is the verbatim content.triggerReply, so the same
-- exact-text discriminator works. The originating post is reachable via
-- conversations.origin_content_id (first-write-wins; set when the
-- comment->DM is created — see schema.ts:381). DMs from conversations that
-- never originated from a comment trigger have origin_content_id = NULL,
-- so the JOIN naturally excludes them.
--
-- Note on scale: tables can be large on multi-tenant deployments. Each
-- UPDATE is bounded by reply_method = 'template' (a small fraction of
-- replies on accounts that don't lean on AI fallback) AND an exact-text
-- equality, so candidate rows stay small. If a deployment estimates
-- >5M matched rows, batch via id-range loops; for current scale a single
-- statement per table is acceptable.
--
-- Idempotent: WHERE clause excludes rows already migrated.
UPDATE "comments" c
SET "reply_method" = 'post_reply'
FROM "posts" p
WHERE c."post_id" = p."id"
  AND c."reply_method" = 'template'
  AND p."trigger_keyword" IS NOT NULL
  AND p."trigger_reply" IS NOT NULL
  AND c."reply_text" = p."trigger_reply";

UPDATE "instagram_comments" ic
SET "reply_method" = 'post_reply'
FROM "instagram_media" m
WHERE ic."media_id" = m."id"
  AND ic."reply_method" = 'template'
  AND m."trigger_keyword" IS NOT NULL
  AND m."trigger_reply" IS NOT NULL
  AND ic."reply_text" = m."trigger_reply";

-- Outgoing Facebook DMs whose conversation originated from a comment
-- with a configured trigger_reply matching the DM text.
UPDATE "messages" msg
SET "reply_method" = 'post_reply'
FROM "conversations" conv, "posts" p
WHERE msg."conversation_id" = conv."id"
  AND conv."origin_content_id" = p."id"
  AND conv."platform" = 'facebook'
  AND msg."direction" = 'outgoing'
  AND msg."reply_method" = 'template'
  AND p."trigger_keyword" IS NOT NULL
  AND p."trigger_reply" IS NOT NULL
  AND msg."reply_text" = p."trigger_reply";

-- Outgoing Instagram DMs — same join via instagram_media.
UPDATE "messages" msg
SET "reply_method" = 'post_reply'
FROM "conversations" conv, "instagram_media" m
WHERE msg."conversation_id" = conv."id"
  AND conv."origin_content_id" = m."id"
  AND conv."platform" = 'instagram'
  AND msg."direction" = 'outgoing'
  AND msg."reply_method" = 'template'
  AND m."trigger_keyword" IS NOT NULL
  AND m."trigger_reply" IS NOT NULL
  AND msg."reply_text" = m."trigger_reply";
