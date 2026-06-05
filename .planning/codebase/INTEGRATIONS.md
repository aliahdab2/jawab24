# External Integrations

## Social Media APIs

### Facebook / Instagram (Meta)
- **Purpose**: Primary platform for auto-reply automation
- **API Version**: Graph API v18.0 (configurable in environment)
- **App Status**: **Live mode** (approved 2026-03-21, App ID: 774211662298446)

- **OAuth Flow**:
  - User connects via Facebook Login
  - Access token stored encrypted (AES-256-GCM) in database
  - Token refresh: automatic background cron job every 6 hours (`/backend/src/services/tokenRefresh.ts`) — verifies tokens via Facebook debug_token API, re-fetches fresh page tokens if valid

- **Meta App Review — Permission Status**:
  - ✅ `pages_messaging` — Approved (2026-03-21) — send/receive Messenger DMs
  - ✅ `pages_manage_metadata` — Approved (2026-03-21) — webhook subscription for pages
  - ✅ `pages_show_list` — Approved (2026-03-21) — list user's pages in dashboard
  - ✅ `public_profile`, `email` — Always approved
  - ✅ `pages_read_user_content` — Approved (2026-04-07) — read page posts and comments
  - ✅ `pages_read_engagement` — Approved (2026-04-07) — read comments (feed webhooks)
  - ✅ `pages_manage_engagement` — Approved (2026-04-07) — reply to comments
  - ✅ `instagram_basic` — Approved (2026-04-07) — Instagram account access
  - ✅ `instagram_manage_comments` — Approved (2026-04-07) — reply to Instagram comments
  - ✅ `instagram_manage_messages` — Approved (2026-04-07) — Instagram DMs
  - ⏳ `instagram_business_basic` — Not yet submitted
  - ⏳ `instagram_business_manage_messages` — Not yet submitted

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
  - `/me/accounts` - list connected pages (primary page discovery path)
  - `/debug_token` - verify token + extract `granular_scopes.target_ids` (used as fallback when `/me/accounts` is empty for Business-Portfolio-owned Pages)
  - `/{page-id}?fields=id,name,access_token,category,about,phone,single_line_address,hours,website` - fetch individual page data in the fallback path (the `tasks` field is NOT requestable here — only on `/me/accounts`)
  - `/me/instagram_accounts` - list connected Instagram accounts
  - `/me/messages` with `recipient.comment_id` - send private reply to a comment (DM linked to the comment)
  - `/me/messages` with `recipient.id` - send DM to a user (requires prior conversation)
  - `/me/messages` with `message.attachment` (Generic Template) - send product card carousel as follow-up to text reply
  - `/{comment_id}/comments` - post a public reply to a comment
  - `/{post_id}?fields=message,story` - fetch post content (used for shared post context enrichment)

- **Rich Product Cards**: When an ecommerce tool returns a product reference (e.g. `check_inventory`), the reply pipeline sends a follow-up Generic Template carousel with the product image, price, and a `View product` button. Payload building (truncation, Meta limits, messaging_type) lives in `backend/src/services/metaMessaging.ts` and is shared by Messenger and Instagram. The card build/lookup lives in `backend/src/services/reply/productCardBuilder.ts`. Card send failures are logged but don't invalidate the text reply already delivered.

- **Business Portfolio Fallback (2026-04-15)**: Facebook's `/me/accounts` returns an empty array for Pages owned by a Meta Business Portfolio, even when the user has "Facebook access with Full control" and all permissions granted. `facebookService.getUserPages` handles this by falling back to `/debug_token` `granular_scopes` discovery and fetching each authorized Page individually. See `backend/src/services/facebook.ts:getUserPages` and tests in `backend/test/services/facebook.test.ts` describe block `getUserPages — Business Portfolio fallback`.

- **Reply Modes (Comments)**:
  - `public` - reply as a public comment
  - `private` - send DM via `recipient.comment_id` (fallback: public comment if DM fails)
  - `dual` - DM with full reply + public comment with short nudge. If DM fails, full reply posted as public comment

- **Per-Post Keyword Triggers** (ManyChat-style):
  - Merchants set trigger keywords + reply text per post (e.g. "comment . to get details")
  - When a comment matches a keyword, the trigger reply is sent immediately via `recipient.comment_id`, bypassing the AI pipeline
  - Keywords stored as comma-separated text in `posts.trigger_keyword` / `instagram_media.trigger_keyword`
  - Matching uses `matchesKeyword()` from `@jawab24/shared` with Arabic normalization
  - Sub-comments (`parent_id` set) skip the trigger path

- **Shared Post Handling (Messages)**:
  - When a customer DMs a shared post with no text → smart nudge acknowledging the post
  - When a customer DMs a shared post + text → post content fetched via Graph API and prepended to message for AI context

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

### WhatsApp Business (Meta Cloud API)
- **Purpose**: Auto-reply automation for WhatsApp DMs
- **Status**: Backend complete (2026-04-04); Meta Tech Provider Embedded Signup approval pending
- **Business Model**: Tech Provider (ManyChat model) — merchant connects their own WhatsApp Business Account; Meta bills merchant directly for per-message costs

- **Connection Flow (planned — Embedded Signup)**:
  - Merchant clicks "Connect WhatsApp" → Facebook Embedded Signup popup
  - Embedded Signup callback returns `phone_number_id` + `waba_id` + access token
  - Backend stores WhatsApp fields on existing `pages` row (or creates new row for WhatsApp-only merchant)

- **Access Token**:
  - Merchant's page-level access token (same token as Facebook/Instagram)
  - Encrypted at rest (AES-256-GCM, same key as Facebook tokens)

- **Webhook Setup**:
  - Same `/webhook` endpoint as Facebook/Instagram
  - `object: "whatsapp_business_account"` distinguishes WhatsApp payloads
  - Verification: X-Hub-Signature-256 HMAC-SHA256 (same as Facebook)
  - Events: `messages` field on WABA object

- **Key API Endpoints Used**:
  - `POST /{version}/{phone_number_id}/messages` — send text message (with `messaging_product: "whatsapp"`)
  - `POST /{version}/{phone_number_id}/messages` — mark as read (with `status: "read"`, `message_id: wamid`)

- **Constraints**:
  - 24h messaging window: free-form replies only allowed within 24h of last customer message
  - Template messages required outside window (Phase 4 — not yet implemented)
  - No sender profile API — display name comes from webhook `contacts[].profile.name` only (cached in DB)
  - `sendTypingIndicator` is a no-op (markAsRead needs wamid, not senderId — Phase 6)

- **Message ID Format**: `wamid.xxx` (e.g., `wamid.HBgLMTkxMzExMTExMTEVAgASGBI...`)

- **Implementation Location**:
  - Cloud API client: `backend/src/services/whatsapp.ts`
  - Reply service: `backend/src/services/whatsappReply.ts`
  - Platform adapter: `backend/src/services/reply/adapters/whatsappAdapter.ts`
  - Webhook handler: `backend/src/controllers/webhook.ts` (WhatsApp branch)
  - Page lookup: `backend/src/services/pages.ts` (`getPageByWhatsAppPhoneNumberId`)

- **Schema**:
  - `pages.whatsapp_phone_number_id` — Cloud API phone number ID
  - `pages.whatsapp_business_account_id` — WABA ID
  - `pages.whatsapp_display_phone_number` — human-readable "+966 55..."
  - `pages.whatsapp_auto_reply_enabled` — per-channel toggle
  - `messages.platform_message_id` — generic dedup column (wamid for WhatsApp, message ID for Facebook/Instagram)

- **Meta Submission Status**:
  - Must request Embedded Signup access (App Dashboard → WhatsApp → Embedded Signup) — ~3-5 business days
  - No App Review needed — only business verification + Standard Access required
  - Need Solution ID before building frontend Embedded Signup flow

---

## E-Commerce Platforms

### Cross-platform: webhook hardening (Shopify + Salla + Zid)

> Lifted to a shared, platform-agnostic layer in PR #27 (2026-05-07). Every
> e-commerce integration goes through the same code path for webhook
> registration, retry, exhaustion, and manual recovery. Adding a new
> platform = implementing the adapter contract; everything below applies for free.

- **Adapter contract** (`backend/src/integrations/registry.ts`):
  - `registerWebhooks(store): Promise<WebhookRegistrationResult>` — returns `{registered[], failed[], lastAttempt, exhausted?}`. Each adapter (`integrations/{shopify,salla,zid}.ts`) implements by delegating to its service module.
  - `getWebhookTopics(): readonly string[]` — source-of-truth topic list, asserted equal to the service constant by `backend/test/integrations/webhookTopicDrift.test.ts`.
  - `integrationRegistry.get(platform)` — lookup used by the worker + the shared reregister handler.

- **Shared install-path helper** (`backend/src/services/ecommerce.ts:registerWebhooksWithPersist`):
  - Awaits `adapter.registerWebhooks(store)`, persists the status JSONB, enqueues a retry job on partial or total failure.
  - Install never fails because of webhook hiccups — total failures persist a `{registered:[], failed:[{topic:'all',error}]}` marker so the integrations card can surface a Re-register CTA.
  - Save and queue failures emit Sentry events tagged `webhook-status-persist-failed` / `webhook-retry-enqueue-failed`.

- **Retry queue** (`backend/src/lib/webhookRetryQueue.ts`):
  - BullMQ queue `ecommerce-webhook-retry`, 3 attempts, exponential backoff (~30s, ~2min, ~8min).
  - Worker (`backend/src/workers/webhookRetryWorker.ts`) dispatches via `integrationRegistry.get(platform).registerWebhooks(store)` — no platform branching.
  - On exhaustion: persists `webhookStatus.exhausted = true`, emits Sentry event tagged `service: <platform>, stage: webhook-retry-exhausted`. Frontend integrations card renders a "Re-register webhooks" CTA.

- **Manual recovery endpoint**: `POST /:platform/store/webhooks/reregister`
  - Mounted under each platform's prefix; one shared handler in `backend/src/controllers/ecommerceWebhooks.ts:createReregisterHandler(platform)`.
  - Auth: `authenticate + resolveWorkspace + requireRole('admin')`.
  - Returns `{ ok, webhookStatus }` with the latest registration result. Frontend `ecommerceApi.reregisterWebhooks(platform)` wraps it.

- **Frontend recovery UI**:
  - `frontend/src/pages/integrations.tsx` — banner + "Try again" button driven entirely off `store.webhookHealth`. Renders for any platform whose `PlatformConfig.reregisterWebhooks` is set (all three today).
  - i18n keys `webhookHealth.{pendingTitle,pendingBody,failedTitle,failedBody,reregisterBtn,reregistering,reregisterSuccess,reregisterError}` are platform-neutral. EN + AR translations live in `frontend/src/i18n/{en,ar}/integrations.json`.

- **Tests**:
  - `backend/test/services/registerWebhooksWithPersist.test.ts` — 15 tests, table-driven over `[shopify, salla, zid]`: success, partial-failure, total-throw, queue-down, db-down resilience.
  - `backend/test/controllers/ecommerceWebhooks.test.ts` — 18 tests for the reregister handler.
  - `backend/test/workers/webhookRetryWorker.test.ts` — 12 tests for registry dispatch.
  - `backend/test/integrations/webhookTopicDrift.test.ts` — adapter topics match service constants.
  - `frontend/e2e/integrations.spec.ts` — 6 tests (`[shopify, salla, zid] × [en, ar]`) for the recovery UI banner + reregister round-trip.

---

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
  - Endpoint: `/shopify/webhooks` (POST), plus dedicated `/shopify/webhooks/{uninstall,products-update,orders}` per-event handlers
  - Events (8): `app/uninstalled`, `products/{create,update,delete}`, `orders/{create,updated,fulfilled,cancelled}`
  - Verification: HMAC-SHA256 base64 signature in `X-Shopify-Hmac-SHA256` header
  - Signature Key: Shopify API secret
  - GDPR endpoints: `/gdpr/customers/{data_request,redact}`, `/gdpr/shop/redact` (mandatory for App Store)
  - Source-of-truth topic list: in `services/shopify.ts:registerWebhooks` body

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
  - No domain input (Salla authenticates the merchant directly)
  - Redirect to Salla authorization
  - Request scopes: `offline_access`, `products.read_write`, `settings.read` (verify against `config.salla.scopes`)
  - Access token (14 days) + refresh token (single-use; Redis distributed lock prevents concurrent-refresh races)

- **API Endpoints Used**:
  - `/products` - list products
  - `/orders` - order data
  - `/merchants/profile` - store info

- **Webhook Integration**:
  - Endpoint: `/salla/webhooks` (POST) — single endpoint, dispatched by `event` field in body
  - Events (11): `product.{created,deleted,price.updated,status.updated,quantity.low}`, `app.uninstalled`, `order.{created,updated,shipping.update,completed}`, `abandoned.cart`
  - Verification: HMAC-SHA256 hex signature in `X-Salla-Signature` header (timing-safe compare)
  - Source-of-truth topic list: `SALLA_WEBHOOK_EVENTS` in `services/salla.ts`
  - No GDPR endpoints required (Salla policy)

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

### E-Commerce Analytics (merchant-facing)

Read-only aggregator that surfaces merchant ROI for a connected store across all e-commerce platforms (Shopify, Salla, Zid). No new tables — reads from `customerNotificationsLog` + `messages`.

- **Endpoint**: `GET /api/ecommerce-analytics/:storeId?range=30d|90d` (auth + workspace-scoped via `resolveWorkspace`)
- **Implementation**:
  - Service: `/backend/src/services/ecommerceAnalytics.ts`
  - Controller: `/backend/src/controllers/ecommerceAnalytics.ts`
  - Routes: `/backend/src/routes/ecommerceAnalytics.ts` (registered with prefix `/api/ecommerce-analytics`)
- **Frontend**:
  - Page: `/frontend/src/pages/ecommerce-analytics.tsx`
  - Reusable primitives + sections: `/frontend/src/components/analytics/`
  - Embedded widget: `StoreAnalyticsSummary` slot inside `ConnectedStoreCard` on the integrations page
- **Returns**: notification funnel `{ total, byChannel }` (channel-keyed for WhatsApp/DM future), per-type breakdown, recovery stats (approximate phone-window match), reply method breakdown
- **Attribution caveat**: cart-recovery revenue uses an EXISTS subquery matching `abandoned_cart` notifications to `order_confirmed` notifications by phone within a 72h window. Over-credits when a customer would have ordered anyway. Phase 6 (URL wrapping) tightens this with click-through telemetry — see `ECOMMERCE_POWER_FEATURES_PLAN.md`.

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
  3. **In-app plan change** (proration):
     - `POST /payment/change-plan` → calls `stripe.subscriptions.update` with `proration_behavior: 'create_prorations'`. Used when the customer already has an active Stripe-backed subscription. Customers without an externalSubscriptionId fall through to the checkout flow.
  4. **In-app cancellation**:
     - `POST /payment/cancel-subscription` → `stripe.subscriptions.update(id, { cancel_at_period_end: true })`. Subscription stays active until period end.
  5. **Billing Portal** (locked-down: invoice history + payment methods):
     - `POST /payment/billing-portal` opens the portal. When `STRIPE_BILLING_PORTAL_CONFIG_ID` is set, plan changes and cancellations are disabled in the portal — those flows go through the app so DB stays in sync.
     - Sanctions check applied before portal creation
  6. Webhook at `POST /payment/webhook` receives `checkout.session.completed` → subscription record created

  6b. **Hidden high-volume plans** (`plans.is_public = false`):
     - `getActivePlans()` (the public `GET /plans` grid) filters `is_active AND is_public`, so plans flagged `is_public: false` never appear on `/pricing`. The single-plan lookup (`GET /plans/:slug`) and `changePlan`/checkout do NOT filter, so a hidden plan stays purchasable by slug/ID via a direct link.
     - Used for the **Scale** plans (`scale-20k` $149/mo·20k replies, `scale-30k` $199/mo·30k replies, seeded from `config/plans.ts`). Surfaced only to Pro/Scale customers at their reply limit via the `AiUsageWarningBanner` nudge and the discreet `/pricing` link, both pointing to the hidden `/pricing/scale` page. Existing Pro subscribers upgrade in place via `POST /payment/change-plan` (proration); the higher quota applies immediately since it's read live from the plan. Stripe recurring Price IDs for the Scale plans must be set manually per env (the seed never touches `stripe_price_id`).

  7. **Admin "collect payment" link** (hidden, admin-only — `feat/admin-collect-payment`):
     - `POST /admin/users/:userId/payment-request` (behind `requireAdmin`) creates a HOSTED Stripe Checkout Session (`mode: 'payment'`, custom inline `price_data` amount, metadata `type: 'manual_payment'`) and returns its `url` for the admin to send to the customer. Backed by `paymentRequestService` + the `payment_requests` table.
     - **Collect-only**: paying it marks the `payment_requests` row `paid` (via the same `checkout.session.completed` webhook, routed by `metadata.type` BEFORE the subscription path) and **never** touches `users.topup_balance` — it bills for replies credited separately by hand. Optional `topupPurchaseId` links a request to the grant it collects for ("granted but unpaid" reporting).
     - Reconciliation backstop: a 15-min sweep (`paymentRequestService.reconcilePending`, wired in `index.ts`) re-queries Stripe for aged `pending` rows so a missed webhook still settles the ledger. Independent of the self-service top-up engine.

- **Webhook Events**:
  - `checkout.session.completed` - subscription started, OR (when `metadata.type === 'manual_payment'`) marks an admin collect-payment request `paid`
  - `customer.subscription.created` - safety net for race with checkout
  - `customer.subscription.updated` - plan changed (also writes new `planId` resolved from `priceId`)
  - `customer.subscription.deleted` - canceled
  - `invoice.payment_succeeded` - payment confirmed (resets quota, invalidates status cache)
  - `invoice.payment_failed` - payment failed
  - `charge.refunded` - logs refund and notifies the customer (does not cancel the subscription)
  - All handlers invalidate the Redis `sub:active:<userId>` cache so a status change is visible to the reply pipeline immediately, not after the 60s TTL.

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
  - Webhook Handler: `/backend/src/controllers/payment.ts` (`handleWebhook` method — Stripe webhook processing)

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
- **Purpose**: OTP delivery for phone authentication + e-commerce order notifications
- **API**: Vonage SMS REST API (`https://rest.nexmo.com/sms/json`)
- **Credentials**: `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_SENDER_ID`
- **Coverage**: 200+ countries including Syria (+963), Saudi Arabia (+966), Turkey (+90), Sweden (+46)
- **Development**: console.log only (no real SMS sent)
- **Production**: live Vonage delivery — keys required

- **Implementation Location**: `/backend/src/services/sms.ts`
- **Env vars**:
  - `VONAGE_API_KEY` — from Vonage API Settings
  - `VONAGE_API_SECRET` — from Vonage API Settings
  - `VONAGE_SENDER_ID` — alphanumeric sender name (default: `Jawab24`)

### E-commerce Order Notifications
- **Purpose**: Automated SMS to customers for order lifecycle events (confirmed, shipped, delivered, abandoned cart, review request)
- **Platforms**: Salla, Shopify, Zid — driven by existing webhook handlers
- **Queue**: BullMQ `customer-notifications` queue, concurrency 10, rate limit 50/min, exponential backoff (3 retries)
- **Deduplication**: `platformEventId` = `${platform}:${type}:${orderId}` — prevents double-sends on webhook retries
- **Language detection**: Arabic country prefixes (+966 SA, +971 AE, +965 KW, etc.) → Arabic template; otherwise English
- **Templates**: Per-store, per-type, opt-in (`is_enabled=false` default) — seeded on store connect
- **Schema**: `customer_notification_templates`, `customer_notifications_log`
- **Implementation**:
  - `/backend/src/services/customerNotifications.ts` — core service
  - `/backend/src/services/orderNotificationScheduler.ts` — shared dispatcher across platforms
  - `/backend/src/workers/customerNotificationWorker.ts` — BullMQ worker
  - `/backend/src/lib/customerNotificationQueue.ts` — queue definition
  - `/backend/src/controllers/customerNotifications.ts` + `/backend/src/routes/customerNotifications.ts` — REST API

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

### Resend Email Service
- **Purpose**: Transactional emails — waitlist notifications, subscription welcome, lead digests, and **team invites**. Email kinds are the `EmailType` union in `email.ts`: `lead_digest | waitlist | transactional | subscription_welcome | invite`.
- **Team invites**: `workspaceInviteService.createInvite()` sends the invite via email (for email contacts) or SMS (for phone contacts). The invite email is **bilingual** (Arabic + English in one message, since the recipient's language is unknown) and links to `/invites/accept?token=…`. If the email send fails, the API returns the raw token so the UI can fall back to a copy-and-share link. Template: `inviteEmailTemplate()` in `emailTemplates.ts`.
- **API**: Resend REST API (`https://api.resend.com/emails`) via native `fetch` (no SDK)
- **From**: `info@jawab24.com` (configurable via `RESEND_FROM_EMAIL` / `RESEND_FROM_NAME`)
- **Graceful degradation**: In development, logs email payload without sending. If `RESEND_API_KEY` is not set, returns error without crashing.

- **Configuration**:
  - `RESEND_API_KEY` — Resend API key
  - `RESEND_FROM_EMAIL` — Sender email (default: `info@jawab24.com`)
  - `RESEND_FROM_NAME` — Sender name (default: `Jawab24`)

- **Implementation Location**:
  - Service: `/backend/src/services/email.ts` (singleton `emailService`)
  - Templates: `/backend/src/utils/emailTemplates.ts`
  - Tests: `/backend/test/services/email.test.ts`, `/backend/test/utils/emailTemplates.test.ts`

---

## Search / AI Engine Discovery

### IndexNow (Bing / Copilot / ChatGPT Search / Yandex)
- **Purpose**: Instantly notify IndexNow-participating engines (Bing, Microsoft Copilot, ChatGPT Search, Yandex) of the public URL set after a deploy, so new/updated pages are crawled without waiting for organic discovery. Google does not consume IndexNow (it reads the sitemap), so this complements — not replaces — sitemap submission.
- **API**: `POST https://api.indexnow.org/indexnow` with `{ host, key, keyLocation, urlList }` (native `fetch`, no SDK).
- **Key verification**: The key is served as plain text at `https://jawab24.com/<key>.txt` via a rewrite in `frontend/next.config.js` that routes `/<token>.txt` → API route `/api/indexnow-key`, which validates the token against the **runtime** `INDEXNOW_KEY` env and 404s otherwise. Validating at runtime (not build time) means rotating the key needs no rebuild. The key is public by design but sourced from env (not committed).
- **Trigger**: Non-blocking step at the end of `scripts/deploy-production.sh` (after a successful deploy) submits every `<loc>` URL from the live sitemap. Skipped when `INDEXNOW_KEY` is unset; never fails the deploy.
- **Configuration**:
  - `INDEXNOW_KEY` — required in the frontend **runtime** env (for the key file) and in the deploy env (for the ping). Public value; not a secret.
- **Implementation Location**:
  - Key file route: `/frontend/src/pages/api/indexnow-key.ts` + rewrite in `/frontend/next.config.js`
  - Ping script: `/scripts/indexnow-ping.ts`
  - Tests: `/frontend/test/pages/api/indexnow-key.test.ts`

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

---

## Google Play Publishing (Android Release)

- **Purpose**: Automated upload of signed Android App Bundles (AAB) to Google Play.
- **Tooling**: Gradle Play Publisher (`com.github.triplet.gradle:play-publisher:3.13.0`, pinned for AGP 8.13 — 4.x requires AGP 9). Classpath in `frontend/android/build.gradle`; `play{}` block in `frontend/android/app/build.gradle`.
- **Entry point**: `scripts/release-android.sh` (local-first) / `/release-android` skill. Optional dispatch-only CI: `.github/workflows/android-release.yml`.
- **Play package**: `com.jawab24.android` (differs from the iOS/Capacitor appId `com.jawab24.app`).
- **Auth**: service account `play-publisher@jawab24-play-publisher.iam.gserviceaccount.com` (in a personal `aliahdab@gmail.com` Cloud project — deliberately NOT the telavox.se org). Credential via `ANDROID_PUBLISHER_CREDENTIALS` env (raw JSON) or local key file `frontend/android/play-service-account.json` (untracked). Scoped to **testing tracks only** — production is promoted manually in the Play Console.
- **Signing**: upload keystore `frontend/android/jawab24-upload.jks` (alias `jawab24`) + passwords in `frontend/android/local.properties` (both untracked). Play App Signing holds the real signing key.
- **Versioning**: `versionName` from `--version`/`--bump`; `versionCode = major*10000 + minor*100 + patch` (deterministic, injected via `-PappVersionName/-PappVersionCode`). The `build.gradle` literals are the "last released" fallback.
- **Note**: Play Console's old "API access" page was removed by Google — service accounts are created in Google Cloud Console and invited via Play Console → Users and permissions.

