# E-Commerce Power Features for Jawab24

> **Created:** 2026-04-04
> **Last reviewed:** 2026-06-13 — re-prioritized. See the ⛔ Meta-policy blocker on Phase 1d/1e/2 below; the next workstream is now **Inbound Order Auto-Resolve**.
> **Status:** Phase 1 foundation + the order-status tool stack are shipped — but with **~0 production adoption** (2/82 pages have a store; 0 tool invocations as of 2026-06-13), so tool *enhancements* are parked and the real focus is store-connection adoption. DM abandoned-cart recovery (1d/1e/2) is **BLOCKED** on Meta policy.
> **Companion plan:** `ECOMMERCE_NOTIFICATIONS_PLAN.md` — covers SMS delivery (broad reach for all customers).
> This plan covers Facebook/Instagram DM delivery (rich experience for mapped customers).
> **Delivery priority (revised 2026-06-13):** Inside the 24h window → DM. Outside it, DM is **not** available for promotional/recovery content (Meta policy — see blocker) → SMS fallback (if phone available) → skip. Compliant proactive DM requires Meta's opt-in *Marketing Messages on Messenger* API.

## Implementation Status (2026-06-13)

| Phase | Status | Notes |
|---|---|---|
| **Order-status tools** (lookup/track/inventory + 2-phase verify) | ✅ **Shipped & live** | 5 tools registered in `ecommerceToolHandler.ts:54-160`; all 3 platforms; order-read scopes already granted. NOT in the original phase list — the doc treated it as pre-existing |
| **Inbound Order Auto-Resolve** (by phone/email) | ⏸️ **PARKED** (spec ready) | Cheap, customer-initiated, zero policy risk — but **0 tool usage & only 2/82 pages have a store** (prod check 2026-06-13). Build when adoption rises. See section below |
| 1a — Messaging Type Support | ✅ **Shipped** (`ae2d9c5a`) | `sendPrivateMessage()` + `sendDirectMessage()` accept `opts.messagingType`, defaults to `RESPONSE` |
| 1b — Rich Product Cards (Generic Template) | ✅ **Shipped** (`ae2d9c5a`) | `metaMessaging.ts` + `productCardBuilder.ts`; sends after text reply when `check_inventory` returns a synced product image |
| 1c — Postback Webhook Handler | ⏸️ **Deferred** | Not needed for v1 — using `web_url` buttons only. Add when an action button is designed |
| 1d — Customer Identity Mapping | ⛔ **BLOCKED** | Only useful for *outbound* proactive DMs, which Meta policy now blocks (see callout). Foundation for future Marketing-Messages path |
| 1e — Proactive Message Sender | ⛔ **BLOCKED** | Depends on 1d **and** a compliant proactive channel (Meta Marketing Messages, opt-in). Not buildable as specced |
| 1f — Tool Loop Return Type | ✅ **Shipped** (`ae2d9c5a`) | `AiGenerateResponse.productCards?` + `GenerateReplyResult.productCards?` threaded through pipeline |
| 2 — Abandoned Cart Recovery (DM) | ⛔ **BLOCKED** | DM recovery outside 24h needs Meta Marketing Messages (opt-in, ~19 countries). **SMS version is already live** and covers broad reach — so DM recovery is now low-reach + high-effort |
| 3 — Order Notifications (DM) | ⚠️ **Conditional** | Transactional, so likely viable via Meta **Utility Templates** (the deprecated tags' migration path). Re-scope against Utility Templates before building. SMS version already live |
| 4a — Product Recommendations Carousel | ⏸️ **Deferred** | Defer until usage data shows demand |
| 4b — Stock / Price Alerts | ⏸️ **Deferred** | Same |
| 5 — Analytics Dashboard (lite) | ✅ **Shipped** (Step 2) | Page at `/ecommerce-analytics`, summary widget in `ConnectedStoreCard`, channel-keyed funnel ready for WhatsApp/DM |
| 6 — URL Wrapping + Click Tracking | 📋 **Planned** (lands with Step 3) | Closes the LetsBot attribution gap — turns approximate phone-window matching into real click → conversion telemetry |
| 7 — A/B Template Testing + Per-Template Conversion | 📋 **Planned** (after Step 3) | Depends on Phase 6 click data. Lets merchants split-test message copy and surfaces which template recovers more carts |
| WhatsApp parity (cross-ref) | 🔗 See `WHATSAPP_PLAN.md` | **Channel SHIPPED 2026-07-04 (#392, founder canary)** — connect UI, multi-number, voice/media, read receipts + typing (#423). Phase 4 (template messages) is the LetsBot-killer for proactive sends — **Meta App Review submitted 2026-07-08, in review**; inbound status-callback consumption still open |

## Context

Jawab24 already has solid e-commerce integrations (Shopify, Salla, Zid) with product sync, AI-powered order lookup, shipment tracking, and inventory checks. But competitors like **LetsBot** (49-119 SAR/mo, 40 reviews at 5★), **Javna** (95-895 SAR/mo, 1,300+ brands), and **AI WhatsApp Bot** (40-120 SAR/mo) all offer features Jawab24 lacks: **abandoned cart recovery**, **proactive order notifications**, **product recommendations with rich cards**, and **e-commerce analytics**.

These competitors are WhatsApp-focused. Jawab24's unique angle: deliver these features through **Facebook/Instagram DMs** — a channel none of them cover.

## Codebase Validation Summary

After deep review of the actual code, confirmed:
- `sendPrivateMessage()` in `facebook.ts:196` is a thin `axios.post` to `/me/messages` — easy to extend with `messaging_type` and template payloads
- Same in `instagram.ts:231` — identical API shape
- Pipeline is **reply-driven only** (`messageProcessor.ts`) — no proactive messaging exists, but `facebookService` can be called directly
- Page access tokens stored encrypted per page in `pages.accessToken`, available via `pagesService.getPageById()`
- Tool loop in `ecommerceToolLoop.ts`: max 2 rounds, 3 calls/round, 30s timeout — returns `AiGenerateResponse` (text only, NOT tool results)
- `ecommerceProducts` table already has `imageUrl`, `handle`, `priceRange`, `variantSummary` — all data needed for rich cards
- Webhook handlers in controllers use simple `if/else` dispatch on `event` string — easy to extend
- BullMQ pattern well-established: queue in `lib/`, worker in `workers/`, started via integration `onStartup()`
- `VALID_TOOL_NAMES` whitelist in `packages/shared/src/ecommerce-tools.ts` — must add new tool names there
- **No rate limiting** on message sends — must add for proactive messaging
- **No postback handling** — Facebook `messaging_postback` events not processed today
- **No `messaging_type`** set on any sends — Facebook defaults to `RESPONSE` (fine for replies, blocks proactive)

---

## Phase 1: Foundation — Customer Mapping + Rich Messaging Infrastructure (Week 1)

### 1a. Meta Messaging Type Support

**Problem**: Can't send proactive DMs — no `messaging_type` support, no message tags.

**Files to modify**:
- `backend/src/services/facebook.ts:196` — Add optional `messaging_type` and `tag` to `sendPrivateMessage()`:
  ```typescript
  async sendPrivateMessage(
    pageAccessToken: string, recipientId: string, text: string,
    opts?: { messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG'; tag?: string }
  ): Promise<void>
  ```
  In the axios payload, add: `messaging_type: opts?.messagingType || 'RESPONSE'` and conditionally `tag: opts?.tag`
- `backend/src/services/instagram.ts:231` — Same change to `sendDirectMessage()`
- All existing callers pass no opts → defaults to `RESPONSE` → zero breaking changes

### 1b. Rich Product Cards (Generic Template API)

**Problem**: Only plain text DMs today. No way to share products with images, prices, and action buttons.

Both Facebook Messenger and Instagram DM support the **Generic Template** — structured cards with image, title, subtitle, and buttons. Up to 10 cards per carousel.

**New methods** (in both `facebook.ts` and `instagram.ts`):
```typescript
async sendProductCards(
  pageAccessToken: string, recipientId: string, 
  products: ProductCard[],
  opts?: { messagingType?: string; tag?: string }
): Promise<void>
```

Sends a `template_type: "generic"` attachment with `elements[]` — each element has `title` (80 char max), `subtitle` (80 char max), `image_url`, `default_action` (web_url to product page), and up to 3 `buttons`.

**New shared type** in `packages/shared/src/index.ts`:
```typescript
interface ProductCard {
  title: string;
  subtitle: string;
  imageUrl: string;
  productUrl: string;
  buttons?: Array<{ type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }>;
}
```

### 1c. Postback Webhook Handler

**Problem**: When customer taps a button on a product card (e.g., "Tell me more"), Facebook sends a `messaging_postback` event. Jawab24 doesn't handle this.

**Files to modify**:
- Facebook webhook entry point — add `messaging_postbacks` to the webhook subscription fields
- Message processor or new handler — parse `postback.payload` (e.g., `PRODUCT_INFO_<productId>`), fetch product details from `ecommerceProducts`, and trigger AI reply with product context injected

**Implementation**: Treat postback as a synthetic incoming message with the product context pre-loaded. Feed into existing `messageProcessor.processMessage()` with the postback payload as the "message text" + product context in metadata.

> ## ⛔ BLOCKER (added 2026-06-13): proactive DM cart recovery is not shippable as specced
>
> Phases 1d → 1e → 2 exist to send **proactive DMs outside the 24h messaging window**. That mechanism is now closed:
>
> - **The message tags this plan relies on are deprecated.** `POST_PURCHASE_UPDATE`, `CONFIRMED_EVENT_UPDATE`, and `ACCOUNT_UPDATE` were reportedly deprecated **effective 2026-04-27** and now return **error 100**. Phase 1e's line "if consent → use `MESSAGE_TAG` + `CONFIRMED_EVENT_UPDATE`" (below) is **invalid**.
> - **The surviving `HUMAN_AGENT` tag does not apply.** It is support-only (7-day window, response to a user-initiated issue) and **explicitly bans promotional content**. Abandoned-cart recovery is promotional re-engagement → not permitted.
> - **Blast radius is app-wide.** Misusing tags risks messaging-permission revocation / app-review failure for **every merchant on the Jawab24 Meta app** — an outage-class risk, not a feature risk.
> - **Compliant paths (per Meta's deprecation notice):** promotional re-engagement (cart recovery) → opt-in **Marketing Messages on Messenger** API (explicit per-user opt-in; ~19 countries as of 2025); transactional updates (order/shipment notifications) → **Utility Templates**. Both are separate builds from what 1d/1e/2 specced. *(Confirmed against the live changelog 2026-06-13 — see Open Questions.)*
> - **SMS cart recovery is already live** (`customerNotifications.ts`) and covers broad reach. So DM recovery is now *low-reach + high-effort + policy-gated*.
>
> **Decision:** deprioritize DM cart recovery. Do **not** build 1d/1e/2 as written. If revisited, scope it on Marketing Messages (opt-in) and re-confirm the policy against live `developers.facebook.com` docs first (see *Open questions* near the end). The next workstream is **Inbound Order Auto-Resolve** (customer-initiated, zero policy exposure) — see its section below.
>
> The 1d/1e/2 specs are retained below for reference / future Marketing-Messages reuse.

### 1d. Customer Identity Mapping

**Problem**: Salla `abandoned.cart` webhook has customer email/phone, but we need their Facebook/Instagram `senderId` to DM them.

**New table** `ecommerceCustomerMap` in `backend/src/db/schema.ts`:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ecommerceStoreId | uuid FK → ecommerceStores | CASCADE delete |
| platformCustomerId | varchar | Salla/Shopify/Zid customer ID |
| customerEmail | varchar (encrypted) | AES-256-GCM via existing `ecommerceCrypto.ts` |
| customerPhone | varchar (encrypted) | Same encryption |
| customerName | varchar | |
| socialSenderId | varchar | Facebook/Instagram user ID (from `messages.senderId`) |
| socialPlatform | varchar | 'facebook' \| 'instagram' |
| pageId | uuid FK → pages | Which page the customer interacts with |
| consentForNotifications | boolean default false | Meta policy compliance |
| lastInteractionAt | timestamp | Track 24h messaging window |
| createdAt, updatedAt | timestamps | |

**Indexes**: `(ecommerceStoreId, socialSenderId, socialPlatform)` UNIQUE, `(customerEmail)`, `(customerPhone)`

**Population** — modify `ecommerceActions.ts` `handleVerification()` (~line 168):
After successful `verify_and_get_order` / `verify_and_get_shipment`, upsert into `ecommerceCustomerMap`.

**New file**: `backend/src/services/customerMapping.ts`

### 1e. Proactive Message Sender

**New file**: `backend/src/services/proactiveMessaging.ts`

Shared utility for all proactive features:
1. Accept: `storeId`, customer identifier (email or phone), message content, optional product cards
2. Look up `ecommerceCustomerMap` by email/phone → get `socialSenderId` + `pageId`
3. Load page → get `accessToken` via `pagesService.getPageById(pageId)`
4. Check messaging window: if `lastInteractionAt` < 24h ago → use `RESPONSE`; if consent → use `MESSAGE_TAG` + `CONFIRMED_EVENT_UPDATE`; else → skip
5. Send text + optional product cards
6. Rate limit: max 50 proactive DMs/hour per page (Redis counter)

### 1f. Extend Tool Loop Return Type

**Problem**: `ecommerceToolLoop.ts` `generateReplyWithTools()` returns `AiGenerateResponse` (text only). Product card data from `recommend_products` never reaches message processor.

**Fix**: Extend `AiGenerateResponse` in `packages/shared/src/index.ts` to include optional `productCards?: ProductCard[]`. Extract product data in tool loop, attach to response. Message processor sends cards after text reply.

---

## Phase 1.5: Inbound Order Auto-Resolve (by phone/email) — NEXT, highest risk-adjusted value

> **Added 2026-06-13.** The order-status tool stack is shipped, but today the customer must type an **order number** before `lookup_order` works. The single biggest friction (esp. guest checkouts) is "I don't have my order number." This workstream lets the customer resolve "وين طلبي؟" by giving their **phone or email** instead.
>
> **Why this *would* be the best next bet:** it improves a *live* feature, it is **customer-initiated** (always inside the 24h window → **zero Meta-policy exposure**, unlike Phase 2), and on Shopify it needs **no new OAuth scope / re-consent**.
>
> ### ⏸️ PARKED pending adoption — production check 2026-06-13
>
> Before committing dev-days, we pulled live usage. The signal kills the case for building *now*:
> - **Only 2 of 82 pages** have a store connected (active stores: 1 Shopify, 1 Salla).
> - The order-status tools have **0 invocations all-time** (`ai_usage_log`, pipeline `ecommerce_tools`) — never used in production.
>
> So there is **no demand to optimize and nothing to verify the flow against.** Building inbound auto-resolve now would be optimizing a feature with zero traffic — premature. **The real bottleneck is adoption: getting merchants to connect a store** (onboarding / activation), not more tool features. This spec is retained, complete and ready — pick it up when store-connection adoption is materially higher and order-lookup traffic actually exists.

### New tool: `find_orders_by_contact`

A Phase-1 tool taking `{ phone }` or `{ email }`, returning the matching order(s). The contact match **is** the identity check, so it slots into the existing two-phase model: return PII-gated summaries, then confirm details via the existing `verify_and_get_*` path (or treat a phone match as the verification). 

- Register in `VALID_TOOL_NAMES` (`packages/shared/src/ecommerce-tools.ts`) and `ECOMMERCE_TOOLS` (`ai-worker/src/services/ecommerceToolHandler.ts`); add a `WHEN TO USE` line to `TOOL_PROMPT_ADDITION` ("customer asks about their order but gives a phone/email instead of an order number").
- Reuse `phonesMatch()` / `namesMatch()` (`backend/src/services/ecommerceActions.ts:59-80`) to post-filter / confirm matches.
- Reuse the existing platform request wrappers — `shopifyGraphQL()`, `sallaApiGet()`, `zidApiGet()` — for a new "search orders by contact" call. No new client framework.

### Per-platform feasibility (on CURRENT scopes — no re-OAuth)

| Platform | Feasible now? | Path |
|---|---|---|
| **Shopify** | ✅ Yes | `orders(query:"email:<addr>")` / `"phone:<num>"` via `shopifyGraphQL()` — same search syntax already used for `name:#…` at `shopify.ts:708`; supported on `read_orders`. **Build first.** |
| **Salla** | ❓ Pending API test | `/admin/v2/orders?keyword=<phone>` (`salla.ts:438`) — undocumented whether `keyword` matches customer phone. Test against a dev store before committing. |
| **Zid** | ❓ Pending API test | `/v1/orders?search=<phone>` (`zid.ts:413`); order response carries `customer_phone`. Test whether `search` indexes it. |

**Sequencing:** ship Shopify first (unblocked), then add Salla/Zid once the API test confirms phone/email matching (else they are scope-blocked and need a separate scope/feature request).

**Privacy:** keep the server-side verification gate — never surface order PII from a social identity until the phone/email match is confirmed server-side.

---

## Phase 2: Abandoned Cart Recovery (Weeks 2-3) — ⛔ BLOCKED (see callout above)

### 2a. New Webhook Subscriptions

| Platform | Events to Add | Where to Register |
|----------|---------------|-------------------|
| Salla | `abandoned.cart`, `abandoned.cart.purchased` | `salla.ts` `SALLA_WEBHOOK_EVENTS` array |
| Shopify | `checkouts/create`, `checkouts/update` | `shopify.ts` `registerWebhooks()` |
| Zid | Cart abandonment events (verify in Zid docs) | `zid.ts` |

### 2b. New DB Table: `abandonedCarts`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ecommerceStoreId | uuid FK | CASCADE |
| platformCartId | varchar | Unique per store |
| customerEmail | varchar (encrypted) | |
| customerPhone | varchar (encrypted) | |
| customerName | varchar | |
| cartTotal | real | |
| currency | varchar(10) | |
| itemCount | integer | |
| itemsSummary | text | For AI message generation |
| cartItems | jsonb | `[{productId, title, imageUrl, price, quantity}]` for rich cards |
| checkoutUrl | text | Deep link back to cart |
| status | varchar | 'abandoned' \| 'recovery_sent' \| 'recovered' \| 'expired' |
| recoveryMessageSentAt | timestamp nullable | |
| recoveredAt | timestamp nullable | |
| recoveredOrderId | varchar nullable | |
| discountCode | varchar nullable | |
| createdAt, updatedAt | timestamps | |

### 2c. Cart Recovery Service + Worker

**New files**: `cartRecovery.ts`, `cartRecoveryQueue.ts`, `cartRecoveryWorker.ts`

**Flow**: Webhook → store cart → delayed BullMQ job → look up customer mapping → AI-generate message → send DM with product cards + "Complete Purchase" button → track recovery

### 2d. AI Recovery Message Generation

**New file**: `ai-worker/src/services/recoveryMessageGenerator.ts`
**New endpoint**: `POST /generate-recovery` on AI worker

### 2e. Optional: Auto-Discount Codes

Requires new OAuth scopes (re-auth needed): Salla `coupons.read_write`, Shopify `write_price_rules,write_discounts`

### 2f. Merchant Settings (in `platformData` JSONB)

```json
{ "cartRecovery": { "enabled": false, "delayMinutes": 60, "discountEnabled": false, "discountPercent": 10 } }
```

### 2g. Frontend

Expand `ConnectedStoreCard` in `integrations.tsx` with collapsible automation settings.

---

## Phase 3: Proactive Order Notifications (Weeks 3-4)

### 3a. New Webhook Subscriptions

| Platform | Events |
|----------|--------|
| Salla | `order.created`, `order.status.updated`, `shipment.creating`, `shipment.delivered` |
| Shopify | `orders/create`, `orders/fulfilled`, `orders/cancelled`, `fulfillments/update` |
| Zid | Equivalent events |

### 3b. New DB Table: `orderNotifications`

Track every notification sent: storeId, orderId, eventType, senderId, status, sentAt.

### 3c-e. Service + Worker + Review Requests + Digital Delivery

- Order lifecycle notifications via proactive DM
- Post-delivery review requests (48h delay)
- Digital product delivery (auto-detect, send download link)

### 3f. Merchant Settings

```json
{ "orderNotifications": { "enabled": false, "notifyOnCreated": true, "notifyOnShipped": true, "notifyOnDelivered": true, "notifyOnCancelled": true, "reviewRequestEnabled": false, "reviewRequestDelayHours": 48, "digitalDeliveryEnabled": false } }
```

---

## Phase 4: Enhanced AI Tools (Week 5)

### 4a. Product Recommendations with Rich Cards

New tool: `recommend_products` — searches local `ecommerceProducts` table → AI generates comparison text → sends product card carousel.

### 4b. Stock Alerts + Price Drop Alerts

New tool: `subscribe_alert` — unified for back-in-stock and price-drop. New `productAlertSubscriptions` table. Triggered by existing product webhooks.

### 4c. Enhanced Inventory Tool

Extend `check_inventory` to include price, variants, and image for comparison scenarios.

---

## Phase 5: E-Commerce Analytics Dashboard (Week 6)

Aggregate from new tables: recovery rate, revenue recovered, notification delivery stats, customer mapping coverage. New frontend page with charts.

**Status: ✅ Shipped (Step 2, 2026-04-25)** — see Implementation Status table at the top of this doc.

---

## Phase 6: URL Wrapping + Click Tracking — Closes LetsBot's Attribution Gap

> **When:** Lands together with Step 3 (DM cart recovery). The new wrapping endpoint costs ~1.5 days and unlocks real attribution that benefits both Phase 5 analytics and Phase 2 cart recovery measurement.

### Why this matters

Today's cart-recovery attribution in `ecommerceAnalytics.ts` is **approximate**: a recovered cart is one where the same `customerPhone` received an `order_confirmed` notification within 72h of the `abandoned_cart` SMS. That over-credits us when a customer would have purchased anyway.

LetsBot wraps every URL in their recovery messages (e.g. `https://j24.link/r/abc123`) so they can show a real funnel: **delivered → opened → clicked → converted**. Per-template conversion rates and A/B testing (Phase 7) both depend on this signal.

### Scope

1. **New table `messageLinkClicks`** keyed by `notificationLogId` + `clickedAt` + `userAgent` + `referer`.
2. **New backend endpoint `GET /r/:token`** that:
   - Looks up the wrapped URL by token (unguessable, ~10 chars, base62)
   - Inserts a click row asynchronously (fire-and-forget)
   - 302-redirects to the destination
3. **New helper `wrapUrl(originalUrl, notificationLogId)`** in `services/urlWrapper.ts` that returns `https://${PUBLIC_HOST}/r/<token>`.
4. **Modify all proactive message senders** (`customerNotifications.send()`, `cartRecovery.ts`, `orderNotifications.ts`) to wrap any user-visible URL through `wrapUrl()` before substituting into the template body.
5. **Extend `ecommerceAnalytics.ts`**: add `clickThroughCount` to `RecoveryStats` + `byTemplate.clicks` to the type breakdown. Treat "clicked but no order yet" as soft-recovered (separate counter).
6. **Frontend dashboard tweak**: add a "Clicks" column to the funnel section once data exists. Channel-agnostic — works for SMS today, WhatsApp + DM later.

### What this is NOT

- Not analytics for inbound DMs/comments (the existing `messages` table already tracks those).
- Not bot detection — UA-based filtering is enough at v1; Cloudflare-style bot scoring is overkill.
- Not link-tracking for non-ecommerce messages (settings emails, etc.) — out of scope.

### Open questions

- Token format: random vs HMAC-signed-with-id? Random is simpler; HMAC is forgery-proof. Default to random + DB lookup.
- Domain: `jawab24.com/r/` (existing CORS surface) vs subdomain `j24.link`? Subdomain looks shorter in SMS; mainline is one less DNS thing. Defer; either works.
- TTL on click rows: keep all forever for analytics cohorts, or roll up after 90 days? Defer until data volume forces the question.

---

## Phase 7: A/B Template Testing + Per-Template Conversion

> **When:** Post-Step-3, post-Phase-6. Pure UX layer on top of the click data Phase 6 collects.

### Why this matters

LetsBot's most-loved feature on Salla reviews is "I tested 3 cart recovery messages and saw which one converted best." Without this, merchants stop iterating after they write the first message and assume the conversion rate they get is the ceiling.

### Scope

1. **Schema extension**: `customerNotificationTemplates` gains a `variant_group_id` (uuid) and `variant_weight` (int 1–100). Templates with the same group are siblings; the worker picks one weighted-randomly when sending.
2. **Worker logic**: `customerNotificationsWorker` resolves the group → picks a variant → records `template_variant_id` on the log row.
3. **Aggregation**: `ecommerceAnalytics.ts` joins click + order data on `template_variant_id` to compute conversion rate per variant.
4. **Frontend UI**: extend the existing template editor (`OrderNotificationsCard`) to support adding/removing variants. New analytics widget shows variants side-by-side with conversion rates and a "promote winner" button.
5. **Statistical significance hint**: surface "X impressions per variant, currently inconclusive" until each variant has ≥ 100 sends. No formal test — this is a hint to the merchant, not a recommendation engine.

### Why we're deferring

- Without Phase 6's click data, conversion rate is meaningless
- Most merchants haven't even iterated on their first message yet — no demand signal
- Building this before merchants ask is YAGNI territory

---

## Cross-reference: WhatsApp parity track

LetsBot's whole product is WhatsApp. The remaining LetsBot-parity gaps for *that* channel are tracked in [`WHATSAPP_PLAN.md`](./WHATSAPP_PLAN.md), not here. Status as of 2026-07-09 (channel shipped 2026-07-04, PR #392, behind founder canary):

| WhatsApp phase | Status | Why it matters for the LetsBot story |
|---|---|---|
| Phase B+C (text DMs through pipeline) | ✅ Done | Foundation — same `messageProcessor` as FB/IG, AI replies work out of the box |
| Phase 2 (Meta Tech Provider verification) | ✅ Done | Embedded Signup submission package (#406); **Meta App Review submitted 2026-07-08, in review** — clearing it opens the canary |
| Phase 3 (frontend connection UI) | ✅ Shipped (#392) | Embedded Signup connect, WhatsApp-only cards, multi-number |
| Phase 4 (template messages) | ⏳ In Meta review (submitted 2026-07-08); **no template code written yet** | **The LetsBot killer.** Proactive WhatsApp sends (cart recovery, order updates) require pre-approved templates. Phase 4 of the WhatsApp plan + Phase 2/3 of this plan are the matched pair |
| Phase 5 (media messages) | ✅ Core shipped (#392) — voice notes + inbound media; Catalog API rich cards still open | Rich product cards on WhatsApp (Catalog API integration) — equivalent to Phase 1b on Messenger/IG |
| Phase 6 (status callbacks) | ◐ Partial — **outbound** read receipts + typing indicators shipped (#423); **inbound** `statuses` consumption (delivery/read into analytics) still open | Read receipts → feeds Phase 5 analytics here, no extra work needed |

**Coordination note:** when WhatsApp Phase 4 + 6 ship, Phase 5 analytics in this plan automatically gains read-receipt + per-template-variant data for WhatsApp. The channel-keyed funnel structure shipped in Step 2 already accommodates this — no new schema migration.

---

## Implementation Priority (revised 2026-06-13)

| Phase | Feature | Impact | Effort | Status |
|-------|---------|--------|--------|--------|
| — | E-commerce **adoption** (get merchants to connect a store) | **The actual bottleneck** — only 2/82 pages connected | TBD | 🎯 Real near-term focus |
| 0 | Verify shipped order-status flow E2E | De-risks future work, but **0 prod traffic** to verify against today | ~0.5 day | ⏸️ Moot until usage exists |
| 1.5 | Inbound Order Auto-Resolve (Shopify → Salla/Zid) | High *once adoption exists*; no policy risk | ~3-5 days | ⏸️ PARKED — 0 tool usage, 2/82 pages (2026-06-13) |
| 1 | Foundation (messaging type + rich cards + tool loop) | Enables all | ~2 days | ✅ Shipped (`ae2d9c5a`) |
| 5 | Analytics Dashboard (lite) | Medium-High (retention) | ~3 days | ✅ Shipped (`17070f6a`) |
| 1d/1e + 2 | Customer mapping + DM Cart Recovery | Was "Very High" — now low-reach (SMS covers it) | ~8 days+ | ⛔ BLOCKED (Meta policy) |
| 3 | Order Notifications via DM | High (satisfaction) | ~6 days | ⚠️ Re-scope vs Utility Templates first |
| 6 | URL Wrapping + Click Tracking | High (attribution) | ~1.5 days | 📋 Lands with a *compliant* proactive channel |
| 7 | A/B Template Testing | Medium (retention) | ~4 days | 📋 After Phase 6 has data |
| 4 | Enhanced AI Tools (recommendations + alerts) | Medium | ~5 days | ⏸️ Deferred until usage demands it |
| WA | WhatsApp Phases 2/3/4/5/6 | Very High (LetsBot parity) | ~3 weeks code + paperwork | ✅ 2/3/5 shipped (#392, canary); 4 in Meta review; 6 partial — see `WHATSAPP_PLAN.md` |

**Active roadmap from here:** the production check (2026-06-13) shows **e-commerce adoption is the bottleneck** — only 2/82 pages have a store connected and the order-status tools have 0 invocations. So the near-term focus is **store-connection onboarding/activation**, not more tool features. Inbound Auto-Resolve is fully specced and **PARKED** until usage exists. DM cart recovery stays parked pending a compliant Meta channel (Marketing Messages opt-in for promo; Utility Templates for transactional). **SMS** covers broad-reach recovery/notifications today; **WhatsApp** template messages remain the real proactive-channel bet.

---

## Open questions to resolve before building (added 2026-06-13)

Three load-bearing unknowns gate the revised roadmap. All are quick checks:

1. **Meta policy — ✅ CONFIRMED 2026-06-13.** The official [Messenger Platform changelog](https://developers.facebook.com/docs/messenger-platform/changelog/) states `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, and `POST_PURCHASE_UPDATE` are deprecated **effective 2026-04-27** — requests with them now return **error 100**. The ⛔ blocker stands. Meta's stated migration paths split the two use cases: **Phase 2 (cart recovery = promotional)** → **Marketing Messages API** (explicit opt-in, limited countries); **Phase 3 (order notifications = transactional)** → **Utility Templates** (likely a compliant path — re-scope Phase 3 against Utility Templates specifically, not Marketing Messages). `HUMAN_AGENT` remains but is support-only / no promo.
2. **Salla order search** (gates Salla auto-resolve). Does `/admin/v2/orders?keyword=<phone>` match customer phone, or only order number/reference? Test against a connected dev store.
3. **Zid order search — ✅ ANSWERED 2026-08-22 (docs), live test still owed.** The param is not `search` but **`search_term`**, documented on docs.zid.sa "List Orders" as *"Natural language lookup through (customer phone, customer email, order code, or customer name)"* — so **yes, it indexes the customer phone**, and Zid auto-resolve is unblocked in principle. Alongside it: `order_id`, `order_status`, `payment_status`, `date_from`/`date_to`, `per_page` ≤ 100. ⚠️ Not yet exercised against a live order — no order has ever been placed on the dev store (§E), so the shipped `findOrderByCode` still scans 3 × 100 recent orders client-side. Verify with the first real order, then swap the seam.
   ⛔ **Do not assume the products endpoint behaves like this one.** Its `?search=` is documented the same way and, live-captured the same day, **ignores the term entirely** (`search=نظارة` and `search=كاميرا` each returned all 4 products). Product resolution is therefore ours to solve — see D-091 and `docs/integrations/zid-edge-case-audit.md` F6.

**Cleanup noted:** the Phase-4 `searchProducts()` in the "Modified Files" table below was never built, but left dangling comments referencing a non-existent `search_products` tool at `backend/src/services/reply/generator.ts:20` and `:284`. Remove or correct them whenever the order-status code is next touched.

---

## New Files Summary

| File | Purpose |
|------|---------|
| `backend/src/services/customerMapping.ts` | Customer identity mapping CRUD |
| `backend/src/services/proactiveMessaging.ts` | Shared proactive DM sender with rate limiting |
| `backend/src/services/cartRecovery.ts` | Cart recovery logic |
| `backend/src/services/orderNotifications.ts` | Order notification logic |
| `backend/src/lib/cartRecoveryQueue.ts` | BullMQ queue for delayed cart recovery |
| `backend/src/lib/orderNotificationQueue.ts` | BullMQ queue for order notifications |
| `backend/src/workers/cartRecoveryWorker.ts` | Cart recovery job processor |
| `backend/src/workers/orderNotificationWorker.ts` | Order notification job processor |
| `ai-worker/src/services/recoveryMessageGenerator.ts` | AI cart recovery message generation |
| `frontend/src/pages/ecommerce-analytics.tsx` | Analytics dashboard page |
| `frontend/src/i18n/{en,ar}/ecommerceAnalytics.json` | Analytics i18n strings |

## Modified Files Summary

| File | Changes |
|------|---------|
| `backend/src/db/schema.ts` | Add 4 tables: `ecommerceCustomerMap`, `abandonedCarts`, `orderNotifications`, `productAlertSubscriptions` |
| `backend/src/services/facebook.ts` | Add `messaging_type`/`tag` to `sendPrivateMessage()`, add `sendProductCards()` |
| `backend/src/services/instagram.ts` | Same as facebook.ts |
| `backend/src/services/ecommerceActions.ts` | Add `recommend_products`/`subscribe_alert` executors, populate customer map on verification |
| `backend/src/services/ecommerceToolLoop.ts` | Return `productCards` in response |
| `backend/src/controllers/{salla,shopify,zid}.ts` | Handle cart/order/shipment webhook events |
| `backend/src/services/{salla,shopify,zid}.ts` | Add webhook events, `searchProducts()`, optional `createDiscountCode()` |
| `backend/src/services/reply/messageProcessor.ts` | After sendReply (~line 414), send product cards if present |
| `backend/src/integrations/registry.ts` | Add optional capability methods |
| `packages/shared/src/index.ts` | Add `ProductCard` type, extend `AiGenerateResponse` |
| `packages/shared/src/ecommerce-tools.ts` | Add `recommend_products`, `subscribe_alert` to tool names |
| `ai-worker/src/services/ecommerceToolHandler.ts` | Add tool definitions |
| `frontend/src/pages/integrations.tsx` | Expand `ConnectedStoreCard` with automation settings |
| `frontend/src/i18n/{en,ar}/ecommerce.json` | New strings |

---

## Future Milestone: Voice Messages + Advanced Customer Features

- **Voice message understanding** — Whisper API transcription → process as text → reply with product cards
- **Wishlist via DM** — customers save products and recall them later
- **Quick reorder** — "order the same as last time" with one message
