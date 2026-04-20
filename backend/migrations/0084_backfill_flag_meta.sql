-- Backfill flag_reason + flag_meta for legacy rows written before the flag_meta
-- column existed (migration 0083 added it). Two classes of legacy encodings get
-- normalized here:
--
--   sla_no_reply:60          → flag_reason='sla_no_reply',
--                              flag_meta={'sla_no_reply':{'minutes':60}}
--   "DM failed: unknown"     → flag_reason='dm_failed',
--                              flag_meta={'dm_failed':{'bucket':'unknown'}}
--
-- Idempotent — the WHERE clauses only match rows still in legacy form.

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------

UPDATE "comments"
SET flag_reason = 'sla_no_reply',
    flag_meta   = jsonb_build_object(
        'sla_no_reply',
        jsonb_build_object('minutes', (regexp_match(flag_reason, '^sla_no_reply:(\d+)$'))[1]::int)
    ),
    updated_at  = now()
WHERE flag_reason ~ '^sla_no_reply:\d+$';

UPDATE "comments"
SET flag_reason = 'dm_failed',
    flag_meta   = jsonb_build_object(
        'dm_failed',
        jsonb_build_object('bucket', (regexp_match(flag_reason, '^DM failed: (\w+)$'))[1])
    ),
    updated_at  = now()
WHERE flag_reason ~ '^DM failed: \w+$';

-- ---------------------------------------------------------------------------
-- instagram_comments
-- ---------------------------------------------------------------------------

UPDATE "instagram_comments"
SET flag_reason = 'sla_no_reply',
    flag_meta   = jsonb_build_object(
        'sla_no_reply',
        jsonb_build_object('minutes', (regexp_match(flag_reason, '^sla_no_reply:(\d+)$'))[1]::int)
    ),
    updated_at  = now()
WHERE flag_reason ~ '^sla_no_reply:\d+$';

UPDATE "instagram_comments"
SET flag_reason = 'dm_failed',
    flag_meta   = jsonb_build_object(
        'dm_failed',
        jsonb_build_object('bucket', (regexp_match(flag_reason, '^DM failed: (\w+)$'))[1])
    ),
    updated_at  = now()
WHERE flag_reason ~ '^DM failed: \w+$';

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

UPDATE "messages"
SET flag_reason = 'sla_no_reply',
    flag_meta   = jsonb_build_object(
        'sla_no_reply',
        jsonb_build_object('minutes', (regexp_match(flag_reason, '^sla_no_reply:(\d+)$'))[1]::int)
    ),
    updated_at  = now()
WHERE flag_reason ~ '^sla_no_reply:\d+$';

UPDATE "messages"
SET flag_reason = 'dm_failed',
    flag_meta   = jsonb_build_object(
        'dm_failed',
        jsonb_build_object('bucket', (regexp_match(flag_reason, '^DM failed: (\w+)$'))[1])
    ),
    updated_at  = now()
WHERE flag_reason ~ '^DM failed: \w+$';
