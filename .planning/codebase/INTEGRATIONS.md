# External Integrations

## Social Media APIs

### Facebook / Instagram (Meta)
- **Purpose**: Primary platform for auto-reply automation
- **API Version**: Graph API v18.0 (configurable in environment)
- **App Status**: **Live mode** (approved 2026-03-21, App ID: 774211662298446)

- **OAuth Flow**:
  - User connects via Facebook Login
  - Access token stored encrypted (AES-256-GCM) in database
  - Token refresh: on-demand via `/refresh-token` endpoint

- **Meta App Review — Permission Status**:
  - ✅ `pages_messaging` — Approved (2026-03-21) — send/receive Messenger DMs
  - ✅ `pages_manage_metadata` — Approved (2026-03-21) — webhook subscription for pages
  - ✅ `pages_show_list` — Approved (2026-03-21) — list user's pages in dashboard
  - ✅ `public_profile`, `email` — Always approved
  - 🔄 `pages_read_engagement` — Pending submission — read comments (feed webhooks)
  - 🔄 `pages_manage_engagement` — Pending submission — reply to comments
  - ⏳ `instagram_basic`, `instagram_business_basic` — Deferred (needs IG Business account demo)
  - ⏳ `instagram_manage_comments` — Deferred (needs IG Business account demo)
  - ⏳ `instagram_manage_messages`, `instagram_business_manage_messages` — Deferred

- **Webhook Setup** (for incoming messages/comments):
  - Endpoint: `/webhook` (POST)
  - Verification: X-Hub-Signature-256 header (HMAC-SHA256)
  - Signature Key: `FACEBOOK_WEBHOOK_VERIFY_TOKEN` + `FACEBOOK_APP_SECRET`
  - Events Subscribed:
    - `messages` - incoming DMs to pages/Instagram
    - `messaging_postbacks` - button clicks
    - `feed` - post/comment activity — **active in Live mode** (was blocked in dev mode)
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

### Zid
- **Status**: Fully implemented, production-ready
- **Purpose**: Saudi Arabia e-commerce platform — product sync + KB enrichment + AI agent tools
- **Auth Flow**: OAuth2 (same pattern as Salla — redirect flow, no domain input required)
- **Token Auth**: `X-MANAGER-TOKEN` header (not `Authorization: Bearer`)
- **Token Expiry**: ~1 year; refresh uses Redis distributed lock (single-use safety)
- **Configuration**:
  - `ZID_CLIENT_ID` - OAuth app ID
  - `ZID_CLIENT_SECRET` - OAuth secret
  - `ZID_HOST_NAME` - App hostname for redirect URI
  - `ZID_WEBHOOK_SECRET` - HMAC secret for webhook verification
  - `ZID_SCOPES` - Comma-separated OAuth scopes
- **Implementation**:
  - Integration: `/backend/src/integrations/zid.ts`
  - Service: `/backend/src/services/zid.ts`
  - Controller: `/backend/src/controllers/zid.ts`
  - Routes: `/backend/src/routes/zid.ts`
- **Webhook**: `POST /zid/webhooks` — HMAC-verified (SHA256 hex, `X-ZID-SIGNATURE`); handles `app.uninstalled` + product events; resolves store by domain OR `platformData.merchantId` (JSONB fallback)
- **AI Agent Tools**: `lookupOrder`, `getShipmentTracking`, `checkInventory` via `ecommerceActions.ts`

---

### KB File Upload

Text extraction from documents and images for KB content:

- **Endpoint**: `POST /kb/extract-text` (`backend/src/routes/kb-upload.ts`)
- **Extractor**: `backend/src/services/kb/file-extractor.ts`
- **Formats**: PDF (pdf-parse v2), Word/docx (mammoth), images (GPT-4o-mini Vision)
- **Limits**: 5MB file, 5 PDF pages, 16K char output
- **Plan gating**: PDF/Word free for all; images/scanned PDFs require Business+ plan
- **Daily quota**: Business 10/day, Pro 25/day (Redis counter `vision_extract:{userId}:{date}`)
- **Frontend**: `FileUploadButton.tsx` (paperclip icon next to mic in KB sections + onboarding)

### KB Voice Input

Voice-to-text for KB content via microphone:

- **Endpoint**: `POST /voice/transcribe` (`backend/src/routes/voice.ts`)
- **Service**: `backend/src/services/transcription.ts`
- **Model**: gpt-4o-mini-transcribe (89% fewer hallucinations vs whisper-1)
- **Frontend**: `VoiceRecordButton.tsx` (mic icon in KB sections + onboarding)

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
    "intent": "QUESTION|COMPLIMENT|COMPLAINT|PURCHASE_INTENT|GREETING|BUSINESS_INQUIRY|OFFENSIVE|SPAM_OR_IRRELEVANT",
    "reply": "...",
    "flags": { "angry_customer": false, "needs_escalation": false }
  }
  ```
  Source of truth: `ai-worker/src/services/openai.ts` (enum) + `ai-worker/src/services/providers/types.ts`

- **Caching**:
  - Semantic cache: Skip generation for similar requests
  - Exact cache: Full response memoization for identical requests
  - Cache key includes: KB version, reply style, customer context
  - Scoped by workspace + page

- **Error Handling**:
  - Circuit breaker: Stop calls after 5 consecutive failures (30s cool-off) — Redis-backed (`lib/circuitBreaker.ts`)
  - **Fallback chain** (3 tiers):
    1. **Tier 1 (normal)**: OpenAI via ai-worker
    2. **Tier 2 (circuit open)**: Claude Haiku via ai-worker `/generate?model=claude-haiku-*` — bypasses circuit, different API key
    3. **Tier 3 (both fail)**: Static "Thank you for your comment!" reply + lightweight keyword classifier (`classifyFallback()`) for intent/confidence
  - Fallback model configurable via `AI_FALLBACK_MODEL` env (default: `claude-haiku-4-5-20251001`)
  - Timeout: 30 seconds per request

- **Configuration**:
  - Shared between backend (embeddings) and ai-worker (replies)
  - Both must use same version (sync checked by `npm run check:openai-sync`)

- **Implementation Location**:
  - AI Worker: `/ai-worker/src/services/providers/openai-adapter.ts`
  - Backend KB: `/backend/src/services/kb/embedding.ts`

---

### Anthropic (Claude - Tier-2 Failover / Playground)
- **Purpose**: Tier-2 failover LLM when OpenAI circuit breaker opens, plus playground testing
- **SDK**: Anthropic SDK 0.78.0
- **Models Available**: `claude-haiku-4-5-20251001` (default failover), `claude-sonnet-4-20250514` (configurable)
- **API Key**: `ANTHROPIC_API_KEY` (required for failover; optional for playground-only use)
- **Usage Pattern**:
  - **Failover (production)**: When `aiWorkerCircuit` opens (5 consecutive OpenAI failures), backend calls ai-worker `/generate?model=claude-haiku-*` directly (bypassing circuit). Uses `AI_FALLBACK_MODEL` env to select model.
  - **Playground**: Admins can compare model outputs side-by-side
  - Same JSON schema response format as OpenAI; `provider_failover` flag added to response

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

- **Checkout Flows** (two paths):
  1. **Embedded Checkout** (primary for new subscriptions):
     - Backend creates checkout session via `POST /payment/create-checkout-session`
     - Returns `clientSecret` for Stripe Embedded Checkout component in frontend
     - Frontend renders inline Stripe Embedded Checkout (no redirect to Stripe-hosted page)
     - Supports monthly + yearly billing intervals
     - After completion, frontend polls `GET /payment/checkout-session/:sessionId` for status
  2. **PaymentElement** (subscription creation path):
     - `POST /payment/create-subscription` → returns `clientSecret` for PaymentElement
  3. **Billing Portal** (plan changes, cancellation, invoices):
     - `POST /payment/billing-portal` → redirects user to Stripe Billing Portal
     - Sanctions check applied before portal creation
  4. Webhook at `/webhook` receives `checkout.session.completed` → subscription record created

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
- **Algorithm**: HMAC-SHA256 (custom implementation, RFC 7519 compliant)
- **Secret**: `JWT_SECRET` (minimum 32 chars)
- **Access token expiry**: 15 minutes
- **Refresh token expiry**: 60 days (database-stored, rotated on use)
- **Payload**: `{ userId, isAdmin, exp }` — exp is Unix timestamp in **seconds** per RFC 7519
- **Storage (Web)**: HttpOnly + Secure + SameSite:strict cookies (no localStorage)
- **Storage (Mobile)**: Bearer token in Capacitor secure storage

- **Implementation Location**:
  - Issuer: `/backend/src/services/auth.ts`
  - Middleware: `/backend/src/middleware/auth.ts`
  - Cookies: `/backend/src/services/cookies.ts`
  - Refresh: `/backend/src/services/refreshToken.ts`

---

### Phone OTP Authentication
- **Purpose**: Primary login method — universal identity not tied to any platform
- **Flow**: Phone (E.164) → 6-digit OTP via SMS → bcrypt verify → JWT + refresh token
- **OTP storage**: `otpCodes` table — bcrypt-hashed, 5-min expiry, max 3 attempts
- **Rate limiting**: 1 OTP per phone per 60s (store-level) + 3 requests/10min (route-level)
- **Timing attack protection**: dummy bcrypt compare when no OTP record exists
- **Feature flag**: `PHONE_AUTH_ENABLED=true` — routes hidden until flag is on
- **SMS delivery**: Vonage SMS API (see Vonage SMS below)
- **Phone linking**: `POST /auth/phone/link` (authenticated) — links phone to existing Facebook users

- **Implementation Location**:
  - OTP lifecycle: `/backend/src/services/otp.ts`
  - Controller: `/backend/src/controllers/auth.ts` (`requestOtp`, `verifyOtp`, `linkPhone`)
  - Routes: `/backend/src/routes/auth.ts`
  - Frontend components: `/frontend/src/components/auth/PhoneInput.tsx`, `OtpInput.tsx`
  - Frontend pages: `/frontend/src/pages/login.tsx`, `/frontend/src/pages/auth/phone-collect.tsx`

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
  - `pages_messaging` - send/read DMs ✅ approved
  - `pages_manage_metadata` - webhook subscription ✅ approved
  - `pages_show_list` - list pages ✅ approved
  - `pages_read_engagement` - read comments 🔄 pending submission
  - `pages_manage_engagement` - reply to comments 🔄 pending submission
  - `instagram_basic` - Instagram access ⏳ deferred
  - `instagram_manage_comments` - reply to IG comments ⏳ deferred
  - `instagram_manage_messages` - Instagram DMs ⏳ deferred

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

### Vonage SMS
- **Purpose**: OTP delivery for phone authentication
- **API**: Vonage SMS REST API (`https://rest.nexmo.com/sms/json`)
- **Credentials**: `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_SENDER_ID`
- **Coverage**: 200+ countries including Syria (+963), Saudi Arabia (+966), Turkey (+90), Sweden (+46)
- **Development**: console.log only (no real SMS sent)
- **Production**: live Vonage delivery — keys required
- **Phase 3**: WhatsApp Cloud API as primary delivery, Vonage SMS as fallback (after Meta WABA approval)

- **Implementation Location**: `/backend/src/services/sms.ts`
- **Env vars**:
  - `VONAGE_API_KEY` — from Vonage API Settings
  - `VONAGE_API_SECRET` — from Vonage API Settings
  - `VONAGE_SENDER_ID` — alphanumeric sender name (default: `Jawab24`)

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
| Instagram API | Comments + DM auto-replies | `FACEBOOK_*` env vars | ⚠️ Code ready, permissions deferred |
| Shopify | Product sync + KB enrichment | `SHOPIFY_*` env vars | ✅ Production |
| Salla | Product sync (Middle East) | `SALLA_*` env vars | ✅ Production |
| Zid | Product sync + KB enrichment (Saudi) | `ZID_*` env vars | ✅ Production |
| OpenAI | Smart reply generation | `OPENAI_API_KEY` | ✅ Production |
| Anthropic Claude | Tier-2 failover LLM + playground | `ANTHROPIC_API_KEY` | ✅ Active (circuit-open failover) |
| Stripe | Subscription payments | `STRIPE_*` env vars | ✅ Production |
| Firebase | Push notifications | Service account JSON | ✅ Production |
| PostgreSQL | Primary database | `DATABASE_URL` | ✅ Production |
| Redis | Cache + job queue | `REDIS_*` env vars | ✅ Production |
| Sentry | Error tracking | `SENTRY_DSN` | ✅ Production |
| Geoip-lite | User geolocation (fallback when CDN header missing) | (npm package) | ✅ Production (Tier 2 fallback after Cloudflare) |

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

