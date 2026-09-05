# Salla Integration

## Overview

Salla integration allows Jawab24 to enrich AI replies with real product data (prices, availability, variants) from a connected Salla store. When a customer asks about a product on Facebook/Instagram, the AI can answer accurately using live catalog data.

### Architecture

```
Salla App Store --> OAuth Flow --> Store Created --> Product Sync (BullMQ Worker)
                                                          |
Facebook/Instagram Comment --> Reply Pipeline --> AI Generator <-- Enriched KB
                                                                  (products + policies)
```

### Key Differences from Shopify

| Feature | Shopify | Salla |
|---------|---------|-------|
| API | GraphQL Admin API | REST API |
| Auth tokens | Permanent (no expiry) | 14-day expiry, single-use refresh tokens |
| Token refresh | Not needed | Redis distributed lock (race condition protection) |
| Webhook HMAC | Base64 digest | Hex digest |
| Webhook registration | During OAuth scopes | Via API call after OAuth |
| Shop domain input | Required (user enters `store.myshopify.com`) | Not needed (merchant authenticates directly) |
| GDPR endpoints | Required (3 mandatory endpoints) | Not required |
| Product pagination | GraphQL cursor-based (50/page) | REST page-based (65/page) |
| Max products synced | Shared `PRODUCT_SAFETY_CAP` (5000), 50/page | Shared `PRODUCT_SAFETY_CAP` (5000), 65/page |
| Merchant ID | Not applicable | Stored in `platformData.merchantId` |

### Two Install Flows

1. **Logged-in user** (from Settings/Integrations page): OAuth -> store created immediately -> redirect to onboarding
2. **Salla-first** (from Salla App Store): OAuth -> pending install created (encrypted token) -> user logs in -> pending install claimed -> store created

### Easy Mode (`app.store.authorize`) — asymmetric to Shopify/Zid

Published Salla apps use **Easy Mode**: instead of an OAuth redirect, Salla POSTs an `app.store.authorize` webhook carrying the access/refresh tokens directly. This has no Shopify/Zid equivalent, so its plumbing is Salla-only.

- **Token receipt** — `handleStoreAuthorize` (`controllers/salla.ts`) validates HMAC (via the shared webhook path), then stores the tokens as a **pending install** keyed by Salla `merchant` id. No page is linked yet.
- **Claim** — the merchant later logs into Jawab24 and binds the pending install to their workspace via the claim endpoints below.
- **Dormant by default** — the claim endpoints return **404** unless `SALLA_EASY_MODE_CLAIM_ENABLED=true` (`config.salla.easyModeClaimEnabled`). They stay off until the ownership binding is hardened — see [`DECISIONS.md` D-012](../../DECISIONS.md). Token *receipt* still runs so nothing is lost while the claim path is gated.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/salla/store/pending` | List pending Easy-Mode installs for the logged-in user to claim (JWT; 404 while dormant) |
| POST | `/salla/store/claim` | Bind a pending install to the user's workspace → creates the store (JWT; 404 while dormant) |

---

## Files

### Backend

| Layer | File | Description |
|-------|------|-------------|
| Route | `src/routes/salla.ts` | Public (OAuth, webhooks) + protected (store CRUD) routes |
| Controller | `src/controllers/salla.ts` | Request handling, auth detection, HMAC verification |
| Service | `src/services/salla.ts` | Core logic: OAuth, REST API, token refresh, product sync |
| Service | `src/services/ecommerce.ts` | Shared: store CRUD, products, KB enrichment, cache invalidation |
| Service | `src/services/ecommerceCrypto.ts` | AES-256-GCM encryption for access/refresh tokens |
| Service | `src/services/cookies.ts` | Cookie config for cross-site OAuth redirects |
| Integration | `src/integrations/salla.ts` | Adapter: route registration, KB enrichment, lifecycle hooks |
| Queue | `src/lib/ecommerceSyncQueue.ts` | Shared BullMQ queue for product sync jobs |
| Worker | `src/workers/ecommerceSyncWorker.ts` | Shared background worker (dispatches by platform) |

### Frontend

| File | Description |
|------|-------------|
| `src/pages/salla/onboarding.tsx` | 3-step onboarding wizard (sync -> link page -> done) |
| `src/pages/integrations.tsx` | Unified integrations page (Shopify + Salla); renders the store card via a local `ConnectedStoreCard` |

### Database

All e-commerce platforms share the same unified schema:

| Table | Purpose |
|-------|---------|
| `ecommerce_stores` | Connected stores (platform, domain, encrypted tokens, product summary) |
| `ecommerce_products` | Synced product catalog (title, price range, variants, inventory) |
| `pending_ecommerce_installs` | Temporary records for Salla-first install flow (30min TTL) |
| `pages.ecommerceStoreId` | FK linking a Facebook/Instagram page to a store |

---

## Setup

### 1. Create Salla App

1. Go to [Salla Partners](https://salla.partners/)
2. Create a new app
3. Set the Callback URL to `https://jawab24.com/salla/auth/callback`
4. Required scopes (`config.salla.scopes`): `offline_access`, `products.read_write`, `settings.read`, `webhooks.read_write`, `orders.read_write`, `shipping.read`

> ⚠️ `shipping.read` is required for the `track_shipment` tool. Salla serves order detail in
> **light** format to every app created after 15 Aug 2024 (ours dates from 2026-02-25), and the
> light payload omits `shipments`, `items`, pickup branch and customer groups. Tracking therefore
> comes from a separate [List Shipments](https://docs.salla.dev/5394232e0) call
> (`GET /admin/v2/shipments?order_id=…`), which that scope gates.
>
> ⛔ **`config.salla.scopes` is not the grant.** It is read only by `buildAuthUrl` — the OAuth
> path used in dev / Custom Mode. The published app runs in **Easy Mode**, where the token
> arrives via `app.store.authorize` and `buildAuthUrl` is never called, so for production the
> scope is granted **solely** by the app's configuration in Salla Partners. Tick it there.
> Any store that authorised before the scope was added keeps its old grant until it reconnects
> (a 403 degrades tracking to status-only rather than failing the reply).
>
> The 1 Sep 2026 deprecation of `expanded=true` / the legacy expanded response does **not** affect
> us: we never sent that parameter and were never eligible for the expanded shape. No migration is
> owed — do not re-audit it.

### 2. Configure Webhooks

Webhooks are registered automatically via API after OAuth. All events are registered to a **single endpoint** (`POST /salla/webhooks`) that dispatches by the `event` field in the request body:

| Event | Action |
|-------|--------|
| `product.created` | Enqueue product sync |
| `product.deleted` | Enqueue product sync |
| `product.price.updated` | Enqueue product sync |
| `product.status.updated` | Enqueue product sync |
| `product.quantity.low` | Enqueue product sync |
| `app.uninstalled` | Deactivate store |
| `order.created` | Schedule `order_confirmed` customer SMS |
| `order.updated` | Ignored (fires alongside `order.status.updated`; avoids double-send) |
| `order.status.updated` | Schedule SMS by `data.customized.slug`: `shipped` → `order_shipped`, `delivered`/`completed` → `order_delivered` (+ `review_request`) |
| `order.shipment.created` | Schedule `order_shipped` **with tracking** (payload `data` is the shipment) |
| `abandoned.cart` | Schedule `abandoned_cart` recovery SMS |

> **11 subscribed events** — the source-of-truth list is `SALLA_WEBHOOK_EVENTS` in `services/salla.ts`. Salla has **no** `order.completed` and **no** `order.shipping.update` event (verified against docs.salla.dev): completion/delivery is a status *value* inside `order.status.updated`, and tracking arrives via `order.shipment.created`.

#### Shipped-notification behaviour (single SMS, with tracking when available)

`order.status.updated` (slug `shipped`) carries **no** tracking number, while `order.shipment.created` does — and its `data` is the shipment object (`ship_to.phone` + top-level `tracking_number`), *not* an order. Both paths share the dedup key `salla:order_shipped:<order_id>`, so the customer gets exactly one shipped SMS:

- **Shipment webhook only** → immediate SMS with tracking.
- **Status webhook only** (manual merchants) → SMS after a 5-min grace, without tracking.
- **Both** → the tracking-bearing shipment upgrades the (still-pending) status row's message in place, so the single SMS includes the tracking number.

Enforced by the unique index on `(ecommerce_store_id, notification_type, platform_event_id)` (migration `0130`) + `onConflictDoNothing`/in-place upgrade in `services/customerNotifications.ts`.

### 3. Environment Variables

Add to `env/backend.env`:

```bash
# Salla App credentials (from Partners dashboard)
SALLA_CLIENT_ID=your_client_id
SALLA_CLIENT_SECRET=your_client_secret
SALLA_HOST_NAME=jawab24.com
SALLA_WEBHOOK_SECRET=your_webhook_secret
# Salla Application ID (prod app = 665811310). Required by the billing rail's
# subscription read; unset = billing is DORMANT (reconcile cron disabled, every
# sync answers no_store) — deploy-safe, but a paying merchant activates nothing.
SALLA_APP_ID=665811310

# Shared encryption key for e-commerce tokens (generate with: openssl rand -hex 32)
SHOPIFY_TOKEN_ENCRYPTION_KEY=your_64_char_hex_string
```

---

## How It Works

### OAuth Flow

1. User clicks "Connect Store" on Integrations page (or installs from Salla App Store)
2. Server generates cryptographic nonce, sets signed cookie, redirects to Salla OAuth
3. Salla authenticates the merchant (no shop domain input needed)
4. Salla redirects back to `GET /salla/auth/callback?code=...&state=...`
5. Server validates nonce (signed cookie vs state param), exchanges code for tokens
6. **If logged in**: Creates store directly, registers webhooks, enqueues sync, redirects to onboarding
7. **If not logged in**: Encrypts tokens, creates pending install, sets cookie, redirects to login

### Token Refresh (Critical)

Salla access tokens expire after 14 days. Refresh tokens are **single-use** (using one invalidates it).

- **Proactive refresh**: If token expires within 24h, refresh before any API call (`ensureValidToken()`)
- **Periodic refresh**: Every 6 hours, scan for tokens expiring within 2 days (`refreshExpiringTokens()`)
- **Race condition protection**: Redis distributed lock (`NX` + 30s TTL) prevents concurrent refreshes
- If another process holds the lock, wait 2s and re-read the (now refreshed) token from DB

### Product Sync

- Triggered on: store creation, manual sync, product webhook events
- Uses Salla REST API (`GET /admin/v2/products`)
- Fetches products page-by-page (65/page) up to the shared `PRODUCT_SAFETY_CAP` (5000); the DB layer returns `capped: true` if the catalog exceeds it
- Maps Salla statuses: `sale` -> `active`, `out` -> `out_of_stock`, `hidden` -> `hidden`, `deleted` -> `archived`
- Strips HTML from product descriptions
- Builds variant summary from product options
- Generates text summary (`productSummary`) for AI context
- Retries on 429/5xx with exponential backoff (up to 3 retries)

### Store Facts Sync (D-102)

Every `fullSync` (install enqueue, 6h cron, manual sync button) also reads the
store's contact facts from the same `GET /admin/v2/store/info` response —
`mobile` + `phone`, `social.whatsapp` (bare number or wa.me link),
`default_branch.working_hours` (Arabic day labels, `{from,to}` windows), and
the storefront `domain` as `website` — and applies them to every linked page's
`pages.business_profile` as provenance source **`store_sync`**:

- Mapping: `mapSallaStoreFacts` / `mapSallaWorkingHours` (`services/salla.ts`) —
  pure, throw-free; an unreadable field is dropped + reported to Sentry
  (fingerprint `store-facts-field-drop`), never aborts the sync. Days Salla
  omits are NOT written as closed (absence is not a schedule).
- Writer: `services/storeFactsSync.ts:applyStoreFactsToLinkedPages` — merges via
  `applyStoreSyncToMerchant` (`@jawab24/shared`). Precedence
  `editor(confirmed) > kb_extract > store_sync > fb_sync`: a merchant's
  confirmed edit or KB-derived fact is never overwritten; stale FB values are.
- Ordering contract: the facts write runs **before** `syncProducts`, whose
  `invalidateCachesForStore` tail retires the semantic cache and re-ingests RAG
  for the same linked pages.
- The raw consumed subset is snapshotted at `platformData.storeFacts`
  (audit trail; merged, never replacing other platformData keys).
- Reaches the AI through the existing BUSINESS_INFO block
  (`formatBusinessInfoPrompt`) — `store_sync` is authoritative, unlike
  unconfirmed `fb_sync`. No PROMPT_VERSION change: pages without store facts
  keep byte-identical prompts.

Policies (return/shipping) are NOT part of this sync — Salla's Merchant API
exposes no policy-pages endpoint; the merchant authors them in the `/business`
facts editor (`policies.{shipping,returns,payment}`).

### KB Enrichment

When a comment/message arrives for a page linked to a Salla store:
1. Integration adapter checks `page.ecommerceStoreId` and verifies platform is `salla`
2. Calls `getEnrichedKnowledgeBase(existingKB, storeId)`
3. Appends product catalog summary to the knowledge base (max 8000 chars total)
4. AI generates reply with real product data

### Cache Invalidation

When products are synced, caches are invalidated in 3 steps:
1. Compute next `kbVersion` for all linked pages
2. Delete semantic cache rows for affected pages
3. Re-ingest KB + products via RAG (atomically activates the new `kbVersion`) — embeddings
   are reused from the active version for chunks whose text is unchanged, so an unchanged
   catalog costs no embedding calls

The exact-match reply cache is **not** flushed: its key carries `kbv:{kbActiveVersion}`, so
step 3 retires the linked pages' entries by rotation. Until 2026-08-22 step 2 was a
`SCAN`/`DEL` of `cache:ai_reply:*` across the whole fleet (the hashed key cannot be scoped to
one page) — removed under D-090.

### Security

- **Token encryption**: Access and refresh tokens encrypted at rest with AES-256-GCM
- **HMAC verification**: Webhooks verified via `X-Salla-Signature` header (hex digest, timing-safe)
- **Signed cookies**: OAuth nonce and pending install ID use signed, httpOnly cookies
- **CSRF protection**: OAuth state param validated against signed nonce cookie
- **Distributed locking**: Redis lock prevents single-use refresh token race conditions

---

## Billing — Article 5 (paid plans must go through Salla)

Salla's [apps policy](https://salla.partners/legal/apps-policy) **Article 5** requires paid-app
payment to run through Salla, with Salla's commission. Steering a Salla-sourced merchant to an
external rail risks delisting — and unpublishing a live Salla app is **not self-serve** (it needs
a booked meeting with Salla), so the downside cannot be undone by us.

Jawab24 ships on Salla **free-tier-only**, which is compliant on its own. The gap was that a
Salla merchant who exhausted the free quota still saw the product's normal upgrade CTAs, which
led to Stripe. The **Article-5 guard** (ruling **D-065**) closes it.

**The rule** — `services/sallaBilling.ts:mustBillThroughSalla`:

> bill through Salla when the account has an **active Salla store** AND no established live
> Stripe relationship.

- Store presence: `services/ecommerce.ts:hasActiveStoreForBillingSubject('salla', userId)`,
  resolved against the **billing subject** — the workspace owner (the D-E rule Shopify billing
  already follows) across every workspace they own, NOT the workspace being viewed. One
  subscription serves all of an owner's workspaces, so a per-workspace scope would let the UI
  offer an upgrade the API then refuses.
- Exemption: `config/sallaBilling.ts:hasLiveStripeBilling` — `payment_method='stripe'` AND
  status ∈ `LIVE_SUBSCRIPTION_STATUSES`. A merchant who signed up on jawab24.com and paid us
  through Stripe *before* connecting Salla was never a Salla-sourced sale and keeps their rail.
- ⚠️ **The payment-method check is not redundant.** A fresh signup is inserted
  `status='trialing'` with `payment_method` **NULL**. Exempting on status alone would exempt
  every user on the platform and the guard would silently never fire.

**Enforcement.** All six **merchant-facing** Stripe entry points go through
`rejectIfMarketplaceBilled` in `controllers/payment.ts` → **400 `SALLA_BILLED`**
(`create-checkout-session`, `create-subscription-intent`, `create-topup-intent`, `change-plan`,
`cancel-subscription`, `billing-portal`; the remaining payment routes are read-only or the
inbound webhook). Shopify's `SHOPIFY_BILLED` (D-G) is evaluated first and is unchanged; when
both rails apply to one account Shopify wins, because it has an admin deep link to send the
merchant to and Salla does not. A refusal is logged at `info` with `rail: 'salla'` — this
guard's characteristic failure is being silently inert, so a refusal count is the only
production signal that distinguishes working from broken.

⚠️ **NOT covered: the admin manual payment-request path.**
`services/admin/billing.ts:createPaymentRequest` → `stripeService.createManualPaymentSession`
mints a hosted Stripe Checkout link for an arbitrary user and consults **neither** marketplace
rule (this predates the Salla guard and is equally unguarded for Shopify/D-G). An admin issuing
one to a Salla merchant would be the exact Article-5 breach the guard exists to prevent. It is
admin-only and deliberate rather than a self-serve leak, so it is documented rather than
silently blocked — the manual rail is also the payment route for merchants Stripe cannot serve.
**Owner decision owed:** guard it, warn in the admin UI, or accept it as a staffed-process risk.

**UI suppression** reads the same answer from the single `getUsageSummary` choke point as
`subscription.sallaBilled`: plan select (`useSelectPlan`), the `/pricing` banner, the top-up CTA
(`BuyTopUpCTA`), and a `/pricing` bounce in `checkout.tsx`.

✅ **Salla-managed billing is IMPLEMENTED (2026-08-26, D-104)** — `services/sallaBilling.ts`,
mirroring the Zid rail (D-070). **Verify-first**: Salla documents a subscription-read endpoint,
`GET https://api.salla.dev/admin/v2/apps/{app_id}/subscriptions` (docs.salla.dev 5401098e0,
merchant token, `SALLA_APP_ID` required), so that API is the authority and the
`app.subscription.*` / `app.trial.*` deliveries are only TRIGGERS — they carry no state into the
database, they call the one idempotent choke point `syncSallaBilling(storeId)`. Four triggers:
the subscription/trial webhooks, the uninstall webhook (cancels the mirror — no paid local sub
outlives the app), the **post-claim hook** in `claimStoreHandler` (a merchant who subscribed
inside Salla before claiming had no store row when those webhooks arrived, so they drop — the
claim is the first moment a verify can land), and the 6-hourly `SallaBillingReconcile` cron,
the authority of last resort that makes a missed delivery a ≤6h delay. The mirror lands on
`subscriptions` with `payment_method='salla'` + `salla_store_id` (migration `0181`: partial
unique index over live rows + CHECK), and the Stripe suppression now fires on the mirror row
itself (`isSallaBilled`, exactly like Shopify's) with the store-presence heuristic kept as the
pre-subscription fallback.

**Four read kinds, not three (since #1052, 2026-09-04; deployed 2026-09-05):**
`subscription` · `none` · `unreadable` · **`endpoint_unavailable`**. The fourth is a **404** from
`GET /admin/v2/apps/{app_id}/subscriptions`, which `sallaApiGet` used to throw straight past the
classification — so every install of a store with no paid subscription raised a level-50 Sentry
error and counted as a reconciler `errors++`. It is now caught in `fetchSallaAppSubscription`
(`status === 404` only; every other non-2xx still rethrows), handled in `syncSallaBilling` beside
the `unreadable` guard and **before** the pause path, logged at info, and returns outcome
`endpoint_unavailable` with `changed:false`. Entitlement behaviour is byte-identical to the old
throw — both write nothing. ⛔ **It is deliberately NOT collapsed into `none`**: pre-publish a 404
cannot be distinguished between "no subscription resource" and "endpoint unavailable while the app
is in Development", and reading it as `none` would pause paying merchants the day after publish if
the second is the truth. Revisit once a paid subscription is observable (`SALLA_TEST_PLAN.md`
3.11.1). Proven on prod 2026-09-05: initial sweep `scanned=1, errors=0`, 404 line at `level:30`.

⚠️ **Two Salla-specific derivations, both [provisional] until the first live paid envelope:**
(1) the read carries **no `status` field** — entitlement is DERIVED from `end_date` (future =
entitled, past = inactive, missing/unparseable = `unknown_state`, which fails loud and writes
nothing); a null price on an entitled entry is read as the trial window. (2) base plans carry
**no plan id and a nullable `plan_name`** — mapping is name-first («الأعمال»/«الاحترافي»,
normalizeArabic-folded) with the D-103 ex-VAT price (146/296) as the fallback identity;
`plan_type: 'free'` is a known non-entitling shape (silent skip); anything else unmapped is
`unknown_plan`, fail-loud. Add-on entries (`item_type != 'plan'`) are never adopted as the base
plan. Coverage: `backend/test/services/sallaBilling.test.ts` + wiring in
`backend/test/controllers/salla.test.ts`.

---

## API Endpoints

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/salla/auth` | Start OAuth flow |
| GET | `/salla/auth/callback` | OAuth callback |
| POST | `/salla/webhooks` | All webhook events (dispatches by `event` field in body) |

### Protected (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/salla/store` | Get connected store info — response includes `webhookHealth: 'ok' \| 'pending' \| 'failed' \| 'unknown'` |
| GET | `/salla/capabilities` | `{ connectAvailable }` — whether this deployment can start a connect flow at all. The integrations page renders its connect/reconnect actions from this, so the UI can never offer what the API refuses |
| POST | `/salla/store/connect` | Start connection. Returns the App Store listing URL when Easy Mode + `SALLA_APP_STORE_URL` are set; the OAuth URL only when `SALLA_OAUTH_CONNECT_ENABLED=true` (Custom-Mode dev); otherwise **404 `SALLA_CONNECT_UNAVAILABLE`** |
| DELETE | `/salla/store` | Disconnect store |
| POST | `/salla/store/sync` | Trigger manual product sync |
| POST | `/salla/store/webhooks/reregister` | Manual webhook re-registration. Used by the integrations-card "Try again" button when `webhookHealth === 'failed'` (retry queue exhausted). Returns `{ ok, webhookStatus }`. Admin role required. Implementation is the shared `createReregisterHandler('salla')` factory in `controllers/ecommerceWebhooks.ts` |
| GET | `/salla/store/products` | List synced products |
| PATCH | `/salla/store/link-page` | Link store to a Facebook/Instagram page |
| PATCH | `/salla/store/unlink-page` | Unlink store from a page |

---

## Tests

| File | Tests | Coverage |
|------|-------|----------|
| `test/controllers/salla.test.ts` | 30+ | OAuth flow, webhooks, protected CRUD |
| `test/controllers/auth.salla-claim.test.ts` | 8+ | Pending install claim during Facebook login |
| `test/services/salla.test.ts` | 15+ | Service logic, token refresh, sync |
| `test/integrations/salla.test.ts` | 10+ | Integration adapter behavior |
