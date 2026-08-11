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
5. **The merchant is notified.** An `auto_reply_paused` in-app + push notification to every workspace member (falling back to the page owner when the page has no workspace), and an email (`autoPausedEmailTemplate`, in the owner's dashboard language) to the **page owner** — the original connector, i.e. the one user whose re-auth can refresh a dead token. Added after 2026-08-10, when a real page auto-paused twice in one evening and the merchant learned about it from lost customers.

   ⚠️ **The alert is gated to Facebook-family channels; the pause is not.** `recordSendFailure` counts a page-level failure from *any* channel, but every string in this alert is Facebook-specific ("reconnect the page", "complete the Facebook sign-in", "if you changed your Facebook password"). `NOTIFIABLE_AUTO_PAUSE_PLATFORMS` therefore allowlists `facebook`, `instagram`, and `undefined` (the comment path passes no platform, and comments exist only on those two). **WhatsApp deliberately gets nothing rather than something wrong** — its credential is a separate WABA token with its own reconnect flow, so the copy is false on every clause. Its dead-token case already alerts through [markWhatsAppNeedsReconnect](../backend/src/services/whatsappTokenHealth.ts), fired on the *first* 190 so it never reaches this threshold. An allowlist, not a WhatsApp denylist: a channel added later must default to silence rather than inherit Facebook copy by omission.

   > ❌ **NOT IMPLEMENTED — a WhatsApp auto-pause alert.** The causes that *do* drive a WhatsApp channel to this threshold (WABA quality restriction, policy block) currently produce a pause with **no merchant-facing signal at all** beyond the dashboard banner. That is the pre-2026-08 state for those merchants, deliberately preferred over wrong instructions. Closing it needs WhatsApp-specific copy and recovery steps — do not reuse the Facebook strings.

   Four deliberate choices here, each of which was a bug first:

   - **Awaited, not fire-and-forget.** Both callers already dispatch `recordSendFailure` with `void`, so awaiting costs the reply path nothing — and it keeps the notification's queries inside the caller's promise. The `void` version escaped the integration suite's per-test `TRUNCATE` (queries landing after the test that spawned them), which is a flaky-gate generator.
   - **The email dedup fails OPEN.** One email per page per 24h via `notif:auto_pause_email:<pageId>`, so a merchant stuck in a toggle → re-pause loop isn't spammed. But if Redis is unreachable the email is sent anyway: the crossing guard already limits this to one email per pause cycle without Redis at all, so a Redis blip must not cost the merchant their most important alert.
   - **Both email failure shapes release the key** — hence a `finally`, not a check on `result.success`. `emailService.send` fails in two ways and they are NOT interchangeable: it *resolves* with `{ success: false }` for a provider-level failure (Resend 4xx/5xx, unconfigured key), and it *throws* for a network-level one, because there is no try/catch around its `fetch` — DNS failure, socket reset, TLS error and timeout all arrive as a raw `TypeError`. Releasing only on the resolved shape left the likelier outage shape holding the key for the full 24 h, and the crossing guard guarantees no retry inside that window, so the merchant simply never heard that their page had stopped answering.
   - **The notification fails independently of the email.** `sendNotification` has no internal catch — a failed `notifications` insert, or the workspace-members query, throws straight out. Sharing one `try` made the least reliable channel a hard gate on the most important one, while the dedup above deliberately fails OPEN to protect that same email. Each channel now gets its own attempt.

   The in-app notification is registered in [notificationUtils.ts](../frontend/src/components/ui/notificationUtils.ts) — route (`/pages`), icon, and account-health pin. **A notification type is only half-shipped when the backend can send it:** an unregistered type renders as a generic bell with no chevron and does nothing on tap, which strands the merchant on the one alert that demands an action. Pinned by `notificationUtils.test.ts`.

### Recovery

The customer toggles auto-reply back on in the UI ([pages.ts toggleAutoReply](../backend/src/services/pages.ts)). The off → on transition clears all three columns, giving the page a fresh start. If the underlying Meta-side issue persists, the counter climbs back to the threshold and the page pauses again — no manual operator intervention required either way.

**When the cause is an invalidated token** (Graph `code=190, subcode=460` — the merchant changed their Facebook password or Meta forced re-auth), toggling alone is a trap: the stored page token stays dead, so the page re-pauses within minutes and each cycle burns ~10 customer messages. The merchant must **reconnect the page in Jawab24 first** (a full Facebook dialog — signing in and out of facebook.com does nothing to our stored token), *then* toggle auto-reply back on. This exact loop happened in production on 2026-08-10, which is why the notification copy leads with the reconnect step.

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

Plus, for Facebook-family channels only (see step 5 above), since 2026-08: an in-app + push notification to the workspace and an email to the page owner, both carrying the two-step fix (reconnect the page, then re-enable) and the explicit warning that a Facebook login/logout is not enough. Notification copy: `auto_reply_paused` in [notifications.ts](../backend/src/services/notifications.ts); email copy: `autoPaused*` keys in [backend/src/i18n](../backend/src/i18n/en.json). A WhatsApp-driven pause gets the banner and nothing else — see the ❌ note in step 5.

## What this is NOT

- **Not a token disconnect.** The page row stays connected; `access_token` is left intact, `disconnect_reason` stays empty. ⚠️ That does **not** mean the token is healthy: a dead token (`our_fault`, e.g. Graph 190/460 after a Facebook password change) is one of the buckets that *causes* the pause, and in that case the DB row still looks fully connected — diagnose from the send-failure logs, not the row, and the fix **is** a reconnect. For Page-side causes (restricted, unpublished, lost permission) the token genuinely works and reconnecting won't help.
- **Not a retry/backoff scheduler.** There's no background job that tries the page again. Recovery is explicit, customer-driven.
- **Not a billing/usage fix.** The customer's smart-reply usage counter still counts AI generations (not deliveries). That's a separate decision tracked elsewhere.
- **Not a substitute for the existing `disconnectReason` field.** `disconnectReason` is set when the token is revoked/dead. `autoPauseReason` is set when the token works but the Page rejects sends. Different states, separate columns.

## Tuning the knobs

If the threshold proves too lenient (real wasted credit) or too aggressive (false-pause during a 5-minute Meta outage misclassified as `unknown`), edit `PAUSE_THRESHOLD` in [backend/src/services/pageAutoPause.ts](../backend/src/services/pageAutoPause.ts). The integration tests in [backend/test/integration/pageAutoPause.test.ts](../backend/test/integration/pageAutoPause.test.ts) read the same constant, so they'll continue to match.

If a new `DmFailureBucket` is added, decide whether it's page-level or per-customer and update `PAGE_LEVEL_BUCKETS` in the same file.
