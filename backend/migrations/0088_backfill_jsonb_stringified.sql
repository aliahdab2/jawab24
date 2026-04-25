-- Backfill jsonb columns that were corrupted by the drizzle-orm 0.29 jsonb
-- mapper bug (fixed 2026-04-25 in src/db/jsonb.ts). Affected rows have
-- jsonb_typeof(col) = 'string' — i.e. the JSON object/array was stored as
-- a JSON string scalar like `"\"{\\\"foo\\\":1}\""`.
--
-- Confirmed in prod: 48 of 55 dm_failed comment rows in a 14-day window had
-- jsonb_typeof(flag_meta) = 'string'. Same bug class affects every jsonb
-- write site in the codebase, so this migration repairs every writeable
-- jsonb column.
--
-- Repair: `(col #>> '{}')::jsonb`
--   - `col #>> '{}'` on a jsonb string scalar returns the unwrapped string
--     content (the original JSON text the application meant to store).
--   - `::jsonb` reparses that text back into the proper object/array shape.
--   - The WHERE jsonb_typeof = 'string' filter makes this idempotent — only
--     corrupted rows are touched, healthy rows are skipped.

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
UPDATE "workspaces" SET settings = (settings #>> '{}')::jsonb
 WHERE jsonb_typeof(settings) = 'string';

-- ---------------------------------------------------------------------------
-- pages
-- ---------------------------------------------------------------------------
UPDATE "pages" SET business_profile = (business_profile #>> '{}')::jsonb
 WHERE jsonb_typeof(business_profile) = 'string';

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
UPDATE "comments" SET message_tags = (message_tags #>> '{}')::jsonb
 WHERE jsonb_typeof(message_tags) = 'string';
UPDATE "comments" SET flag_meta = (flag_meta #>> '{}')::jsonb
 WHERE jsonb_typeof(flag_meta) = 'string';

-- ---------------------------------------------------------------------------
-- instagram_comments
-- ---------------------------------------------------------------------------
UPDATE "instagram_comments" SET flag_meta = (flag_meta #>> '{}')::jsonb
 WHERE jsonb_typeof(flag_meta) = 'string';

-- ---------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------
UPDATE "settings" SET greeting_message_multi = (greeting_message_multi #>> '{}')::jsonb
 WHERE jsonb_typeof(greeting_message_multi) = 'string';
UPDATE "settings" SET away_message_multi = (away_message_multi #>> '{}')::jsonb
 WHERE jsonb_typeof(away_message_multi) = 'string';
UPDATE "settings" SET dual_reply_nudge_multi = (dual_reply_nudge_multi #>> '{}')::jsonb
 WHERE jsonb_typeof(dual_reply_nudge_multi) = 'string';
UPDATE "settings" SET dual_reply_nudge_variations = (dual_reply_nudge_variations #>> '{}')::jsonb
 WHERE jsonb_typeof(dual_reply_nudge_variations) = 'string';
UPDATE "settings" SET brand_voice_notes_multi = (brand_voice_notes_multi #>> '{}')::jsonb
 WHERE jsonb_typeof(brand_voice_notes_multi) = 'string';

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
UPDATE "messages" SET flag_meta = (flag_meta #>> '{}')::jsonb
 WHERE jsonb_typeof(flag_meta) = 'string';

-- ---------------------------------------------------------------------------
-- ai_cache
-- ---------------------------------------------------------------------------
UPDATE "ai_cache" SET metadata = (metadata #>> '{}')::jsonb
 WHERE jsonb_typeof(metadata) = 'string';

-- ---------------------------------------------------------------------------
-- logs
-- ---------------------------------------------------------------------------
UPDATE "logs" SET metadata = (metadata #>> '{}')::jsonb
 WHERE jsonb_typeof(metadata) = 'string';

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
UPDATE "plans" SET regional_pricing = (regional_pricing #>> '{}')::jsonb
 WHERE jsonb_typeof(regional_pricing) = 'string';

-- ---------------------------------------------------------------------------
-- usage
-- ---------------------------------------------------------------------------
UPDATE "usage" SET daily_breakdown = (daily_breakdown #>> '{}')::jsonb
 WHERE jsonb_typeof(daily_breakdown) = 'string';

-- ---------------------------------------------------------------------------
-- usage_logs
-- ---------------------------------------------------------------------------
UPDATE "usage_logs" SET metadata = (metadata #>> '{}')::jsonb
 WHERE jsonb_typeof(metadata) = 'string';

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
UPDATE "notifications" SET titles = (titles #>> '{}')::jsonb
 WHERE jsonb_typeof(titles) = 'string';
UPDATE "notifications" SET bodies = (bodies #>> '{}')::jsonb
 WHERE jsonb_typeof(bodies) = 'string';
UPDATE "notifications" SET data = (data #>> '{}')::jsonb
 WHERE jsonb_typeof(data) = 'string';

-- ---------------------------------------------------------------------------
-- ecommerce_stores
-- ---------------------------------------------------------------------------
UPDATE "ecommerce_stores" SET platform_data = (platform_data #>> '{}')::jsonb
 WHERE jsonb_typeof(platform_data) = 'string';

-- ---------------------------------------------------------------------------
-- kb_chunks
-- ---------------------------------------------------------------------------
UPDATE "kb_chunks" SET metadata = (metadata #>> '{}')::jsonb
 WHERE jsonb_typeof(metadata) = 'string';

-- ---------------------------------------------------------------------------
-- semantic_cache
-- ---------------------------------------------------------------------------
UPDATE "semantic_cache" SET metadata = (metadata #>> '{}')::jsonb
 WHERE jsonb_typeof(metadata) = 'string';

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
UPDATE "leads" SET extracted_data = (extracted_data #>> '{}')::jsonb
 WHERE jsonb_typeof(extracted_data) = 'string';

-- ---------------------------------------------------------------------------
-- admin_audit_logs
-- ---------------------------------------------------------------------------
UPDATE "admin_audit_logs" SET previous_value = (previous_value #>> '{}')::jsonb
 WHERE jsonb_typeof(previous_value) = 'string';
UPDATE "admin_audit_logs" SET new_value = (new_value #>> '{}')::jsonb
 WHERE jsonb_typeof(new_value) = 'string';
