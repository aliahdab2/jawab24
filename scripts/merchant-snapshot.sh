#!/bin/bash
# Capture a merchant's configuration + volume state as a stable, diff-able snapshot.
#
# Purpose: prove that a deploy changed ONLY what it was meant to change. Take a
# snapshot before, take another after, `diff` them. Anything that moves and
# shouldn't is a regression you would otherwise never have noticed — a migration
# rewriting a default, a settings sync clobbering a merchant's choice, a JSONB
# drift-heal overwriting the pipeline's read target.
#
# Output is deliberately sorted key=value lines so `diff` is readable.
#
# PRIVACY: never dumps access tokens or lead phone numbers. Leads and messages
# are reduced to counts and statuses — enough to spot a behavioural change,
# nothing that turns a debugging artifact into a customer-data file. Write the
# output OUTSIDE the repo; it is not meant to be committed.
#
# Usage:
#   ./scripts/merchant-snapshot.sh <user-email> [output-file]
#   ./scripts/merchant-snapshot.sh huseinothman82@gmail.com ~/jawab24-snapshots/husein-before.txt
#   diff ~/jawab24-snapshots/husein-{before,after}.txt

set -euo pipefail

EMAIL="${1:?merchant email required}"
OUT="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUERY="$SCRIPT_DIR/prod-db-query.sh"

# One statement, one packed column per row: "section|key|value". psql -x prints
# "?column? | <packed>", so the shell strips the label and we get stable lines.
# NOTE: this runner is SELECT-only (see prod-db-query.sh) — keep it that way.
# Heredoc goes to a FILE, not into $( ) — bash cannot reliably find the closing
# paren of a command substitution whose heredoc body contains SQL punctuation.
SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT

cat > "$SQL_FILE" <<SQLEOF
WITH u AS (
  SELECT id FROM users WHERE email = '${EMAIL}'
)
SELECT 'settings' || '|' || key || '|' || coalesce(value, '(null)')
FROM u, LATERAL (
  SELECT 'ai_enabled' AS key, s.ai_enabled::text AS value FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'ai_model', s.ai_model FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'messages_auto_reply', s.messages_auto_reply::text FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'comments_auto_reply', s.comments_auto_reply::text FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'comment_reply_mode', s.comment_reply_mode FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'business_hours_only', s.business_hours_only::text FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'business_hours_start', s.business_hours_start FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'business_hours_end', s.business_hours_end FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'timezone', s.timezone FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'default_reply_language', s.default_reply_language FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'reply_style', s.reply_style FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'handoff_pause_minutes', s.handoff_pause_duration_minutes::text FROM settings s WHERE s.user_id = u.id
  -- Drizzle stores these jsonb columns as a STRING, so a direct #>>'{ar}' returns
  -- NULL and silently reports "no away message". Unwrap with #>>'{}' then re-cast.
  UNION ALL SELECT 'away_message_ar', left(((s.away_message_multi #>> '{}')::jsonb ->> 'ar'), 60) FROM settings s WHERE s.user_id = u.id
  UNION ALL SELECT 'greeting_enabled', s.greeting_message_enabled::text FROM settings s WHERE s.user_id = u.id
  -- Read via to_jsonb(row) so this line works BOTH before and after the D-034
  -- migration adds the column: a missing key yields NULL instead of erroring the
  -- whole snapshot, which is what naming the column directly would do.
  UNION ALL SELECT 'after_hours_smart_reply', (to_jsonb(s) ->> 'after_hours_smart_reply') FROM settings s WHERE s.user_id = u.id
) AS settings_rows

UNION ALL
-- The pipeline reads the workspace JSONB, NOT the settings table. A snapshot of
-- one without the other would miss exactly the drift that matters.
SELECT 'workspace_jsonb' || '|' || key || '|' || coalesce(value, '(null)')
FROM u, workspace_members wm, workspaces w, LATERAL (
  SELECT 'messages_auto_reply' AS key, ((w.settings #>> '{}')::jsonb ->> 'messagesAutoReply') AS value
  UNION ALL SELECT 'comments_auto_reply', ((w.settings #>> '{}')::jsonb ->> 'commentsAutoReply')
  UNION ALL SELECT 'business_hours_only', ((w.settings #>> '{}')::jsonb ->> 'businessHoursOnly')
  UNION ALL SELECT 'business_hours_start', ((w.settings #>> '{}')::jsonb ->> 'businessHoursStart')
  UNION ALL SELECT 'business_hours_end', ((w.settings #>> '{}')::jsonb ->> 'businessHoursEnd')
  UNION ALL SELECT 'after_hours_smart_reply', ((w.settings #>> '{}')::jsonb ->> 'afterHoursSmartReply')
  UNION ALL SELECT 'timezone', ((w.settings #>> '{}')::jsonb ->> 'timezone')
  UNION ALL SELECT 'ai_model', ((w.settings #>> '{}')::jsonb ->> 'aiModel')
  UNION ALL SELECT 'comment_reply_mode', ((w.settings #>> '{}')::jsonb ->> 'commentReplyMode')
  UNION ALL SELECT 'workspace_name', w.name
) AS ws_rows
WHERE wm.user_id = u.id AND w.id = wm.workspace_id

UNION ALL
SELECT 'page' || '|' || p.facebook_page_id || '|' ||
       'name=' || coalesce(p.name, '?') ||
       ' auto_reply=' || coalesce(p.auto_reply_enabled::text, '?') ||
       ' kb_len=' || length(coalesce(p.knowledge_base, '')) ||
       ' kb_ver=' || coalesce(p.kb_active_version::text, '-') ||
       ' paused=' || coalesce(p.auto_pause_reason, '-') ||
       ' vertical=' || coalesce(p.catalog_vertical, '-')
FROM u, pages p WHERE p.user_id = u.id

UNION ALL
SELECT 'subscription' || '|' || 'plan_status_trial' || '|' ||
       pl.slug || ' / ' || sub.status || ' / quota=' || pl.max_ai_replies_per_month ||
       ' / trial_ends=' || coalesce(sub.trial_ends_at::date::text, '-')
FROM u, subscriptions sub JOIN plans pl ON pl.id = sub.plan_id
WHERE sub.user_id = u.id

UNION ALL
SELECT 'volume' || '|' || key || '|' || value
FROM u, LATERAL (
  SELECT 'messages_incoming' AS key, count(*) FILTER (WHERE m.direction = 'incoming')::text AS value
    FROM messages m JOIN pages p ON p.id = m.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'messages_outgoing', count(*) FILTER (WHERE m.direction = 'outgoing')::text
    FROM messages m JOIN pages p ON p.id = m.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'messages_replied', count(*) FILTER (WHERE m.direction = 'incoming' AND m.replied)::text
    FROM messages m JOIN pages p ON p.id = m.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'needs_attention', count(*) FILTER (WHERE m.needs_attention)::text
    FROM messages m JOIN pages p ON p.id = m.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'flag_sla_no_reply', count(*) FILTER (WHERE m.flag_reason = 'sla_no_reply')::text
    FROM messages m JOIN pages p ON p.id = m.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'flag_complaint', count(*) FILTER (WHERE m.flag_reason = 'complaint')::text
    FROM messages m JOIN pages p ON p.id = m.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'flag_kb_gap', count(*) FILTER (WHERE m.flag_reason LIKE '%not_in_kb%')::text
    FROM messages m JOIN pages p ON p.id = m.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'leads_total', count(*)::text
    FROM leads l JOIN pages p ON p.id = l.page_id WHERE p.user_id = u.id
  UNION ALL SELECT 'ai_calls', count(*)::text FROM ai_usage_log a WHERE a.user_id = u.id
) AS volume_rows

ORDER BY 1;
SQLEOF


RESULT=$("$QUERY" --file "$SQL_FILE" | sed -n 's/^?column? | //p' | sort)

STAMP="# merchant snapshot: ${EMAIL}"
if [ -n "$OUT" ]; then
  mkdir -p "$(dirname "$OUT")"
  { echo "$STAMP"; echo "$RESULT"; } > "$OUT"
  echo "✅ snapshot written to $OUT ($(echo "$RESULT" | wc -l | tr -d ' ') lines)"
  echo "   compare later with: diff \"$OUT\" <new-snapshot>"
else
  echo "$STAMP"
  echo "$RESULT"
fi
