# E-Commerce Power Features for Jawab24

> **Created:** 2026-04-04
> **Status:** Phase 1 (foundation) partially shipped — see status table below
> **Companion plan:** `ECOMMERCE_NOTIFICATIONS_PLAN.md` — covers SMS delivery (broad reach for all customers).
> This plan covers Facebook/Instagram DM delivery (rich experience for mapped customers).
> **Delivery priority:** DM first (if customer mapping exists) → SMS fallback (if phone available) → skip

## Implementation Status (2026-04-25)

| Phase | Status | Notes |
|---|---|---|
| 1a — Messaging Type Support | ✅ **Shipped** (`ae2d9c5a`) | `sendPrivateMessage()` + `sendDirectMessage()` accept `opts.messagingType`, defaults to `RESPONSE` |
| 1b — Rich Product Cards (Generic Template) | ✅ **Shipped** (`ae2d9c5a`) | `metaMessaging.ts` + `productCardBuilder.ts`; sends after text reply when `check_inventory` returns a synced product image |
| 1c — Postback Webhook Handler | ⏸️ **Deferred** | Not needed for v1 — using `web_url` buttons only. Add when an action button is designed |
| 1d — Customer Identity Mapping | 📋 **Planned** (Step 3) | Required before DM-based cart recovery |
| 1e — Proactive Message Sender | 📋 **Planned** (Step 3) | Depends on 1d |
| 1f — Tool Loop Return Type | ✅ **Shipped** (`ae2d9c5a`) | `AiGenerateResponse.productCards?` + `GenerateReplyResult.productCards?` threaded through pipeline |
| 2 — Abandoned Cart Recovery (DM) | 📋 **Planned** (Step 3) | SMS version already live via `customerNotifications` |
| 3 — Order Notifications (DM) | 📋 **Planned** (later) | SMS version already live |
| 4a — Product Recommendations Carousel | ⏸️ **Deferred** | Defer until usage data shows demand |
| 4b — Stock / Price Alerts | ⏸️ **Deferred** | Same |
| 5 — Analytics Dashboard | 📋 **Planned** (Step 2 — next) | Reads existing `customerNotificationsLog`; no new tables for v1 |

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

## Phase 2: Abandoned Cart Recovery (Weeks 2-3) — Highest ROI

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

---

## Implementation Priority

| Phase | Feature | Impact | Effort | When |
|-------|---------|--------|--------|------|
| 1 | Foundation (messaging + mapping + cards + postbacks) | Enables all | ~5 days | Week 1 |
| 2 | Abandoned Cart Recovery | Very High (revenue) | ~8 days | Weeks 2-3 |
| 3 | Order Notifications + Reviews + Digital Delivery | High (satisfaction) | ~6 days | Weeks 3-4 |
| 4 | Enhanced AI Tools (recommendations + alerts) | Medium-High | ~5 days | Week 5 |
| 5 | Analytics Dashboard | Medium (ROI proof) | ~4 days | Week 6 |

**Total: ~28 days / 6 weeks**

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
