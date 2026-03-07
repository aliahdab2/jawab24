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
| Max products synced | 250 (5 pages x 50) | 260 (4 pages x 65) |
| Merchant ID | Not applicable | Stored in `platformData.merchantId` |

### Two Install Flows

1. **Logged-in user** (from Settings/Integrations page): OAuth -> store created immediately -> redirect to onboarding
2. **Salla-first** (from Salla App Store): OAuth -> pending install created (encrypted token) -> user logs in -> pending install claimed -> store created

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
| `src/pages/integrations.tsx` | Unified integrations page (Shopify + Salla) |
| `src/components/settings/EcommerceSection.tsx` | Platform-agnostic store info component |

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
4. Required scopes: `offline_access`, `products.read_write`, `settings.read`

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

### 3. Environment Variables

Add to `env/backend.env`:

```bash
# Salla App credentials (from Partners dashboard)
SALLA_CLIENT_ID=your_client_id
SALLA_CLIENT_SECRET=your_client_secret
SALLA_HOST_NAME=jawab24.com
SALLA_WEBHOOK_SECRET=your_webhook_secret

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
- Fetches up to 260 products (4 pages x 65 products)
- Maps Salla statuses: `sale` -> `active`, `out` -> `out_of_stock`, `hidden` -> `hidden`, `deleted` -> `archived`
- Strips HTML from product descriptions
- Builds variant summary from product options
- Generates text summary (`productSummary`) for AI context
- Retries on 429/5xx with exponential backoff (up to 3 retries)

### KB Enrichment

When a comment/message arrives for a page linked to a Salla store:
1. Integration adapter checks `page.ecommerceStoreId` and verifies platform is `salla`
2. Calls `getEnrichedKnowledgeBase(existingKB, storeId)`
3. Appends product catalog summary to the knowledge base (max 8000 chars total)
4. AI generates reply with real product data

### Cache Invalidation

When products are synced, caches are invalidated in 4 steps:
1. Compute next `kbVersion` for all linked pages
2. Flush Redis exact-match cache keys
3. Delete semantic cache rows for affected pages
4. Re-ingest KB + products via RAG (atomically activates new kbVersion)

### Security

- **Token encryption**: Access and refresh tokens encrypted at rest with AES-256-GCM
- **HMAC verification**: Webhooks verified via `X-Salla-Signature` header (hex digest, timing-safe)
- **Signed cookies**: OAuth nonce and pending install ID use signed, httpOnly cookies
- **CSRF protection**: OAuth state param validated against signed nonce cookie
- **Distributed locking**: Redis lock prevents single-use refresh token race conditions

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
| GET | `/salla/store` | Get connected store info |
| POST | `/salla/store/connect` | Start connection (returns OAuth URL) |
| DELETE | `/salla/store` | Disconnect store |
| POST | `/salla/store/sync` | Trigger manual product sync |
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
