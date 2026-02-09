# تكامل Shopify - Shopify Integration

## Overview

Shopify integration allows Jawab24 to enrich AI replies with real product data (prices, availability, variants) from a connected Shopify store. When a customer asks about a product on Facebook/Instagram, the AI can answer accurately using live catalog data.

### Architecture

```
Shopify App Store ─► OAuth Flow ─► Store Created ─► Product Sync (BullMQ Worker)
                                                          │
Facebook/Instagram Comment ─► Reply Pipeline ─► AI Generator ◄── Enriched KB
                                                                  (products + policies)
```

### Two Install Flows

1. **Logged-in user** (from Settings page): OAuth → store created immediately → redirect to onboarding
2. **Shopify-first** (from Shopify App Store): OAuth → pending install created (encrypted token) → user logs in → pending install claimed → store created

---

## Files

### Backend

| Layer | File | Description |
|-------|------|-------------|
| Route | `src/routes/shopify.ts` | Public (OAuth, webhooks, GDPR) + protected (store CRUD) routes |
| Controller | `src/controllers/shopify.ts` | Request handling, auth detection, HMAC verification |
| Service | `src/services/shopify.ts` | Core logic: OAuth, GraphQL API, product sync, KB enrichment |
| Service | `src/services/shopifyCrypto.ts` | AES-256-GCM encryption for Shopify access tokens |
| Service | `src/services/cookies.ts` | Cookie config for cross-site Shopify OAuth redirects |
| Queue | `src/lib/shopifySyncQueue.ts` | Singleton BullMQ queue for product sync jobs |
| Worker | `src/workers/shopifySyncWorker.ts` | Background worker that processes sync jobs |

### Frontend

| File | Description |
|------|-------------|
| `src/pages/shopify/onboarding.tsx` | 3-step onboarding wizard (sync → link page → done) |
| `src/pages/settings.tsx` | ShopifySection component (store info, sync, disconnect, link pages) |

### Database

| Table | Purpose |
|-------|---------|
| `shopify_stores` | Connected stores (domain, encrypted token, product summary, policies) |
| `shopify_products` | Synced product catalog (title, price range, variants, inventory) |
| `pending_shopify_installs` | Temporary records for Shopify-first install flow (30min TTL) |
| `pages.shopify_store_id` | FK linking a Facebook/Instagram page to a Shopify store |
| `plans.shopify_enabled` | Feature flag per pricing plan |

### Migrations

| File | What it creates |
|------|-----------------|
| `0013_optimal_wildside.sql` | `shopify_stores`, `shopify_products` tables + `pages.shopify_store_id` column |
| `0014_naive_captain_britain.sql` | `pending_shopify_installs` table + FK/index on `pages.shopify_store_id` |

---

## Setup

### 1. Create Shopify App

1. Go to [Shopify Partners](https://partners.shopify.com/)
2. Create a new app (Custom app or Public app)
3. Set the App URL to `https://jawab24.com/shopify/auth`
4. Set the Allowed redirection URL to `https://jawab24.com/shopify/auth/callback`
5. Required scopes: `read_products`, `read_content`

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

# Encryption key for Shopify access tokens at rest (generate with: openssl rand -hex 32)
SHOPIFY_TOKEN_ENCRYPTION_KEY=your_64_char_hex_string
```

---

## How It Works

### OAuth Flow

1. User clicks "Install" on Shopify App Store (or connects from Settings)
2. Redirect to `GET /shopify/auth?shop=store.myshopify.com`
3. Server generates cryptographic nonce, sets signed cookie, redirects to Shopify OAuth
4. Shopify redirects back to `GET /shopify/auth/callback?shop=...&code=...&state=...`
5. Server validates nonce (signed cookie vs state param), exchanges code for access token
6. **If logged in**: Creates store directly, enqueues sync, redirects to onboarding
7. **If not logged in**: Encrypts token, creates pending install, sets cookie, redirects to login

### Product Sync

- Triggered on: store creation, manual sync, `products/update` webhook
- Uses Shopify GraphQL Admin API (`2024-10`)
- Fetches up to 250 products (5 pages x 50 products)
- Syncs: shop info, products (title, price, variants, inventory), shipping/refund policies
- Generates a text summary (`productSummary`, `policiesSummary`) for AI context
- Retries on 429/5xx with exponential backoff (up to 3 retries)

### KB Enrichment

When a comment/message arrives for a page linked to a Shopify store:
1. `commentProcessor` / `messageProcessor` checks `page.shopifyStoreId`
2. Calls `getEnrichedKnowledgeBase(existingKB, storeId)`
3. Appends product catalog summary + policies to the knowledge base
4. AI generates reply with real product data

### Security

- **Token encryption**: Shopify access tokens encrypted at rest with AES-256-GCM
- **HMAC verification**: All Shopify webhooks verified via `X-Shopify-Hmac-SHA256`
- **Signed cookies**: OAuth nonce and pending install ID use signed, httpOnly cookies
- **CSRF protection**: OAuth state param validated against signed nonce cookie
- **Input validation**: Shop domain regex validated on all entry points

---

## API Endpoints

### Public (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/shopify/auth` | Start OAuth flow |
| GET | `/shopify/auth/callback` | OAuth callback |
| POST | `/shopify/webhooks/uninstall` | App uninstalled webhook |
| POST | `/shopify/webhooks/products-update` | Product updated webhook |
| POST | `/shopify/gdpr/customers/data_request` | GDPR data request |
| POST | `/shopify/gdpr/customers/redact` | GDPR customer redact |
| POST | `/shopify/gdpr/shop/redact` | GDPR shop redact |

### Protected (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/shopify/store` | Get connected store info |
| POST | `/shopify/store/connect` | Start connection (returns OAuth URL) |
| DELETE | `/shopify/store` | Disconnect store |
| POST | `/shopify/store/sync` | Trigger manual product sync |
| GET | `/shopify/store/products` | List synced products |
| PATCH | `/shopify/store/link-page` | Link store to a Facebook/Instagram page |

---

## Tests

| File | Tests | Coverage |
|------|-------|----------|
| `test/controllers/shopify.test.ts` | 33 | OAuth flow, webhooks, GDPR, protected CRUD |
| `test/controllers/auth.shopify-claim.test.ts` | 8 | Pending install claim during Facebook login |
| `test/routes/shopify.test.ts` | 2 | Route registration |
| `test/services/shopify.test.ts` | 25 | Service logic, sync, KB enrichment |
| `test/services/shopifyCrypto.test.ts` | 11 | AES-256-GCM encrypt/decrypt, tamper detection |
| `test/services/shopifyPendingInstall.test.ts` | 9 | Pending install CRUD, expiry, cleanup |

**Total: 88 Shopify-specific tests**
