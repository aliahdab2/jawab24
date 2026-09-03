# Merchant Settings Reference

> The single place that explains every merchant-facing setting: where it is stored, which
> pipeline gate reads it, and what the customer actually receives in each state. Update this
> file **in the same commit** as any change to a settings field or to the gates/auto-messages
> below (AI_INSTRUCTIONS.md Rule 15).

## Storage model

- **`settings` table — keyed by `user_id`, one row per merchant.** Settings are per-user,
  NOT per-page: a merchant with three pages has one settings row governing all of them.
  This legacy row is the **UI write target**; on every save the pipeline-relevant fields
  are synced into the workspace JSONB (`syncPipelineFieldsToWorkspace`).
- **`workspaces.settings` JSONB — the pipeline read target (D-026).** Every reply-path
  gate reads `workspaceSettingsService.getSettings(page.workspaceId)` (JSONB merged over
  read-time defaults, with drift-heal from the owner's legacy row for *missing* keys).
  ⚠️ The two stores drift **by design**: `NEW_SIGNUP_SETTINGS_SEED` (D-025) writes
  auto-reply OFF into the JSONB only, so a new signup's legacy row shows the column
  defaults (everything ON) while the pipeline is silent. Therefore **no display surface
  may show the raw legacy row**: the merchant settings API and the admin support console
  (`getUserDetail` → `overlayPipelineSettings`) both overlay `WORKSPACE_OVERLAY_FIELDS`
  (`services/pipelineFields.ts`) from the workspace store before display/diagnostics.
  Sole exception: `aiModel` — the admin override writes the legacy table and
  `aiModelResolver` reads it back, so legacy is authoritative for that one field.
  The shared overlay loop is `overlayWorkspaceFields` (`services/pipelineFields.ts`) —
  both surfaces call it; never re-implement the loop at a call site.
  - The console resolves **which** workspace to overlay from the displayed pages'
    own `pages.workspaceId` (what the pipeline keys on), falling back to
    memberships only when there are no pages (`resolvePipelineWorkspaceId`).
  - The console payload carries `settings.source`: `'effective'` (overlaid) or
    `'legacy-fallback'` (overlay unavailable — the UI shows a warning banner,
    because raw legacy values are exactly the state that hid the 30 silent
    post-D-025 signups).
  - The console's "changed from default" markers compare against the **legacy
    column defaults** — so every post-D-025 signup shows `commentsAutoReply`,
    `messagesAutoReply`, `commentReplyMode` as changed. That is the signup seed,
    not merchant action.
- **`pages.auto_reply_enabled` — the page master switch** lives on the page row, not in
  settings. `pages.auto_reply_disabled_reason` records who/what turned it off (`user`, …).
- **Multilingual fields** (`*_multi` JSONB) hold `{ ar, en, sourceLang }`. `sourceLang`
  (`'ar' | 'en' | 'manual' | 'default'`) is **bookkeeping for the auto-translate flow, not
  copy**. Anything reading these records must go through
  `workspaceSettings.pickMultilingualText()`, which excludes it — a naive
  `Object.values(multi).find(...)` sent the literal string `"manual"` as a customer message
  (fixed 2026-08-02; `getLimitFallbackMessage` had the same guard inline since earlier).
- Legacy single-language columns (`away_message`, `greeting_message`, `brand_voice_notes`)
  still exist; the pipeline reads the `*_multi` variants via `workspaceSettingsService`.

## The gate chain (what runs before any reply)

A DM passes these in order (`messageProcessor.processMessage`); a comment passes the
equivalents in `commentProcessor`:

| # | Gate | Setting read | Customer sees when it blocks |
|---|------|--------------|------------------------------|
| 1 | **Page master switch** | `pages.auto_reply_enabled` | **Nothing, ever.** Page OFF = Jawab24 invisible: no reply, no flag, no notification. Kills Smart Reply, Post Reply, away AND greeting. Messages are still stored; comments are NOT. |
| 2 | **Subscription gate** | `subscriptionsService.checkSubscriptionStatus` — **the one entitlement predicate**; never `subscriptions.status`. The 3-day grace applies only to **externally-billed** `past_due` (Stripe/Shopify card-retry) and runs off `current_period_end`, which means **paid through** — a failed Stripe renewal does NOT advance it (`config/stripeBilling.ts`, 2026-08-18: mirroring Stripe's advancing period granted a free month plus a fresh monthly quota); a trial-origin subscription (`payment_method IS NULL`) hard-stops at `trial_ends_at` — the lazy `trialing → past_due` flip no longer inherits the grace (2026-08-04: it used to hand every expiring trial ~4 free days; one merchant sent 760 replies through it). A **manual** (cash/transfer) plan holds `status = 'active'` forever and lapses at `resolveEntitlementEnd` = **UTC midnight of the period-end day** — up to ~24h before the raw `current_period_end`. | Nothing. Merchant gets a one-per-24h "replies frozen" notification, plus a pinned red dashboard banner carrying **what the block has cost** (`autoReply.unansweredSinceBlock` — DMs + FB comments + IG comments unanswered since the snapped entitlement end, counted only while the gate refuses) and a CTA that reads "renew" for a lapsed paid plan but "choose a plan" when `autoReply.cause = 'trial_expired'` — 19 of 20 `past_due` rows on prod are expired trials, and a trial has nothing to renew; an expiring trial additionally gets the one-time proactive `trial_ended` notice (in-app + email, daily cron). A **Stripe-billed** merchant additionally gets the dunning emails (services/dunningNotices.ts, once per failure episode, webhook + daily catch-up sweep): `payment_failed` on the declined renewal (hosted-invoice pay link), `service_suspended` when the grace expires or Stripe cancels involuntarily, `payment_recovered` when a payment closes an open episode — fired by `invoice.payment_succeeded`, and since 2026-08-19 also by the 15-min subscription reconciliation sweep when it heals a paid-through period that event never delivered (`healStripeSubscriptionPeriod`), because leaving the episode open would silence this merchant's every FUTURE notice (both dunning branches select on `… _notified_at IS NULL`). |
| 3 | **Handoff pause** | `handoffPauseDurationMinutes` | Nothing while a human is handling the thread; stale backlog is dropped on resume. Armed by any `outgoing` row with `reply_method='manual'` — an inbox reply, or a reply typed on the phone on a WhatsApp **Coexistence** number (Meta echoes it via `smb_message_echoes`). The WhatsApp Business **app's own** greeting/away message is echoed on the same field with no author flag; `whatsappEchoClassifier` stores it as `reply_method='app_auto'` (≤10 s after an inbound from a customer silent ≥14 d — WhatsApp's own greeting rule), which does NOT arm the pause and does not mark the customer's question answered (D-109). |
| 4 | **Rate limit** | per (page, sender) | Nothing beyond the limit. |
| 5 | **Channel enabled check** | `messagesAutoReply` / `commentsAutoReply` **folded with** `businessHoursOnly` + hours + `timezone` (`isAutoReplyEnabledFromSettings`) | See the away-message matrix below — this one branch serves two very different states. |
| 6 | **Low-confidence hold** | `holdLowConfidence` | Nothing (reply generated but parked for merchant review). ⚠️ Known defect: the hold early-returns before `maybeCaptureLead`, so held messages never produce a lead. |

**D-027:** Post Reply is exempt from the **workspace** `commentsAutoReply` toggle only —
the page master switch (gate 1) still kills it.

**Comments only — the content-free gate (D-111), between the Post Reply rule and the AI.**
A comment with no letter in any script («.», «....», «٠٠٠», «❤️», «😡») is answered with
details ONLY when the post's *text* explicitly invited that symbol. The invitation is
classified once per post (`services/contentCtaClassifier.ts`, pinned `gpt-4.1-mini`, lazily
on the first content-free comment no rule handled — concurrent first comments share one
call — persisted in `content_cta_classifications`, metered as `post_cta_classification`,
never against the reply quota) and matched locally per comment
(`services/reply/commentCta.ts`): `dot`/`digits` accept a dot or digit run, `heart` hearts
only, `any` any symbol, `word`/`none`/`uncertain` nothing (a dot on «اكتب تم» is skipped —
that merchant configures a Post Reply). Matched → the existing «أريد التفاصيل» rewrite and
a Smart Reply in the merchant's `commentReplyMode`, billed as before. Not matched → skipped
**before the AI-enabled / quota branches and any model call**: no reply in any mode, no
DM, no fallback template, no Needs-Attention row, no quota; resolved under
`uninvited_symbol` (`skipped_uninvited_symbol` + a per-post tally on the verdict row).
Reply mode never decides eligibility. No merchant setting reads into this gate; the env
switch `COMMENT_CTA_GATE_MODE` (`shadow` default = decide, count and log only; `enforce` =
skip) and `COMMENT_CTA_CONFIDENCE_THRESHOLD` (0.7, validated to [0,1]) are operator-side.
A comment carrying letters («تم», «السعر؟ ❤️») never enters this gate — no lookup, no
classification, the normal path.

### Gate 2 must be READ from the gate, never re-derived

Every surface that answers "is this account replying?" reads
`checkSubscriptionStatus` — the same call `enforceAutoReplyGate` blocks on:

| Surface | Field | Served by |
|---------|-------|-----------|
| Merchant dashboard banner | `usage.subscription.autoReply.allowed` | `getUsageSummary` → `GET /subscription/usage` |
| Merchant "covered until" copy | `usage.subscription.entitlementEndsAt` | same (snapped; **not** `renewsAt`) |
| Admin console status badge | `subscription.autoReply.allowed` | `getUserDetail` |
| Admin health flag `subscription_inactive` | `HealthInput.subscription.autoReplyAllowed` | `computeHealthFlags` |

History (2026-08-14, the owner's own account): all four surfaces derived their own
answer, and all four were wrong at once. A manual plan lapsed at 00:00 UTC; the usage
window closed at the same instant, so `getCurrentUsage` matched no row and `used` read
**0 of 4,500** — which the quota-only banner classified as healthy and therefore *hid
itself*. The admin console read `subscriptions.status`, still `'active'`, and showed
🟢 نشط beside «الرد التلقائي مفعل». The only surviving signal was one in-app bell row
(`auto_reply_paused_billing`) — there is **no email on this path**, and push requires a
registered FCM token. Net effect: replies frozen, every dashboard green.

Two rules follow, and both are load-bearing:

1. **A closed usage window reports `used = 0`.** That zero is an artifact, not a fresh
   allowance. Never infer health from a quota number without first asking the gate.
2. **`current_period_end` is not when coverage ends.** For a manual plan it is up to a
   full day late. Print `resolveEntitlementEnd`, and print it *with a time* — a bare
   date on a 00:00 boundary reads as the whole of that day.

A top-up does **not** lift this gate: `enforceAutoReplyGate` → `canAutoReply` consults
status only and never reaches the top-up fallback in `canUseAiReplies`. The paused
banner therefore suppresses its top-up CTA and offers renewal instead.

**These surfaces are rail-agnostic, and deliberately so.** The trigger is the gate
refusing, not `payment_method = 'manual'` — so a Stripe subscription that is `canceled`,
`paused`, or `past_due` beyond grace raises the same banner and the same red badge. That
is the point: the manual case is simply the one that had *no* signal at all, while the
auto-renew cases had a partial one. What each rail/state shows:

| Rail · state | Gate | Merchant banner | Console flag |
|---|---|---|---|
| any · active / in-window | allows | — | — |
| external · `active` but period passed | **allows** until the flip | — | — |
| stripe · `past_due` **in** 3-day grace | **allows** | — (replies flowing) | 🟡 `subscription_past_due_grace` (days left) |
| stripe · `past_due` beyond grace | refuses | 🔴 paused | 🔴 `subscription_inactive` |
| stripe · `canceled` / `paused` | refuses | 🔴 paused | 🔴 `subscription_inactive` |
| `payment_method = 'manual'` · past snapped end | refuses | 🔴 paused | 🔴 `subscription_inactive` |
| trial · expired | refuses | 🔴 paused | 🔴 `trial_expired` |

⚠️ **`checkSubscriptionStatus` has NO period check for the external rails.** An expired
Stripe/Shopify/Zid row still reads `status = 'active'` until `getUserSubscription` LAZILY
FLIPS it to `past_due` and persists that; only then does the grace arm apply. Anything
asking "is this account replying?" must therefore go through `getUserSubscription`, never
evaluate a row it selected itself — the support console did the latter and reported a
healthy account for a silently-suspended auto-renew merchant.

⛔ **`'manual'` is NOT every cash rail.** `manualUpgrade` also writes `'bank_transfer'`
and `'syrian_bank'` (see `backend/src/types/admin.ts`), and the snapped-expiry branch
matches `'manual'` only. Those two are still expired — by the lazy flip plus the 3-day
grace — so they do **not** run free forever, but they lose the midnight snap and so keep
the free-refill sliver it exists to close: the usage window shuts at snapped midnight
while entitlement runs to `currentPeriodEnd + 3d`, and `getCurrentUsage` reports `used =
0` for that gap. Pre-dates this work. Closing it changes WHO gets cut off on the Syrian
cash rail, so it is an owner decision, not a refactor.

⚠️ `subscription_past_due_grace` exists because moving this flag onto the gate would
otherwise have **deleted** a signal on the auto-renew path: the old rule flagged every
`past_due` red, including inside the grace where replies genuinely still send. Red there
was wrong, but silence was worse — that is the shape of the fleet-wide silent suspension
(2026-08-09). Yellow-with-a-deadline is the honest form. `PAST_DUE_GRACE_DAYS` lives in
`@jawab24/shared` so the console dates the same fuse the gate burns.

### Gate 5 is TWO states in one boolean — never conflate them

`isAutoReplyEnabledFromSettings(settings, 'messages')` returns false for **either**:

| State | Meaning | Duration | Away default allowed? |
|-------|---------|----------|----------------------|
| `messagesAutoReply = false` | Merchant switched DM auto-reply **off** | **Permanent** — there is no "later" | **No** — authored text only (`allowDefault: false`). Off means off; we never invent copy for a channel the merchant disabled. |
| `messagesAutoReply = true` + `businessHoursOnly = true` + outside hours | Temporarily closed | Until opening time | **Yes** — the shipped default («خارج أوقات العمل») is *true* here. |

History (2026-08-01): a pharmacy with DMs off, **no** business hours, and **no** authored
away message sent 37 customers our default «نحن حالياً خارج أوقات العمل» — at 09:05, in
copy the merchant never saw. The send site distinguishes the two states via `allowDefault`
since 2026-08-02.

## Auto-message matrix

| Message | Trigger | Text source (in order) | Throttle |
|---------|---------|------------------------|----------|
| **Greeting** | "Get Started" / «بدء الاستخدام» opener tap ONLY, `greetingMessageEnabled = true`. Typed messages never fire it — the first-message prepend was removed 2026-08-17 after ~30% of first contacts got a double welcome (the AI greets naturally on first contact) | `greetingMessageMulti` → shipped `defaultGreeting` when the merchant authored nothing (same strings the settings placeholder shows, so toggle-ON is never silent — added 2026-08-18; 56 of 83 workspaces carry an empty `{}` because `auth.createDefaultWorkspace` seeds no greeting) | Once per customer (no prior outgoing row — `hasOutgoingMessage`) |
| **Away** | Gate 5 blocks | `awayMessageMulti` → shipped `defaultAway` **only on the business-hours branch** | Once per (page, sender) per **24h** — Redis `SET NX EX`, key `away_msg:*`. **Fail-open**: Redis error ⇒ send (a duplicate beats silence). |
| **Quota fallback** | Monthly Smart Reply limit exhausted, `limitFallbackEnabled = true` | `limitFallbackMessageMulti` → i18n `messageFallback` / `commentFallback` | — |
| **Non-text nudge** | Media the CUSTOMER can act on: video / file / unknown type, an oversized or malformed image, failed transcription, or a standing limit (`env_disabled` / `no_subscription`). **Never sent when the failure is ours, nor when the merchant's subscription is inactive** — see below | i18n `nonTextNudge` | — |
| **Dual-reply nudge** | Public comment answered + DM sent (`commentReplyMode = 'dual'`) | `dualReplyNudgeVariations` / `dualReplyNudgeMulti` → i18n `dualNudgeDefault` | — |

### When an attachment produces NO message at all

Four cases send the customer nothing. This is deliberate, not a delivery bug — if
you are investigating "why did this customer get no reply to their photo?", start here.

| Case | Customer | Merchant |
|---|---|---|
| **Our failure** — vision/download deadline fired, network broke, dead CDN link, empty download, failed cap lookup, no API key | silence | photo lands in the inbox; SLA sweep flags it unanswered |
| **Daily image cap reached** | silence | `image_limit_reached` notification (deduped per UTC day) |
| **Subscription no longer entitles** — canceled / paused / past-due beyond grace / expired trial (`subscription_inactive`, added 2026-08-19) | silence | photo lands in the inbox; the standing `auto_reply_paused_billing` notice already covers the cause |
| **No-intent attachment** — sticker, Instagram story mention (`story_mention`) | silence | row stored and marked **resolved**, so it never reaches Needs Attention |

⚠️ `subscription_inactive` is silent for a reason that is NOT the usual "is the
capability available" line. `nonTextHandler` runs at INGESTION and consults no
subscription of its own — the entitlement gate is downstream in
`messageProcessor`. A nudge here would therefore be a NEW outbound message to the
customer of a merchant who is not paying, telling them to retype as text, after
which the reply gate blocks the answer and they hear nothing anyway. It is the
one denial where the nudge's own justification ("the fastest route to an answer")
is false.

Until 2026-08-19 this case did not exist: `checkImageUnderstandingGate` checked
only that a subscription ROW existed plus the daily cap, so a blocked merchant's
customers still had their photos read and billed to us — 288 of 1,527
`image_understanding` calls (19%, $0.32, 13 merchants) measured on that date. The
gate now shares `checkSubscriptionStatus` with `canAutoReply`, so it can never be
more permissive than the reply it feeds. Top-up does NOT lift it (it never lifts
`canAutoReply` either — #749); top-up still doubles the daily CAP.

The rule: the nudge says «حالياً نستطيع الرد على الرسائل النصية والصوتية», which is a
claim about our capability. Whenever the reason we failed is *ours*, that claim is
false — we read images for the same page every day — and it makes the merchant's
assistant announce a limitation to someone they are selling to. One merchant watched
it reach five of his customers and wrote «لما زبون يرسلك صورة لا ترد عليه» into his
Business Info to stop it. So: nudge only when the customer can act on it.

Both platforms follow the same policy; the decision lives in one place
(`actionForGateDenial` + `ImageFailureReason` in `nonTextHandler.ts` /
`imageUnderstanding.ts`) rather than per-channel.

"Get Started" / «بدء الاستخدام» openers are system phrases: they fire the greeting when
enabled and are silently suppressed otherwise — they never reach the AI.

## Order notifications to the CUSTOMER, over WhatsApp (per connected store, not per workspace)

Not a `UserSettings` field: six rows per store in `customer_notification_templates`
(`abandoned_cart`, `order_confirmed`, `order_shipped`, `order_delivered`, `review_request`,
`digital_delivery`), each with AR + EN text, a delay, and `is_enabled`. Written by
`PUT /notification-templates/:storeId/:type` (admin role + `requireOwnedStore`); read by
`customerNotificationService.schedule()` on every order webhook (Salla / Zid / Shopify).

> ⛔ **A seeded template is NOT a working notification — only three of the six fire
> everywhere.** All six get a row, an editable AR/EN body, an API whitelist entry and a
> merchant toggle in `/integrations`, which makes the UI read as six working features.
> The table below is what each one can actually do; verified by tracing every
> `OrderEvent` producer (`buildSallaOrderEvent` / `buildShopifyOrderEvent` /
> `buildZidOrderEvent`) into the single `schedule()` entry point, 2026-08-24.
>
> | Type | Salla | Zid | Shopify | Reality |
> |---|---|---|---|---|
> | `order_confirmed` | ✅ | ✅ | ✅ | fires on the create webhook |
> | `order_shipped` | ✅ | ✅ | ✅ | fires; Salla upgrades the row in place when tracking follows |
> | `order_delivered` | ✅ | ✅ | ✅ | fires on the delivered status/slug |
> | `review_request` | ⚠️ | ⚠️ | ⚠️ | fires, but **sends a dangling link**: `orderNotificationScheduler.ts` passes `review_url: ''` hardcoded while the default body ends in `⭐ {review_url}`, and no endpoint can set it (`controllers/customerNotifications.ts` accepts only isEnabled/messages/delay) |
> | `abandoned_cart` | ✅ | ✅ | ❌ | **Salla + Zid** — Salla fires from the `abandoned.cart` branch in `controllers/salla.ts`; Zid since #951 (2026-08-25): `abandoned_cart.created` schedules the recovery nudge and `abandoned_cart.completed` cancels it (`controllers/zid.ts`). Shopify never subscribes `checkouts/create`, so the analytics "revenue recovered" figure is structurally always 0 for Shopify stores |
> | `digital_delivery` | ❌ | ❌ | ❌ | **NOT IMPLEMENTED — declared, seeded, toggleable, never fired.** No `OrderEvent` builder emits it and nothing else calls `schedule()`, so the merchant can enable it and edit its copy and it will never send. Either wire it or remove the toggle |
>
> ⚠️ An earlier note here called the `channel` column **decorative**. That was true when
> written (2026-08-24) and stopped being true two days later: the WhatsApp rail shipped in
> #957 and reads it. Since D-123 (2026-09-03) `whatsapp` is the only value it accepts.
> Corrected rather than deleted, because the stale claim was quoted in two other docs.

| Fact | Value | Why it matters |
|------|-------|----------------|
| Seeded | by `createStore` for every platform and every reinstall, idempotent (#908, 2026-08-23). Before that only the Easy-Mode claim path seeded them, so an OAuth or embedded install had no rows at all | a store with no rows cannot send: `getTemplate()` → null → `schedule()` returns before writing anything |
| **Default `is_enabled`** | **`false` for all six** (`schema.ts` `customer_notification_templates.is_enabled`); `seedDefaults` never sets it | a freshly connected store sends NO order notification until the merchant switches each type on in `/integrations` → the store card → «إشعارات الطلبات». Measured 2026-08-23: the Salla demo store had every row OFF, so a rehearsal order would have produced zero log rows and read as a dedup pass — check this FIRST when "the order notification didn't fire" |
| Dedup | unique index `(store, type, platform_event_id)`; a duplicate delivery inserts nothing; `upgradePendingOnDuplicate` rewrites a still-`pending` row's text **and its `variables`** in place (Salla `order.shipment.created` upgrading the tracking-less `order.status.updated` row, held `SHIPPED_NO_TRACKING_GRACE_MS` = 5 min) | a second message for one event is a regression of this index, not of the template. ⛔ `message_sent` and `variables` are two renderings of the SAME values: `message_sent` is the human-readable copy kept on the log row (and the merchant-editable body), while the WhatsApp send rebuilds `{{1}},{{2}},…` from `variables`. Upgrading only the text made the WhatsApp send fill `{{3}}` from the stale variables, telling the customer «سيصلك من مندوب التوصيل» on the very event that carried the tracking number. Any future writer of one must write the other |
| Delivery | **WhatsApp only** (D-123, 2026-09-03). `customerNotificationService.send()` sends a **Meta-approved UTILITY template** from the merchant's own WABA, via the WhatsApp page LINKED to the store; the wamid lands in `provider_message_id`. The `channel` column survives (the analytics funnel groups by it, and it is the seat for a future rail) but accepts `whatsapp` alone — a row naming anything else fails with `channel_unsupported`. History: delivery ran over Vonage SMS until the unverified account rejected every send («Quota Exceeded», ticket #3002710); the owner dropped that path 2026-08-25, WhatsApp replaced it in #957, and the dead rail was removed 2026-09-03 — measured first: 12 template rows, all on SMS, all disabled, and an empty log, so it had never delivered anything | the log row is the evidence; its `status`/`error_message` separate "our code didn't fire" from "the provider refused". ⛔ There is **no cross-channel fallback** and now nothing to fall back to: a failure is reported to the merchant, never silently re-routed |
| WhatsApp channel — what it needs | (a) a page with WhatsApp credentials **linked to that store** (`pages.ecommerce_store_id`; a workspace-mate's number is deliberately NOT used — `resolveWhatsAppSender`); (b) an APPROVED canonical template for the type **in both `ar` and `en`** (language is picked per customer from the phone prefix). Types covered: `order_confirmed`, `order_shipped`, `order_delivered`, `abandoned_cart`. `review_request`/`digital_delivery` have no canonical template, and since WhatsApp is the ONLY rail (D-123) they have **no rail at all**, so the card DISABLES their enable toggle (`isDeliverable` in `OrderNotificationsCard.tsx`) with an on-row explanation, rather than letting a merchant switch on something that only ever writes `failed` rows. A type already enabled stays switchable OFF. That predicate is the single line to revisit when either type gains a template, or a second rail is ever added. Templates are Jawab24-canonical (`services/whatsappNotificationTemplates.ts`), auto-submitted to the merchant's WABA **at connect time** (`pagesService.kickOffNotificationTemplates`, fired by both connect writers — so Meta's minutes-to-hours review runs long before the merchant opens the notifications card) and tracked in `whatsapp_notification_templates`. ⛔ The card's status read (`GET .../whatsapp-status`) is the OTHER half and is load-bearing since D-123: it resolves through `resolveTemplateStatusesByType` (so opening the card re-polls Meta once our record is stale) and re-kicks provisioning for any type still `missing`. Before that it was a raw SELECT, and the only refreshers hung off a send — which cannot happen while a template is unapproved, so a store whose connect-time submission was lost sat at «waiting for approval» with no action available to anyone (8 production rows, untouched 2026-08-29 → 09-03). The channel-switch re-kick that used to cover this is no longer reachable from the dashboard: the picker is gone, so the card never sends `channel` | ⛔ the merchant's editable `messageAr/messageEn` governs NOTHING a customer receives — a WhatsApp body is frozen at Meta-approval time, so it cannot be a live per-merchant setting. Those fields are the human-readable rendering stored on the log row (`message_sent`) and the copy the card displays; the card says so explicitly (`whatsappTemplateNote`), because a merchant editing them and expecting the customer to see it is the obvious misreading. ⛔ Meta REJECTS an empty `{{n}}` parameter, hence the per-slot fallbacks (e.g. no tracking number → «سيصلك من مندوب التوصيل») |
| WhatsApp failure reasons | stable codes in `error_message`, not prose: `no_whatsapp_sender` (no linked WA page — the merchant sees a "connect WhatsApp" nudge), `whatsapp_template_pending` (Meta review — **retryable, deliberately NOT Sentry-reported**), `whatsapp_template_rejected`, `invalid_customer_phone`, `whatsapp_type_unsupported` | a `failed` row with one of these is the visible skip working as designed; the card explains it. `GET /notification-templates/:storeId/whatsapp-status` serves availability + per-type template status to that UI |
| Template provisioning states | `whatsapp_notification_templates.status` is `pending` \| `approved` \| `rejected` \| `unknown`. **`unknown` means the submission never reached Meta** (network, 429, 5xx, or a 4xx from a token since refreshed) — it is NOT a Meta status. Such a row is re-submitted after `UNKNOWN_RESUBMIT_BACKOFF_MS` (30 min); `pending`/`approved`/`rejected` rows are never re-submitted | ⛔ Before this backoff existed, ONE transient submission failure wedged the store's WhatsApp channel **permanently and silently**: the row existed so provisioning skipped it forever, Meta had no such template so the poll returned `unknown`, and every notification failed as `whatsapp_template_pending` — which is deliberately not Sentry-reported. Only a manual `DELETE` recovered. If a store's templates sit at `unknown` for over 30 min, provisioning is failing repeatedly — read `error_message` on that row |
| Template `error_message` | written when a SUBMISSION fails; cleared **only** when the template reaches `approved`. A status refresh that finds the template still pending/absent preserves it | it is the only readable account of why a template is stuck. Wiping it on every successful poll destroyed the evidence needed to diagnose the state being polled (Rule 10.11c) |
| Template status lookup | `GET /{waba-id}/message_templates` filtered with **`name_or_content`** (the documented filter — `name` is NOT one, and Graph silently ignores unknown params), paging via `paging.cursors.after` up to 5 pages, token in the Authorization header | with the wrong filter the call degraded to "first 50 templates on the WABA", so a merchant arriving with a populated WABA (agency, or migrating from another provider) read back `null` → `unknown` → permanent `whatsapp_template_pending`. `name_or_content` is a SEARCH, so the exact name+language match still happens client-side |
| Template variables | the renderer (`renderTemplate`) substitutes exactly: `{customer_name}`, `{order_number}`, `{tracking_number}`, `{cart_total}`, `{checkout_url}` (abandoned_cart's recovery link — Salla `data.checkout_url`, added 2026-08-25; empty on platforms without one), `{review_url}` (review_request — currently always empty, the known dangling-link gap). Unknown placeholders render as `''`. The `/integrations` card's hint chips MUST list these literal keys — before 2026-08-25 they advertised camelCase aliases (`{cartTotal}`…) the renderer never substituted | a merchant template showing blanks in the stored rendering usually means a placeholder the renderer doesn't know — check against this list first |
| Cancel on purchase | an `order_confirmed` event cancels any still-`pending` `abandoned_cart` row for the same store + customer phone (`scheduleOrderNotifications` → `customerNotificationService.cancel`, added 2026-08-25 — the method existed since the feature shipped but had no caller). Runs before the confirmation is scheduled and even when the `order_confirmed` template is disabled; best-effort (a cancel failure is Sentry-captured and never blocks the confirmation notification). On Zid, `abandoned_cart.completed` additionally cancels directly | without it, a customer who completed their purchase still got the "you left items in your cart" nudge up to an hour later; a `cancelled` row in the log is this path working, not a defect |
| `abandoned_cart` platform coverage | fires on **Salla** (`abandoned.cart`) and **Zid** (`abandoned_cart.created` schedules, `abandoned_cart.completed` cancels — both added 2026-08-25, parser [provisional] until a live capture). **Shopify is NOT wired** — no `checkouts/*` subscription exists. Cancelled rows are excluded from the analytics "revenue recovered" attribution | a Shopify merchant's abandoned-cart toggle does nothing today; Zid stores connected before 2026-08-25 need a webhook re-registration to receive cart events |

The merchant-facing toggles are the whole on-switch — there is no workspace-level master
toggle and no per-page override. Whether to seed `order_confirmed` / `order_shipped` ON for
new stores is an open product decision, parked until WhatsApp delivery has been exercised by
real merchants (as of 2026-09-03 one page is connected and its 8 templates are still pending
Meta review, so the rail is proven in code and not yet in the field).

**Zid stores: WhatsApp is switched off entirely (D-117, TEMPORARY).** For a workspace whose owner
has an active Zid store, WhatsApp connect is refused server-side (Zid paused WhatsApp-integrated
apps; app 7367 ships for Facebook + Instagram only until the category reopens). Effects on this
surface: `GET /notification-templates/:storeId/whatsapp-status` returns
`{ available: false, unavailableReason: 'zid_marketplace' }` for such a store, so the
`OrderNotificationsCard` **hides the WhatsApp channel option and the "connect WhatsApp" nudge**
rather than offering a channel the connect API will 403. The one predicate,
`getWhatsAppUnavailableReason(ownerId)` (`services/whatsappAvailability.ts`, keyed on
`hasActiveStoreForBillingSubject('zid', …)`), also gates the connect endpoints in
`controllers/whatsapp.ts` and `controllers/whatsappRedirect.ts`. Reversible with
`WHATSAPP_ZID_BLOCK=false` (default ON) — no code change to re-enable when Zid reopens the category.

## Test reply («اختبار الرد الذكي») — settings it applies

`POST /pages/:id/test-reply` (`controllers/pages.ts` → `buildPlaygroundContext` →
`replyGenerator.generateForPlayground`) exists to show the merchant the reply their
customers would get. Anything the production pipeline applies that it omits is a lie to
the merchant, so the settings below resolve from the **page's own workspace** — the same
`workspaceSettingsService.getSettings(page.workspaceId)` object `messageProcessor` and
`commentProcessor` read:

| Setting | How the test reply resolves it |
|---------|-------------------------------|
| `brandVoiceNotes` / `brandVoiceNotesMulti` | `resolveBrandVoiceNotes(wsSettings, question, page.brandVoiceNotesMulti)` — the same choke point `enrichPageContext` uses for production replies, including the per-page override (D-084) |
| `replyStyle` | `wsSettings.replyStyle` (the ai-worker defaults to `professional` when absent) |
| `replyMode` | `resolveEffectiveReplyMode(page.replyMode, wsSettings.replyMode)` — the same shared resolver both processors use (D-085). An eval case may force an arm via `TestCase.replyMode` → the playground body (case 779 is the witness); the override is narrowed to the enum and honored ONLY for `source==='eval'`, so the merchant-facing test reply and the admin playground always resolve from the page/workspace |
| `defaultReplyLanguage`, `timezone` | `wsSettings` |
| `commentReplyMode` + `dualReplyNudgeVariations` | the owner row, `settingsService.getSettings(page.userId)`. ⚠️ **Known drift** — see below |

**Never resolve a pipeline field here from the owner row.** The full map of which surface
reads which store, and the defects that come from getting it wrong, is
[`SETTINGS_RESOLUTION.md`](./SETTINGS_RESOLUTION.md). In short: `settingsService.getSettings`
overlays the pipeline fields (`services/pipelineFields.ts`) from
`resolveWorkspaceId(userId)`, an **unordered `limit(1)`** over the user's workspace
memberships. For a merchant who holds more than one workspace — a personal one beside a
store one, which D-066 Zid installs auto-provision — that resolves an arbitrary workspace,
so the merchant can be shown another workspace's persona, tone, or comment mode.
`commentReplyMode` / `dualReplyNudgeVariations` still read it and carry that risk; they
are left as tracked drift rather than folded in, because changing which comment mode the
test reply previews moves eval baselines.

**Admin overrides still win.** The admin playground (`services/admin/kb.ts`) and the eval
harness may pass an explicit `brandVoiceNotes` / `replyStyle`; a supplied value is used
verbatim and only an *absent* one falls back to the stored setting. A settings read that
fails degrades to no persona — it never fails the test reply.

> **Why this is called out:** until 2026-08-11 those two options were labelled "admin-only
> overrides" and had no fallback, so the merchant test answered «تمام يهمني، نبي نجرب»
> with a self-serve link while production — carrying the stored persona's "ask for the
> customer's name and WhatsApp number" instruction — answered «تمام، ابعث لي اسمك ورقم
> واتساب…». Pinned by `backend/test/services/reply/playgroundPersona.test.ts`.

**Other known drift** (production applies, the test reply does not): the narrative
`--- Business Info ---` block that `enrichPageContext` appends to the KB from
`formatBusinessProfile(page.businessProfile)` (business type / about / website). Fixing it
moves every eval baseline, so it is tracked separately rather than folded in here.

## Field reference (`UserSettings`, `backend/src/types/settings.ts`)

| Field | Used by | Semantics |
|-------|---------|-----------|
| `aiEnabled` | reply pipeline | Master AI toggle. |
| `aiModel` | ai-worker | Per-merchant model override (default set in admin settings table). |
| `messagesAutoReply` / `commentsAutoReply` | gate 5 | Per-channel workspace toggles. See the two-states table above. |
| `commentReplyMode` | commentProcessor | `public` / `private` (DM) / `dual` (both + nudge). |
| `likeComments` | commentProcessor (smart path only) | Page likes the customer's comment after a successful smart reply. Default off. Facebook only (IG Graph has no like endpoint — the IG adapter simply lacks `likeComment`). **AI replies only** (`replyMethod === 'ai'`): template/fallback replies (quota-exhausted `limitFallback`, aiEnabled off) classify no intent, so the complaint suppression couldn't apply — they never like. On AI replies, suppressed when flagged (`needsAttention` — the primary defense; `computeNeedsAttention` forces it for `COMPLAINT`/`OFFENSIVE`) with `NO_AUTO_LIKE_INTENTS` (`COMPLAINT` / `OFFENSIVE` / `SPAM_OR_IRRELEVANT`) as backstop. Post Reply is NOT governed by this — it has the per-post `posts.like_comment` toggle. |
| `businessHoursOnly` + `businessHoursStart`/`End` + `timezone` | gate 5 | Schedule gate. ⚠️ Default `timezone` is `Asia/Riyadh` — wrong-country merchants run hours offset. |
| `awayMessage` / `awayMessageMulti` | away branch | Merchant-authored away text. ⚠️ UI gap: the edit field (`BusinessHoursCard`) is disabled unless `businessHoursOnly` is on, yet the message can also fire on the toggle-off branch. |
| `greetingMessage` / `greetingMessageMulti` + `greetingMessageEnabled` | greeting | First-contact welcome. Toggle read-back once regressed to always-off — keep it in the settings GET. |
| `limitFallbackEnabled` + `limitFallbackMessageMulti` | quota exhaustion | Master switch + custom text; when off, silence at the limit. |
| `dualReplyNudge` / `dualReplyNudgeMulti` / `dualReplyNudgeVariations` | dual mode | The "check your DMs" comment; variations rotate. |
| `replyDelay` | both processors | 0–300s humanized delay (`computeHumanDelayMs`). Also disables the debounce fast-path when > 0. Default **2s** (was 3s until 2026-08-24 — the latency study measured delay=3 merchants at p50 6.67s vs 2.72s for delay=0; existing rows kept their stored value, the UI "Natural" preset moved to 2s with it). |
| `commentEscalationMinutes` / `messageEscalationMinutes` | `escalation.ts` cron | Unanswered-thread thresholds (defaults 60 / 30) before Needs Attention escalation. |
| `handoffPauseDurationMinutes` | gate 3 | How long a manual reply pauses the AI on that thread. One value for every channel, including a reply typed on the phone on a Coexistence WhatsApp number; the app's own automations (`app_auto`) never start it. |
| `holdLowConfidence` | gate 6 | Park low-confidence replies for review. See lead-capture defect above. |
| `brandVoiceNotes` / `brandVoiceNotesMulti` | prompt builder | The persona — injected verbatim into the system prompt. Ships as a `[...]` placeholder template; unedited = generic replies. Always resolved through `resolveBrandVoiceNotes(settings, message, pageOverride?)` (`services/reply/contextEnricher.ts`) — it is also a reply-cache key segment (`bv:`), so a second copy of the language-pick rule strands warmed entries. **Per-page override (D-084):** `pages.brand_voice_notes_multi` — NULL/`{}`/all-cleared = inherit the workspace persona; a record with language content is a PIN (no workspace and no legacy fallback). Written via `PATCH /pages/:id/brand-voice` (admin+, `null` reverts, auto-translated with the same `smartTranslateMultiLang` helper as the workspace save). No cache bump on change — the persona text itself scopes both cache layers (`bv:` exact segment + semantic `brandVoiceHash`). Resolution chain: page → workspace → legacy column. Greeting/away are planned for the same chain — ❌ NOT IMPLEMENTED for them today. |
| `replyStyle` | prompt builder + `ai.ts` context + reply-cache key | `professional` / `casual` / `enthusiastic`. Selects the tone directive in the ai-worker's `styleMap` (`promptBuilder.ts:379`) and is part of the semantic cache key. (The `[future]` markers next to it in `services/pages.ts:537` are about wiring its *writer* into prompt-cache invalidation, NOT about whether the prompt reads it — it does, today.) **Workspace-level ONLY — ❌ no per-page override** (D-084 deliberately scoped just the persona text). ⚠️ Known UI wrinkle (owner, 2026-08-17): the settings card shows this selector under the page-scope persona editor too, where it can read as per-page — it is not; flipping it changes every page. **Disclosed since 2026-08-17**: inside a page scope the card now prints `replyStyle.tonePageNote` («الأسلوب يسري على كل صفحاتك») directly under the selector, and the selector itself carries a `replyStyle.<style>Desc` line naming what the chosen tone does. The underlying scope is unchanged — this is disclosure, not a per-page tone. A page that needs its own tone still states it in its page persona text (which the model follows). Revisit after the InMedia pilot; if built, it rides the same page → workspace chain AND must join the reply-cache key per page. |
| `replyMode` | prompt builder (INFO-DESK block) + `ai.ts` exact-cache key (`rm:` segment) + semantic-cache metadata scope + `leadExtractor` (`suppressPush`) | `'sales'` (default) / `'info'` (D-085). Workspace default in `settings.reply_mode`; **per-page pin** in `pages.reply_mode` (NULL = inherit, an explicit `'sales'` survives a workspace flip) — resolved everywhere through `resolveEffectiveReplyMode` (shared). **Generally available since D-087 (2026-08-20)** — the `REPLY_MODE_WORKSPACE_IDS` allowlist is deleted from both backend and frontend; every workspace sees the control, and every existing row still reads `'sales'`, so GA turned the mode on for nobody. ⚠️ **Web-only until the next app release:** production mobile builds serve a BAKED static export (`capacitor.config.ts` `webDir: 'out'`, no `server.url`), so the deleted client gate is compiled into every installed build and keeps hiding the control on phones. The backend accepts the write from any workspace regardless, so nothing is inconsistent — the control is just absent there until a new build ships. **Three write paths, and they are not interchangeable:** `PUT /settings` writes the per-user `settings` row and syncs the pipeline fields to the workspace; `PUT /workspaces/current/settings` writes the `workspaces.settings` JSONB **that the reply pipeline actually reads** (`workspaceSettingsService.getSettings`, called by messageProcessor and commentProcessor); `PATCH /pages/:id/reply-mode` writes the per-page pin. All three validate the enum — the workspace route only since D-087, before which its key-name allowlist let an arbitrary string reach the pipeline's own store, where `resolveEffectiveReplyMode` silently degraded it to `'sales'`. The surviving guard on `PUT /settings` refuses when the settings write-target workspace differs from the request's (multi-membership), and since D-087 it covers BOTH modes, not just `'info'` — turning info off on the wrong workspace is the same defect as turning it on. The reply pipeline itself reads whatever is stored. Info pages: lead capture stays (row/bell/SSE), only the push alert is muted. Page changes write a `page.reply_mode_changed` audit row. **The persona card's copy follows the effective mode (2026-08-17):** the INFO-DESK block is injected *after* the brand-voice notes and says, verbatim, that it overrides "any instruction in your persona notes to collect customer details" — so a persona line asking for name+phone is reversed in `'info'` and inert in `'sales'` (asking is demonstrated by `STATIC_SYSTEM_PREFIX`, not by the persona). The placeholder therefore no longer teaches it: `replyStyle.brandVoicePlaceholder` / `…PlaceholderInfo` are picked by the effective mode (workspace scope follows the DRAFT so the guidance flips on click; a page scope follows what that page runs), and `replyStyle.infoModeNote` renders in `'info'` only. ⛔ Do not reintroduce a collect-instruction into the persona copy. **⚠️ Deploy order:** backend + ai-worker + frontend ship TOGETHER (inert while no row carries the mode), and any live `'info'` page must be flipped only AFTER both backend and ai-worker run the new code — otherwise the `rm:i` exact-cache segment poisons entries for up to 30 days (rollback recipe in D-085/المرحلة ٦). **Leads-tab hiding: ❌ NOT IMPLEMENTED** (deliberately out of V1; revisit after the InMedia pilot). **⚠️ The dead-end case (D-087):** INFO-DESK ends «If no channel is on file, be honest you don't have one and stop», so on a page whose BUSINESS_INFO publishes neither a phone nor a WhatsApp, `'info'` neither asks for the customer's details nor routes them anywhere. Measured on prod 2026-08-20: **7 of 36 live pages** pass `hasRoutableContactChannel` (shared, same `isFieldAuthoritative` gate the block applies) — 10 of the 17 that store phones fail it because the number came from `fb_sync` and was never confirmed. The settings card warns about this (server-computed `hasContactChannel` on the pages LIST payload) but does NOT block the choice: a merchant may publish a number in their KB text, which the predicate cannot see. |
| `dashboardLanguage` | frontend | UI locale — never reply language. Also the ONLY language signal a server-side push notification has (`getUserLanguage` in `services/notifications.ts`); the WebView's Zustand store is invisible to it, so every authenticated language switch mirrors itself here via `lib/dashboardLanguage.ts`. That mirroring only started on 2026-08-19 (#831) and its PUT is fire-and-forget, so the column can lag the UI on any older install or failed write — `useDashboardLanguageSync` (mounted in `DashboardLayout`) heals the lag on the next dashboard load, taking the language the merchant is READING as the truth. The Settings toggle shows that same live locale, never this column. |
| `defaultReplyLanguage` + `supportedLanguages` + `autoDetectLanguage` | language resolution | Template/reply language pick (`resolveLanguage`). **`defaultReplyLanguage` also decides the synthetic content-free-CTA question since 2026-08-28 (D-107)** — the sentence `rewriteContentFreeCta` substitutes for a bare emoji/dot on a CTA post is resolved by `resolveAuthoredCtaLanguage` (`utils/replyLanguage.ts`), which reads this field FIRST and falls back to the post→KB ladder only when it is unset. It used to be `detectLanguageCode(postMessage)`, which sent an English brochure to every emoji comment on a page with styled-Latin captions: 238 of Shahin Resort's 240 content-free AI comment replies in 30 days, plus 11 on مزة جبل 86 and 2 on BAMBO LIBYA. ⚠️ `autoDetectLanguage` does **not** override this — auto-detect acts on the CUSTOMER's language, and a content-free comment has none, which is exactly when a default applies. ⛔ The synthetic sentence is an i18n key (`contentFreeCtaQuestion`), NOT a hardcoded ar/en pair, because the sentence's own language becomes the reply's language (it is fed back as the explicit hint) — so a locale with no `i18n/<locale>.json` degrades to English. Widening to a third language is **not** a drop-in JSON file: registering one produces ~8 further `tsc` errors where `'ar' \| 'en'` is hardcoded (`paymentWebhookHandlers.ts`, `dunningNotices.ts`). ⚠️ **This field is NOT narrowed at the write boundary.** `UpdateSettingsSchema` types it `z.string().min(2).max(10)`, so `'fr'`, `'ar-SY'` and `'AR'` are all writable, and each one reaches `resolveAuthoredCtaLanguage`, comes back unrecognised from `t()`, and produces the English sentence — the exact D-107 symptom on a page configured for something else, with no log line. It is left unguarded because the accepted set would be a second copy of the locale list `utils/i18n.ts` already owns (`packages/shared` cannot import it), and prod holds no such value: **97/97 `settings` rows and 96/97 workspace JSONB values are exactly `'ar'`** (measured 2026-08-28). Treat the schema as one more site on the locale-registration list above, and re-check that count before assuming it still holds. |
| `notificationsEnabled` / `newLeadAlertsEnabled` | push/email | Notification toggles. |
| `onboardingCompletedAt` | frontend | Onboarding flow marker. |

## Traps (each cost a real investigation)

1. **One boolean, two off-states** — always check `messagesAutoReply` separately before
   reasoning about "why did/didn't the away message send" (gate 5 table).
2. **`sourceLang` is not a language entry** — go through `pickMultilingualText`.
3. **The away field's UI gating ≠ its firing conditions** — a merchant can be sending an
   away message they cannot see or edit (field gated behind Business Hours).
4. **Page-off comments are not stored** — absence of rows IS the evidence, not a gap.
5. **Settings are per-user** — for multi-page merchants resolve settings once, then reason
   per page (only `pages.auto_reply_enabled` varies per page).
6. **`timezone` default is `Asia/Riyadh`** — a Libyan/Egyptian merchant who never touched
   it runs business hours 1–2h off.
