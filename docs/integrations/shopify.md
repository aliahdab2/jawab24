# تكامل Shopify - Shopify Integration

## Overview

Shopify integration allows Jawab24 to enrich AI replies with real product data (prices, availability, variants) from a connected Shopify store, and to send customers order-lifecycle SMS (confirmed, shipped, delivered, review request). When a customer asks about a product on Facebook/Instagram, the AI can answer accurately using live catalog data.

> Shopify, Salla, and Zid share a **unified e-commerce core** (`services/ecommerce.ts`, unified `ecommerce_*` tables, shared sync queue + adapters). This doc covers the Shopify-specific pieces; see [`.planning/codebase/INTEGRATIONS.md`](../../.planning/codebase/INTEGRATIONS.md) for the cross-platform architecture.

### Architecture

```
Shopify App Store ─► OAuth Flow ─► Store Created ─► Product Sync (BullMQ Worker)
                                                          │
Facebook/Instagram Comment ─► Reply Pipeline ─► AI Generator ◄── Enriched KB
                                                                  (products + policies)

Shopify order/fulfillment webhooks ─► customer_notifications_log ─► SMS (BullMQ)
```

### Two Install Flows

1. **Logged-in user** (from Integrations page): OAuth → store created immediately → redirect to onboarding
2. **Shopify-first** (from Shopify App Store): OAuth → pending install created (encrypted token) → user logs in → pending install claimed → store created

---

## Files

### Backend

| Layer | File | Description |
|-------|------|-------------|
| Route | `src/routes/shopify.ts` | Public (OAuth, webhooks, GDPR) + protected (store CRUD) routes |
| Controller | `src/controllers/shopify.ts` | Request handling, auth detection, HMAC verification, order/fulfillment webhooks |
| Service | `src/services/shopify.ts` | Core logic: OAuth, GraphQL API, product sync, order/shipment/inventory tools |
| Service | `src/services/ecommerce.ts` | Shared: store CRUD, products, KB enrichment, cache invalidation, GDPR purge/redact |
| Service | `src/services/ecommerceCrypto.ts` | AES-256-GCM encryption for access tokens (`ECOMMERCE_TOKEN_ENCRYPTION_KEY`, falls back to the legacy Shopify key) |
| Integration | `src/integrations/shopify.ts` | Adapter: webhook topics, KB enrichment, lifecycle hooks (registered in `integrations/index.ts`) |
| Queue | `src/lib/ecommerceSyncQueue.ts` | Shared BullMQ queue for product sync jobs |
| Worker | `src/workers/ecommerceSyncWorker.ts` | Shared background worker (dispatches by platform) |
| Notifications | `src/services/orderNotificationScheduler.ts`, `src/services/customerNotifications.ts` | Normalize order events → schedule/dedup customer SMS |

### Frontend

| File | Description |
|------|-------------|
| `src/pages/shopify/onboarding.tsx` | 3-step onboarding wizard (sync → link page → done) |
| `src/pages/integrations.tsx` | Unified integrations page (Shopify + Salla); renders the store card via a local `ConnectedStoreCard` |

### Database

All e-commerce platforms share the same unified schema:

| Table / Column | Purpose |
|----------------|---------|
| `ecommerce_stores` | Connected stores (platform, domain, encrypted tokens, product summary, policies, webhook status) |
| `ecommerce_products` | Synced product catalog (title, price range, variants, inventory) |
| `pending_ecommerce_installs` | Temporary records for the store-first install flow (30min TTL) |
| `pages.ecommerce_store_id` | FK linking a Facebook/Instagram page to a store (`ON DELETE SET NULL`) |
| `plans.ecommerce_enabled` | Feature flag per pricing plan |
| `customer_notification_templates` / `customer_notifications_log` | Order-notification templates + audit trail / dedup |

---

## Setup

### Dev Store Credentials

| Field | Value |
|-------|-------|
| Store | `jawab24-demo.myshopify.com` |
| Admin | `jawab24-demo.myshopify.com/admin` |

> Local dev tunnel + full flow: see the `/shopify-dev` skill.

### 1. Create Shopify App

1. Go to [Shopify Partners](https://partners.shopify.com/)
2. Create a new app (Custom app or Public app)
3. Set the App URL to `https://jawab24.com/shopify/auth`
4. Set the Allowed redirection URL to `https://jawab24.com/shopify/auth/callback`
5. Required scopes (`config.shopify.scopes`): `read_products`, `read_content`, `read_orders`, `read_fulfillments`, `read_inventory`

### 2. Configure GDPR Endpoints

In Shopify Partners > App Setup > GDPR mandatory webhooks:

| Endpoint | URL |
|----------|-----|
| Customer data request | `https://jawab24.com/shopify/gdpr/customers/data_request` |
| Customer data erasure | `https://jawab24.com/shopify/gdpr/customers/redact` |
| Shop data erasure | `https://jawab24.com/shopify/gdpr/shop/redact` |

### 3. Environment Variables

Add to `env/backend.env`:

```bash
# Shopify App credentials (from Partners dashboard)
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_HOST_NAME=jawab24.com

# Shared encryption key for e-commerce tokens (generate with: openssl rand -hex 32)
ECOMMERCE_TOKEN_ENCRYPTION_KEY=your_64_char_hex_string
# (Legacy SHOPIFY_TOKEN_ENCRYPTION_KEY is still read as a fallback for existing rows)
```

---

## How It Works

### OAuth Flow

1. User clicks "Install" on Shopify App Store (or connects from Integrations)
2. Redirect to `GET /shopify/auth?shop=store.myshopify.com`
3. Server generates cryptographic nonce, sets signed cookie, redirects to Shopify OAuth
4. Shopify redirects back to `GET /shopify/auth/callback?shop=...&code=...&state=...`
5. Server validates nonce (signed cookie vs state param), exchanges code for access token
6. **If logged in**: Creates store directly, registers webhooks, enqueues sync, redirects to onboarding
7. **If not logged in**: Encrypts token, creates pending install, sets cookie, redirects to login

### Product Sync

- Triggered on: store creation, manual sync, per-product webhook
- Uses Shopify **GraphQL** Admin API — version pinned in `SHOPIFY_API_VERSION` (currently **`2026-04`**; guarded by `test/services/shopifyApiVersion.test.ts`, which fails ~60 days before the version sunsets)
- Fetches products page-by-page (cursor pagination) up to the shared `PRODUCT_SAFETY_CAP`
- Syncs: shop info, products (title, price, variants, inventory), shipping/refund policies
- Generates a text summary (`productSummary`, `policiesSummary`) for AI context
- Retries on HTTP 429/5xx **and** on cost-based `THROTTLED` (HTTP 200 + `errors[].extensions.code`), with backoff derived from `extensions.cost.throttleStatus`

### Customer Order Notifications

Order/fulfillment webhooks are normalized into a platform-agnostic `OrderEvent` (`orderNotificationScheduler.ts`) and scheduled as customer SMS, deduplicated by `(store, type, platform_event_id)`:

| Topic | Notification |
|-------|--------------|
| `orders/create` | `order_confirmed` |
| `orders/fulfilled` | `order_shipped` (with tracking) |
| `fulfillments/update` (`shipment_status === 'delivered'`) | `order_delivered` (+ `review_request`) |
| `orders/cancelled` | none (subscribed, no notification) |

> Delivery is **not** an `orders/*` event — the order-level `fulfillment_status` enum is only `null|partial|fulfilled|restocked`. The delivered signal is `fulfillment.shipment_status`, delivered on the `fulfillments/update` topic. The handler fetches the order via GraphQL for a canonical phone/order number, falling back to the webhook's `destination` fields.

### KB Enrichment

When a comment/message arrives for a page linked to a store:
1. `contextEnricher` checks `page.ecommerceStoreId`
2. Calls the platform adapter's `enrichKnowledgeBase(existingKB, storeId)`
3. Appends product catalog summary + policies to the knowledge base
4. AI generates reply with real product data (and can call the order/shipment/inventory tools)

### Security

- **Token encryption**: access tokens encrypted at rest with AES-256-GCM (`ecommerceCrypto.ts`)
- **HMAC verification**: all Shopify webhooks (incl. GDPR) verified via base64 `X-Shopify-Hmac-SHA256` over the raw body, timing-safe
- **Signed cookies**: OAuth nonce and pending install ID use signed, httpOnly cookies
- **CSRF protection**: OAuth state param validated against signed nonce cookie
- **Input validation**: shop domain regex validated on OAuth entry points

---

## Billing (Shopify App Pricing) — D-054

Merchants installing from the App Store pay INSIDE Shopify (App Pricing); Stripe never
touches them. Shopify delivers **no webhook** for App Pricing enrollments
(post-2026-04-28 apps), so the local `subscriptions` row is a **mirror maintained by
verify-and-reconcile**, never by events:

- **One choke point:** `services/shopifyBilling.ts → syncShopifyBilling(shopDomain)`
  asks the Admin API (`currentAppInstallation.activeSubscriptions`) and reconciles the
  local row (adopt / pause / no-op). Idempotent — no drift, no write.
- **Three triggers:** `GET /shopify/billing/return` (the redirection URL configured on
  every App Pricing plan; its query params only *trigger* a server-side verify),
  the post-claim hook in `integrations/shopify.ts`, and a 6-hourly reconciler in
  `index.ts` (`ShopifyBillingReconcile`) that also Sentry-flags orphaned live mirrors.
- **Row shape (migration 0147):** `payment_method='shopify'`, AppSubscription GID in
  `external_subscription_id`, shop domain in `shopify_shop_domain` (CHECK-required;
  partial-unique among non-canceled shopify rows so an uninstalled shop stays
  adoptable by another workspace).
- **Plan mapping (fail-loud):** App Pricing plan handles = plan slugs;
  `config/shopifyBilling.ts` maps handle/name → slug. Unknown → NO activation + Sentry.
- **Subject:** the workspace OWNER's subscription row (the `hasWhatsAppPlanAccess`
  pattern), regardless of which member connected the store.
- **Uninstall** (`webhookUninstall`) cancels the local mirror before deactivating the
  store — a paid local subscription can no longer outlive the app (D-023 class).
- **No Stripe beside it:** all six Stripe surfaces — checkout, subscription-intent,
  change-plan, top-up intent, cancel-subscription, billing portal — return 400
  `SHOPIFY_BILLED`; the frontend hides the top-up CTA and routes plan management to
  `admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans`
  (`SHOPIFY_APP_HANDLE` env, exposed as `shopifyManageUrl` in `/subscription/usage`).
- **Trials** mirror Shopify's own clock (`trialDays`); the Stripe trial ledger is not
  involved.

> ⚠️ **Pending live verification (V3):** whether `activeSubscriptions` reflects App
> Pricing enrollments is confirmed only at the dev-store dogfood (§O of
> `docs/testing/SHOPIFY_TEST_PLAN.md`). The fork is isolated inside
> `fetchShopifyActiveSubscription` — a swap to the Partner API changes no callers.

---

## API Endpoints

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/shopify/auth` | Start OAuth flow |
| GET | `/shopify/auth/callback` | OAuth callback |
| GET | `/shopify/billing/return` | App Pricing return URL — triggers server-side billing sync (rate-limited) |
| POST | `/shopify/webhooks/uninstall` | App uninstalled webhook |
| POST | `/shopify/webhooks/products-update` | Product create/update/delete webhook |
| POST | `/shopify/webhooks/orders` | Order create/fulfilled/cancelled webhook |
| POST | `/shopify/webhooks/fulfillments` | Fulfillment update webhook (delivery detection) |
| POST | `/shopify/gdpr/customers/data_request` | GDPR data request (ack + log) |
| POST | `/shopify/gdpr/customers/redact` | GDPR customer redact (deletes stored PII) |
| POST | `/shopify/gdpr/shop/redact` | GDPR shop redact (purges the store + all data) |

### Protected (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/shopify/store` | Get connected store info (incl. `webhookHealth`) |
| GET | `/shopify/store/products` | List synced products |
| POST | `/shopify/store/connect` | Start connection (returns OAuth URL) |
| DELETE | `/shopify/store` | Disconnect store (admin) |
| POST | `/shopify/store/sync` | Trigger manual product sync (admin) |
| POST | `/shopify/store/webhooks/reregister` | Manual webhook re-registration (admin) |
| PATCH | `/shopify/store/link-page` | Link store to a page (admin) |
| PATCH | `/shopify/store/unlink-page` | Unlink store from a page (admin) |

### Subscribed webhook topics

Source of truth: `SHOPIFY_WEBHOOK_TOPIC_DEFS` / `SHOPIFY_WEBHOOK_EVENTS` in `services/shopify.ts` (paired with `SHOPIFY_WEBHOOK_TOPICS` in `integrations/shopify.ts`; the pair is pinned in `test/integrations/webhookTopicDrift.test.ts`):

`app/uninstalled`, `products/create`, `products/update`, `products/delete`, `orders/create`, `orders/fulfilled`, `orders/cancelled`, `fulfillments/update`

Registration goes through the Admin **GraphQL** API (`webhookSubscriptions` query + `webhookSubscriptionCreate`/`webhookSubscriptionUpdate` mutations) as a **list-then-upsert**: existing subscriptions are matched by topic; a subscription whose callback URL drifted (hostname change, dev tunnel) is updated in place instead of left stale. Deliveries still carry the REST-style topic name in `X-Shopify-Topic`, and `webhookStatus.registered` keeps that format — handlers and the integrations UI are unchanged.

> **New topics only register at install/claim.** After deploying a topic change, run `node dist/scripts/reregister-webhooks.js shopify` in the backend container once so already-connected stores subscribe to it (idempotent — already-registered topics with a matching callback URL are skipped, drifted ones updated). Per-workspace, the admin "Re-register" button hits `POST /shopify/store/webhooks/reregister`.

---

## Tests

| File | Coverage |
|------|----------|
| `test/controllers/shopify.test.ts` | OAuth flow, product/order/fulfillment webhooks, GDPR, protected CRUD |
| `test/services/shopify.test.ts` | Service logic, webhook registration, KB enrichment |
| `test/services/shopify.orders.test.ts` | Order/shipment/inventory tools, `getOrderNotificationTarget`, THROTTLED handling |
| `test/services/shopifyApiVersion.test.ts` | API-version sunset guard |
| `test/services/ecommerceCrypto.test.ts` | AES-256-GCM encrypt/decrypt, tamper detection (shared token crypto) |
| `test/integrations/webhookTopicDrift.test.ts` | Adapter topic list matches what's registered |
| `test/integration/ecommerce-sync.test.ts` | Full sync + webhook product path against real Postgres |

> Manual dogfood suite: `npm run test:ecommerce:shopify` (see `docs/testing/SHOPIFY_TEST_PLAN.md`).
