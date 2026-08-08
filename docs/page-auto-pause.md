# Defensive Page Auto-Pause

## The problem this solves

When a customer connects a Facebook Page to Jawab24, the OAuth flow only writes Pages that Meta itself returns from `/me/accounts` or via the `granular_scopes` fallback — both surfaces are Pages-only, so a Group can never enter the `pages` table.

But "is a Page" doesn't mean "still working." A Page can:

- Be **restricted by Meta** (e.g. flagged by Meta's automated systems for community standards, ads policy, or trader rules). The token still authenticates, comment webhooks may still fire, but every reply send fails.
- Be **unpublished** by the owner after connecting.
- **Lose a permission mid-flight** (`pages_messaging` revoked, page role changed, app removed from a specific page in Business Manager).

Without defense, Jawab24 keeps ingesting comments and **burning AI credit** generating replies that Facebook then rejects on send. The customer's quota drains, the bot appears active in the dashboard ("1000 / 112 smart replies used"), but on Facebook there's nothing visible. The first customer to hit this in production (page `133117600703063` "Amanda Molly", 2026-05-21) burned 112 AI credits for **4 successfully delivered replies** — a 96.6% waste rate.

## The mechanism

Three new columns on `pages`:

| Column | Purpose |
|---|---|
| `consecutive_send_failures` | Running count of back-to-back page-level send failures. Reset to 0 on any successful send. |
| `auto_pause_reason` | `'send_rejected'` when the page was auto-paused. `NULL` otherwise. |
| `auto_paused_at` | Timestamp of the auto-pause for audit/support purposes. |

### Counting rules

The counter only bumps for **page-level** failure buckets (defined in [backend/src/utils/fbGraphErrors.ts](../backend/src/utils/fbGraphErrors.ts)):

- `our_fault` — bad token, missing permission. The Page itself rejected our credentials.
- `unknown` — unclassified. We don't know what's wrong; safe default is "could be the Page."
- No bucket (comment-reply failures) — treated as `unknown`.

Per-customer / per-conversation failures explicitly do **not** count:

- `customer_refused` — the *customer's* account blocks page DMs. Next customer may work.
- `window_expired` — outside the 24h messaging window for one conversation.
- `transient` — rate limit, network blip, 5xx. The send will be retried; we don't punish the page.

`thread_owned_elsewhere` (another app owns the conversation via Meta's Handover
Protocol — Graph error 100/2534037) is **channel-level, not page-level**: it breaks
every send on its platform but the page's other platforms keep working, so it never
counts toward the pause. It feeds the per-platform streak below instead.

### Per-platform failure streak (detection only)

The page counter above resets on **any** successful send — so a page healthy on one
platform can mask a channel that is 100% dead on another, indefinitely. That is
exactly how a merchant's Instagram stayed silently broken for 6 days while their
Facebook traffic kept the counter at zero (MES, 2026-08-08).

The DM pipeline therefore also keeps a per-`(page, platform)` consecutive-failure
streak in Redis (`sendfail:<pageId>:<platform>`, 7-day TTL). Channel-level buckets
(`our_fault`, `unknown`, no bucket, `thread_owned_elsewhere`) increment it; a
successful send on **that platform** deletes it; it raises a Sentry alert
(`pageAutoPause.platformChannelDown`) at escalating marks — 5, 50, and 500
consecutive failures — so a permanently-dead channel re-surfaces even if the first
alert is missed (continuing failures refresh the TTL, so the key never expires on
its own). It is purely a detection signal — it never gates, pauses, or retries
anything, and it never blocks the reply path (fire-and-forget, same discipline as
the AI lifecycle counters).

### Threshold and what happens at it

Default `PAUSE_THRESHOLD = 10` ([backend/src/services/pageAutoPause.ts](../backend/src/services/pageAutoPause.ts)).

When the counter crosses the threshold (in a single atomic UPDATE):

1. `auto_reply_enabled = false` — both processors already short-circuit on this flag *before* the OpenAI call ([commentProcessor.ts:104](../backend/src/services/reply/commentProcessor.ts#L104), [messageProcessor.ts:188](../backend/src/services/reply/messageProcessor.ts#L188)). **This is what stops the AI-credit bleed.**
2. `auto_pause_reason = 'send_rejected'`
3. `auto_paused_at = NOW()`
4. A `page.auto_reply_toggled` audit event is emitted (`actor: 'system'`, `reason: 'auto_pause'`) via [logAutoReplyToggle](../backend/src/services/auditLog.ts) — a timestamped record of the pause in the `logs` table, distinct from the standing `auto_pause_reason` column. See [Audit trail](#audit-trail) below.

### Recovery

The customer toggles auto-reply back on in the UI ([pages.ts toggleAutoReply](../backend/src/services/pages.ts)). The off → on transition clears all three columns, giving the page a fresh start. If the underlying Meta-side issue persists, the counter climbs back to the threshold and the page pauses again — no manual operator intervention required either way.

Disabling auto-reply (on → off) **preserves** the pause-reason audit trail so support can see "this page was auto-paused at X, then the customer toggled it off."

### Audit trail

Every change to a page's auto-reply switch — merchant dashboard toggle, this system auto-pause, and Facebook (re)connect/deselect — emits a single `page.auto_reply_toggled` event through [logAutoReplyToggle](../backend/src/services/auditLog.ts), landing in the `logs` table with detail in `metadata`: `{ enabled, previous, reason, actor, channel }`. `actor` is `'user'` when a merchant/admin initiated it (with the acting `user_id`) and `'system'` when the pipeline did (auto-pause). This means "who turned this page on/off, and when?" is one query —

```sql
SELECT created_at, user_id, metadata
FROM logs
WHERE action = 'page.auto_reply_toggled'
  AND page_id = '<page-id>'
ORDER BY created_at DESC;
```

— instead of reconstructing intent from row `updated_at` timestamps.

> **Why `page_id`, not `metadata->>'entityId'`.** postgres-js stores `logs.metadata` as a double-encoded JSON *string* scalar (`jsonb_typeof = 'string'` — the same footgun documented in [flagMeta.test.ts](../backend/test/integration/flagMeta.test.ts)), so `metadata->>'…'` filters silently return `NULL`. The event is therefore keyed off the typed `page_id` / `user_id` columns; `metadata` is for *reading* the detail once you've selected the rows, never for SQL filtering. Contract pinned by [auditAutoReplyToggle.test.ts](../backend/test/integration/auditAutoReplyToggle.test.ts).

The standing `auto_pause_reason` / `auto_reply_disabled_reason` columns still describe the *current* state; the audit log is the *history*.

### What the customer sees

A bilingual banner on the Page card on the dashboard ([PageAccordionItem.tsx](../frontend/src/components/dashboard/PageAccordionItem.tsx)):

> *"Facebook kept rejecting our replies on this page, so auto-reply was paused to protect your quota. Check the page on Facebook — it may be restricted, unpublished, or missing a permission — then turn auto-reply back on."*

Translation keys: `pages.autoPausedSendRejected` (EN + AR).

## What this is NOT

- **Not a token disconnect.** The page row stays connected; `access_token` is left intact. The token works fine; it's the Page that's misbehaving. Reconnecting won't help.
- **Not a retry/backoff scheduler.** There's no background job that tries the page again. Recovery is explicit, customer-driven.
- **Not a billing/usage fix.** The customer's smart-reply usage counter still counts AI generations (not deliveries). That's a separate decision tracked elsewhere.
- **Not a substitute for the existing `disconnectReason` field.** `disconnectReason` is set when the token is revoked/dead. `autoPauseReason` is set when the token works but the Page rejects sends. Different states, separate columns.

## Tuning the knobs

If the threshold proves too lenient (real wasted credit) or too aggressive (false-pause during a 5-minute Meta outage misclassified as `unknown`), edit `PAUSE_THRESHOLD` in [backend/src/services/pageAutoPause.ts](../backend/src/services/pageAutoPause.ts). The integration tests in [backend/test/integration/pageAutoPause.test.ts](../backend/test/integration/pageAutoPause.test.ts) read the same constant, so they'll continue to match.

If a new `DmFailureBucket` is added, decide whether it's page-level or per-customer and update `PAGE_LEVEL_BUCKETS` in the same file.
