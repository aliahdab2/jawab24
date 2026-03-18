# External Integrations

## Social Media APIs

### Facebook / Instagram (Meta)
- **Purpose**: Primary platform for auto-reply automation
- **API Version**: Graph API v18.0 (configurable in environment)
- **OAuth Flow**:
  - User connects via Facebook Login
  - App requests scopes: `pages_messaging`, `pages_manage_metadata`, `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`
  - Access token stored encrypted (AES-256-GCM) in database
  - Token refresh: on-demand via `/refresh-token` endpoint

- **Webhook Setup** (for incoming messages/comments):
  - Endpoint: `/webhook` (POST)
  - Verification: X-Hub-Signature-256 header (HMAC-SHA256)
  - Signature Key: `FACEBOOK_WEBHOOK_VERIFY_TOKEN` + `FACEBOOK_APP_SECRET`
  - Events Subscribed:
    - `messages` - incoming DMs to pages/Instagram
    - `messaging_postbacks` - button clicks
    - `feed` - post/comment activity (comments/likes/replies)
    - `message_deliveries` - delivery confirmation
    - `message_reads` - read receipts

- **Key Endpoints Used**:
  - `/me/pages` - list connected pages
  - `/me/instagram_accounts` - list connected Instagram accounts
  - `/{page_id}/messages` - send replies
  - `/{page_id}/feed` - comment on posts
  - `/{comment_id}` - reply to comments

- **Configuration**:
  - `FACEBOOK_APP_ID` - App identifier (public)
  - `FACEBOOK_APP_SECRET` - OAuth secret (private)
  - `FACEBOOK_REDIRECT_URI` - OAuth callback URL
  - `FACEBOOK_WEBHOOK_VERIFY_TOKEN` - Webhook signature verification
  - `FACEBOOK_TOKEN_ENCRYPTION_KEY` - Token storage encryption
  - `FACEBOOK_GRAPH_API_VERSION` - API version (v18.0 default)

- **Implementation Location**:
  - Service: `/backend/src/services/facebook.ts`
  - Controller: `/backend/src/controllers/webhook.ts`
  - Routes: `/backend/src/routes/webhook.ts`

---

## E-Commerce Platforms

### Shopify
- **Purpose**: Sync product catalog, enrich AI knowledge base with product details
- **Integration Type**: OAuth 2.0 + REST API
- **OAuth Flow**:
  - User enters store domain (e.g., `shop.myshopify.com`)
  - Redirect to Shopify authorization endpoint
  - Request scopes: `read_products`, `read_content`, `read_orders`, `read_fulfillments`, `read_inventory`
  - Access token received (no expiration for custom apps)
  - Token encrypted (AES-256-GCM) and stored in database

- **API Endpoints Used**:
  - `/admin/api/2024-01/products.json` - list/fetch products
  - `/admin/api/2024-01/orders.json` - order history
  - `/admin/api/2024-01/inventory_levels.json` - stock info
  - `/admin/api/2024-01/product_variants.json` - variant details

- **Webhook Integration**:
  - Endpoint: `/shopify/webhooks` (POST)
  - Events: `products/update`, `inventory_levels/update`
  - Verification: HMAC-SHA256 signature in `X-Shopify-Hmac-SHA256` header
  - Signature Key: Shopify API secret

- **Background Worker**:
  - `ecommerceSyncWorker` - syncs products on interval
  - Triggers KB enrichment when changes detected
  - Location: `/backend/src/workers/ecommerceSyncWorker.ts`

- **Knowledge Base Enrichment**:
  - Fetches product list for page's linked store
  - Formats products as markdown (name, description, price, variants)
  - Appended to system prompt for reply generation
  - Caching: Cached in Redis to avoid repeated API calls

- **Configuration**:
  - `SHOPIFY_API_KEY` - OAuth app key
  - `SHOPIFY_API_SECRET` - OAuth secret
  - `SHOPIFY_HOST_NAME` - Redirect URL (production: jawab24.com, local: ngrok URL)
  - `SHOPIFY_TOKEN_ENCRYPTION_KEY` - Token encryption (AES-256-GCM)

- **Implementation Location**:
  - Integration: `/backend/src/integrations/shopify.ts`
  - Service: `/backend/src/services/shopify.ts`
  - Routes: `/backend/src/routes/shopify.ts`
  - Crypto: `/backend/src/services/shopifyCrypto.ts`

- **DB Tables**:
  - `ecommerce_stores` - store info + encrypted token
  - `ecommerce_products` - product cache
  - `ecommerce_store_pages` - page ↔ store linking

---

### Salla
- **Purpose**: Sync product catalog, enrich AI knowledge base (Middle East e-commerce platform)
- **Integration Type**: OAuth 2.0 + REST API
- **OAuth Flow**:
  - User enters Salla store domain
  - Redirect to Salla authorization
  - Request scopes: `offline_access`, `products.read_write`, `settings.read`, `webhooks.read_write`, `orders.read_write`
  - Access token (and refresh token for long-lived auth)

- **API Endpoints Used**:
  - `/products` - list products
  - `/orders` - order data
  - `/merchants/profile` - store info

- **Webhook Integration**:
  - Endpoint: `/salla/webhooks` (POST)
  - Events: `product.added`, `product.updated`, `product.deleted`
  - Verification: HMAC-SHA256 signature in `X-Salla-Signature` header

- **Configuration**:
  - `SALLA_CLIENT_ID` - OAuth app ID
  - `SALLA_CLIENT_SECRET` - OAuth secret
  - `SALLA_HOST_NAME` - Redirect URL
  - `SALLA_WEBHOOK_SECRET` - Webhook signature key

- **Implementation Location**:
  - Integration: `/backend/src/integrations/salla.ts`
  - Service: `/backend/src/services/salla.ts`
  - Routes: `/backend/src/routes/salla.ts`

---

### Zid (Placeholder)
- **Status**: Configuration defined but not fully integrated
- **Purpose**: Saudi Arabia e-commerce platform (future integration)
- **Configuration**:
  - `ZID_CLIENT_ID` - OAuth app ID
  - `ZID_CLIENT_SECRET` - OAuth secret
- **Implementation Location**: `/backend/src/integrations/zid.ts` (stub)

---

## AI/LLM Services

### OpenAI (Primary LLM)
- **Purpose**: Generate smart replies to customer messages
- **Model**: gpt-4.1-mini (fixed for cost efficiency, not user-configurable)
- **SDK**: OpenAI SDK 6.27.0 (pinned exact version)
- **API Key**: `OPENAI_API_KEY`
- **Usage Pattern**:
  - System prompt with reply style, e-commerce context, and KB
  - User message from customer
  - Structured JSON response: `{ confidence, intent, reply, flags }`
  - Temperature: 0.3 (consistent, less random)
  - Max tokens: 300

- **Response Format**: Strict JSON schema (GPT enforced)
  ```json
  {
    "confidence": "high|medium|low",
    "intent": "PURCHASE_INTENT|FAQ|FEEDBACK|COMPLAINT|OTHER",
    "reply": "...",
    "flags": { "angry_customer": false, "needs_escalation": false }
  }
  ```

- **Caching**:
  - Semantic cache: Skip generation for similar requests
  - Exact cache: Full response memoization for identical requests
  - Cache key includes: KB version, reply style, customer context
  - Scoped by workspace + page

- **Error Handling**:
  - Circuit breaker: Stop calls after 5 consecutive failures (30s cool-off)
  - Fallback: Claude Haiku when OpenAI unavailable
  - Timeout: 30 seconds per request

- **Configuration**:
  - Shared between backend (embeddings) and ai-worker (replies)
  - Both must use same version (sync checked by `npm run check:openai-sync`)

- **Implementation Location**:
  - AI Worker: `/ai-worker/src/services/providers/openai-adapter.ts`
  - Backend KB: `/backend/src/services/kb/embedding.ts`

---

### Anthropic (Claude - Fallback/Playground)
- **Purpose**: Fallback LLM when OpenAI unavailable, playground testing
- **SDK**: Anthropic SDK 0.78.0
- **Models Available**: Claude 3.5 Sonnet, Claude 3 Haiku (configurable)
- **API Key**: `ANTHROPIC_API_KEY` (optional, only needed for Claude fallback)
- **Usage Pattern**:
  - Fallback when OpenAI circuit breaker is open
  - Playground: Users can test different models
  - Same JSON schema response format as OpenAI

- **Configuration**:
  - `ANTHROPIC_API_KEY` - Claude API key (optional)

- **Implementation Location**:
  - Adapter: `/ai-worker/src/services/providers/claude-adapter.ts`
  - Provider Registry: `/ai-worker/src/services/providers/index.ts`

---

## Payment Processing

### Stripe
- **Purpose**: Subscription billing, checkout, invoicing
- **Integration Type**: REST API + Webhooks
- **SDK**: Stripe 14.11.0
- **API Key**: `STRIPE_SECRET_KEY` (private), `STRIPE_PUBLISHABLE_KEY` (frontend)

- **Checkout Flow**:
  1. User clicks "Upgrade to Plan"
  2. Backend creates checkout session via `/payment/create-checkout-session`
  3. Frontend redirects to Stripe-hosted checkout
  4. Webhook at `/webhook` receives `checkout.session.completed`
  5. Backend creates subscription record in DB
  6. User granted plan features

- **Webhook Events**:
  - `checkout.session.completed` - subscription started
  - `customer.subscription.updated` - plan changed
  - `customer.subscription.deleted` - canceled
  - `invoice.payment_succeeded` - payment confirmed
  - `invoice.payment_failed` - payment failed

- **Verification**:
  - Signature via `X-Stripe-Signature` header
  - HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`
  - Endpoint secret: webhook_secret_from_dashboard

- **Sanctions Check**:
  - **CRITICAL**: Before creating checkout session, verify user geolocation
  - Blocked regions: Cuba, Iran, North Korea, Syria, Crimea, etc.
  - Check performed in `/backend/src/controllers/payment.ts` before Stripe API call
  - Returns 403 if sanctioned jurisdiction detected

- **Subscription Management**:
  - Plans stored in DB: `plans` table
  - Subscriptions: `subscriptions` table
  - Trial periods: Configurable per plan (0 for no trial)
  - Renewal: Automatic on Stripe (every 30 days, annually, etc.)
  - Cancellation: Handled via subscription.canceled webhook

- **Configuration**:
  - `STRIPE_SECRET_KEY` - API secret key
  - `STRIPE_PUBLISHABLE_KEY` - Frontend key
  - `STRIPE_WEBHOOK_SECRET` - Webhook endpoint secret

- **Implementation Location**:
  - Service: `/backend/src/services/stripe.ts`
  - Controller: `/backend/src/controllers/payment.ts`
  - Routes: `/backend/src/routes/payment.ts`
  - Webhook Handler: `/backend/src/controllers/webhook.ts` (Stripe webhook processing)

---

## Infrastructure Services

### PostgreSQL Database
- **Purpose**: Primary data store for users, pages, messages, settings, analytics
- **Version**: 15 with pgvector extension
- **Connection**: Native postgres driver (not pg)
- **Connection String**: `postgresql://user:pass@host:5432/jawab24`
- **Configuration**:
  - Migrations auto-run on Docker startup
  - Health check: `pg_isready` command

- **Key Tables**:
  - `users` - user accounts
  - `workspaces` - team workspaces
  - `pages` - Facebook/Instagram pages
  - `messages` - incoming messages
  - `comments` - post comments
  - `templates` - user-created reply templates
  - `subscriptions` - stripe subscriptions
  - `ecommerce_stores` - Shopify/Salla integration
  - `ecommerce_products` - product cache
  - `kb_documents` - knowledge base documents
  - `kb_embeddings` - vector embeddings (pgvector)

- **Backup**: Via Docker volume `postgres-data` (production: managed by DevOps)

---

### Redis Cache
- **Purpose**: Session storage, job queue (BullMQ), rate limiting, caching
- **Version**: 7-alpine
- **Port**: 6379
- **Configuration**:
  - `REDIS_HOST` - hostname
  - `REDIS_PORT` - port
  - `REDIS_PASSWORD` - auth password (required in production)
  - `maxmemory: 256mb` - memory limit
  - `maxmemory-policy: noeviction` - don't evict on overflow
  - `appendonly: yes` - persistence enabled

- **Uses**:
  - **Sessions**: JWT + user context (short-lived TTL)
  - **Job Queue (BullMQ)**:
    - `ai:pending` - AI reply generation jobs
    - `comments:pending` - comment reply jobs
    - `messages:pending` - message reply jobs
  - **Rate Limiting**: Per-IP request counters
  - **Semantic Cache**: AI response caching (by KB + style)
  - **KB Enrichment Cache**: Product data from e-commerce

- **Persistence**: RDB (dump.rdb) via `appendonly yes`
- **Cleanup**: Automatic via worker intervals (expired installs, etc.)

- **Implementation Location**:
  - Client: `/backend/src/lib/redis.ts`
  - Queue Manager: `/backend/src/lib/replyQueue.ts`
  - BullMQ Setup: Throughout `/backend/src/workers/`

---

### Firebase Cloud Messaging
- **Purpose**: Push notifications to mobile app
- **SDK**: Firebase Admin SDK 13.6.1
- **Authentication**: Service account JSON (from Firebase Console)
- **API Key**: Stored securely in environment (path to JSON file)

- **Notification Types**:
  - Angry customer detected
  - Low confidence reply (requires manual review)
  - New message in thread
  - Subscription reminder

- **Configuration**:
  - Service account JSON file (Firebase Console → Service Accounts)
  - Project ID from Firebase config

- **Implementation Location**:
  - Service: `/backend/src/services/notifications.ts`
  - Triggers: Throughout message/comment processing logic

---

## Authentication & Token Management

### JWT (JSON Web Tokens)
- **Purpose**: Stateless authentication for API requests
- **Algorithm**: HS256 (HMAC-SHA256)
- **Secret**: `JWT_SECRET` (minimum 32 chars)
- **Expiration**: `JWT_EXPIRES_IN` (default: 7 days)
- **Payload**: `{ userId, facebookId, iat, exp }`
- **Storage (Frontend)**: Secure storage via Capacitor (not cookies in mobile)
- **Transmission**: Authorization header: `Bearer <token>`

- **Token Encryption**:
  - Tokens stored in Capacitor secure storage (encrypted by OS)
  - No plaintext storage in browser localStorage

- **Implementation Location**:
  - Issuer: `/backend/src/services/auth.ts`
  - Middleware: `/backend/src/middleware/auth.ts`
  - Verification: Fastify hook on protected routes

---

### Facebook OAuth 2.0
- **Purpose**: User signup/login via Facebook
- **Flow**:
  1. Frontend opens Facebook Login dialog
  2. User approves scopes
  3. Frontend receives code + receives userID via Facebook SDK
  4. Frontend sends code to backend `/auth/facebook`
  5. Backend exchanges code for access token
  6. Backend verifies token authenticity (app_id check)
  7. Backend issues JWT
  8. Frontend stores JWT in secure storage

- **Scopes Requested** (via OAuth):
  - `pages_messaging` - send/read DMs
  - `pages_manage_metadata` - modify page settings
  - `instagram_basic` - Instagram access
  - `instagram_manage_comments` - reply to comments
  - `instagram_manage_messages` - Instagram DMs

- **Token Verification**:
  - Debug endpoint: `/debug_token` (Graph API)
  - Check `is_valid`, `app_id`, `user_id`, `expires_at`, `scopes`
  - Error if token issued to different app (security check)

- **Encryption**:
  - Access tokens encrypted AES-256-GCM before storage
  - Encryption key: `FACEBOOK_TOKEN_ENCRYPTION_KEY`
  - IV stored alongside ciphertext

- **Implementation Location**:
  - Service: `/backend/src/services/facebook.ts`
  - Controller: `/backend/src/controllers/auth.ts`
  - Routes: `/backend/src/routes/auth.ts`

---

## Error Tracking & Monitoring

### Sentry
- **Purpose**: Real-time error tracking, performance monitoring, session replay
- **SDK**: @sentry/node (backend/ai-worker), @sentry/nextjs (frontend)
- **DSN**: Environment-specific (production, staging, development)
- **Performance Monitoring**:
  - Transaction sampling rate (configurable)
  - Traces: AI generation duration, API response time, DB queries
  - Profiling: CPU/memory usage

- **Error Context**:
  - Request ID propagation (X-Request-ID header)
  - User ID (from JWT)
  - Workspace ID
  - Custom tags: page, action, integration

- **Configuration**:
  - `SENTRY_DSN` - Data source name (connection string)
  - Environment: inferred from NODE_ENV
  - Release: Git commit hash (from Docker build)

- **Implementation Location**:
  - Frontend: `/frontend/sentry.client.config.ts`, `/frontend/sentry.server.config.ts`
  - Backend: `/backend/src/lib/sentry.ts`
  - AI Worker: `/ai-worker/src/lib/sentry.ts`
  - Helper: `/backend/src/utils/sentryHelpers.ts` (error capture function)

---

## Integration Map

| Service | Purpose | Config Location | Status |
|---------|---------|-----------------|--------|
| Facebook Graph API | OAuth + webhooks for messages | `FACEBOOK_*` env vars | ✅ Production |
| Instagram API | Comments + DM auto-replies | `FACEBOOK_*` env vars | ✅ Production |
| Shopify | Product sync + KB enrichment | `SHOPIFY_*` env vars | ✅ Production |
| Salla | Product sync (Middle East) | `SALLA_*` env vars | ✅ Production |
| Zid | e-commerce (Saudi) | `ZID_*` env vars | ⏳ Planned |
| OpenAI | Smart reply generation | `OPENAI_API_KEY` | ✅ Production |
| Anthropic Claude | Fallback LLM + playground | `ANTHROPIC_API_KEY` | ✅ Fallback only |
| Stripe | Subscription payments | `STRIPE_*` env vars | ✅ Production |
| Firebase | Push notifications | Service account JSON | ✅ Production |
| PostgreSQL | Primary database | `DATABASE_URL` | ✅ Production |
| Redis | Cache + job queue | `REDIS_*` env vars | ✅ Production |
| Sentry | Error tracking | `SENTRY_DSN` | ✅ Production |
| Geoip-lite | User geolocation | (npm package) | ✅ Production |

---

## Webhook Security

### Signature Verification Strategy
All webhooks use HMAC-SHA256 signature verification:

1. **Facebook/Instagram Webhooks**:
   - Header: `X-Hub-Signature-256`
   - Format: `sha256=<hex>`
   - Secret: `FACEBOOK_APP_SECRET`
   - Timing-safe comparison to prevent timing attacks

2. **Shopify Webhooks**:
   - Header: `X-Shopify-Hmac-SHA256`
   - Format: Base64-encoded
   - Secret: `SHOPIFY_API_SECRET`

3. **Salla Webhooks**:
   - Header: `X-Salla-Signature`
   - Format: Hex-encoded
   - Secret: `SALLA_WEBHOOK_SECRET`

4. **Stripe Webhooks**:
   - Header: `X-Stripe-Signature`
   - Format: `t=timestamp,v1=signature`
   - Secret: `STRIPE_WEBHOOK_SECRET`

### Implementation
- Raw body preserved for signature verification (via Fastify custom JSON parser)
- Timing-safe buffer comparison (prevents timing-based attacks)
- Replay attack prevention: Check event timestamps against request time
- Rate limiting: Per-IP + per-event rate limits

---

## Rate Limiting & Throttling

- **Framework**: @fastify/rate-limit
- **Per-IP Limit**: 100 requests per 15 minutes
- **AI Endpoint**: Special tier (higher limit to avoid user throttling)
- **Webhook Endpoints**: No limit (trusted sources with signature verification)
- **Redis Backend**: Rate limit counters stored in Redis

---

## Data Encryption

### In Transit
- **HTTPS**: All external APIs use HTTPS (enforced)
- **TLS 1.3**: Minimum for production

### At Rest
- **Token Storage (Facebook, Shopify)**:
  - Algorithm: AES-256-GCM (Galois/Counter Mode)
  - IV: Random 16 bytes, stored with ciphertext
  - Auth Tag: Appended to ciphertext for integrity verification
  - Key derivation: SHA-256 hash of environment key (32 bytes)

- **Secure Storage (Mobile)**:
  - Capacitor secure storage plugin
  - Uses native keychain (iOS) and KeyStore (Android)
  - Automatic OS-level encryption

---

## API Rate Limiting (External Services)

| Service | Limit | Window | Strategy |
|---------|-------|--------|----------|
| Facebook Graph | 200 calls/hour (per token) | Rolling | Cached requests, batch where possible |
| Shopify REST API | 40 req/sec (leaky bucket) | Sliding | BullMQ job queue with concurrency control |
| Salla | 100 req/min | Rolling | Exponential backoff on 429 |
| OpenAI | 500k tokens/min | Rolling | Handled by SDK, errors trigger fallback |
| Stripe | 100 req/sec | Sliding | Automatic retry with jitter |

---

## Integration Testing

- **E2E Test Commands**:
  - Shopify: `npm run test:ecommerce:shopify` (requires running backend + demo store)
  - Salla: `npm run test:ecommerce:salla` (requires running backend + store)
  - Both: `npm run test:ecommerce` (tests both platforms)

- **Location**: `/scripts/ecommerce-integration-test.ts`
- **Coverage**: Store connect, sync, products, KB enrichment, page linking

---

## Environment Validation

- **Function**: `/backend/src/utils/env.ts` - `validateEnv()`
- **Timing**: Runs on backend startup
- **Checks**:
  - Required variables present (JWT_SECRET, DATABASE_URL, etc.)
  - Variable formats valid (URLs, API keys, encryption keys)
  - Mutual dependencies (if using Shopify, must have SHOPIFY_API_KEY + SECRET)
  - Fails hard if validation fails (process.exit(1))

