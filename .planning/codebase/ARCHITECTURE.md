# Architecture

## System Overview

Jawab24 is a monorepo-based auto-reply platform that automatically generates intelligent responses to customer inquiries on Facebook, Instagram, WhatsApp, and e-commerce platforms (Shopify, Salla, Zid). The system consists of three distributed services communicating via a shared queue (BullMQ/Redis) and HTTP APIs.

**Core functionality**: When customers send messages or comments, webhooks trigger reply processing. Replies are either template-matched or AI-generated via the OpenAI API, then posted back to the customer. The system also supports knowledge base enrichment from e-commerce catalogs, customer context awareness, and smart routing between auto-reply and human handoff.

## Architecture Pattern

### Monorepo Structure (npm workspaces)

The project uses **npm workspaces** for dependency management and build orchestration:

```
root/
├── frontend/           # Next.js 15 web + Capacitor mobile app
├── backend/            # Fastify 5 API server
├── ai-worker/          # AI generation worker (OpenAI/Anthropic)
├── packages/shared/    # Shared TypeScript types, constants, interfaces
└── package.json        # Workspace configuration
```

Each service is independently deployable but shares:
- **Queue contracts** (`REPLY_QUEUE_NAME`, `AI_QUEUE_NAME`)
- **Type definitions** (`@jawab24/shared`)
- **Environment variables** (Redis connection, API keys)

### Service Communication Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Systems                             │
│  (Facebook Graph API, Instagram, WhatsApp Cloud API,               │
│   Shopify, Salla, Zid, OpenAI, Stripe)                            │
└────────────────────────┬────────────────────────────────────────────┘
                         │ Webhooks
                         ▼
        ┌────────────────────────────────┐
        │       Backend (Fastify 5)      │ :3000
        │  - Route/Controller/Service    │
        │  - DB (PostgreSQL + Drizzle)   │
        │  - Redis (BullMQ queues)       │
        └────────┬──────────────────┬────┘
                 │ HTTP API         │ Enqueue jobs
                 │                  │
        ┌────────▼──────┐   ┌───────▼──────────┐
        │   Frontend    │   │    AI Worker     │ :3002
        │   (Next.js)   │   │  (Node.js)       │
        │   :3001       │   │  - BullMQ worker │
        │               │   │  - OpenAI client │
        │               │   │  - Sentry logging│
        └───────────────┘   └──────────────────┘
                                    │
                            ┌───────▼──────────┐
                            │  OpenAI API      │
                            │  (gpt-4.1-mini)  │
                            └──────────────────┘
```

### Inter-Service Communication Modes

| Mode | Description | Channels |
|------|-------------|----------|
| **Queue-based** | Async job processing for reply generation | BullMQ (Redis) — `REPLY_QUEUE`, `AI_QUEUE` |
| **HTTP API** | CRUD operations, auth, config | REST endpoints (Axios client) |
| **Webhooks** | Inbound events from Facebook/Instagram/e-commerce | `POST /webhook` (backend only) |
| **Server-Sent Events (SSE)** | Real-time UI updates (admin dashboard, reply status) | `/sse/subscribe` (backend → frontend) |
| **Direct DB** | Both backend and AI worker read from PostgreSQL | Drizzle ORM abstraction |

## Services

### Frontend (Next.js 15 + Capacitor)

**Entry point**: `/Users/aliahdab/Documents/AutoReply/frontend/src/pages/_app.tsx`
**Port**: 3001 (development), 3001 (production)
**Runtime**: Node.js / Browser / iOS / Android (Capacitor)

#### Architecture Patterns

1. **Page Structure** (Next.js 15):
   - File-based routing: `/pages/[feature].tsx` maps to routes
   - Public pages: landing, pricing, login, what-is-jawab24, blog, contact, terms, privacy
   - Protected pages: dashboard, comments, messages, rules, templates, settings, integrations
   - Auth pages: login, complete-profile, checkout
   - **`/business` («نشاطك التجاري», B1 2026-07-24)** — the unified business surface:
     readiness chips → catalog (`CatalogManager`) → structured fact rows →
     inline Business Info editor. The KB editor logic lives in
     `KnowledgeBasePanel` (extracted from `KnowledgeBaseModal`, which is now a
     thin portal wrapper used by conversation deep-links `?openKb`). `/catalog`
     is a CLIENT-side redirect to `/business` preserving `?page&import=1`
     (`next.config` redirects don't run under `output:'export'`). Canary-gated
     by `isCatalogVisible` — for that reason `KB_DEEP_LINK` deliberately still
     targets `/pages?openKb=true` (moving it would bounce non-admin merchants).

2. **Layout System**:
   - **PublicLayout** — for landing, pricing, blog pages (no sidebar)
   - **DashboardLayout** — for protected pages (sidebar + header + mobile nav)
   - Persistent layouts prevent remounting on navigation (preserves state)

3. **State Management**:
   - **Zustand stores** (`src/lib/store.ts`):
     - `useAuthStore` — user, workspace, authentication state
     - `useUIStore` — sidebar visibility, theme, mobile modals
   - **localStorage-persisted** — survives page refresh
   - **Hydration guard** in DashboardLayout (`if (!_hasHydrated) return null`) protects protected routes

4. **Data Fetching**:
   - **Axios client** (`src/lib/api.ts`):
     - Authenticated instance: auto-adds token, CSRF protection, workspace scoping
     - Public instance: for unauth endpoints (still attaches X-CSRF-Token on mutations — it rides the session cookie via withCredentials, so logout/waitlist need it)
     - Interceptors: auth 401 handling, retry logic, timeout
   - **React Query** (`@tanstack/react-query`):
     - Caching, refetching, optimistic updates
     - Stale time: 5 min, GC time: 10 min

5. **Hooks** (`src/hooks/`):
   - `useAiGeneration.ts` — draft/polish AI-generated replies
   - `useSSE.ts` — subscribe to real-time updates (reply status, admin events)
   - `useConversationActions.ts` — mark as handled, resend, replay
   - `useTheme.ts`, `useMobileMessages.ts`, `useBodyScrollLock.ts`, etc.

6. **Components**:
   - **Functional, React 19**: No class components
   - **Feature-based dirs**: `comments/`, `messages/`, `rules/`, `templates/`, `settings/`
   - **UI primitives** in `components/ui/` (Button, Modal, Input, Card, Textarea, etc.)
   - **RTL support**: All classes use Tailwind logical properties (`ps-*`, `pe-*`, `start`, `end`)

7. **i18n** (Bilingual: Arabic + English):
   - **next-intl v4**: `useTranslations('namespace')`, `useLocale()`
   - **44 namespaces** split across `src/i18n/en/` and `src/i18n/ar/` (one JSON per namespace)
   - **ICU pluralization**: Format strings like `{count, plural, one {# item} other {# items}}`
   - **Pages declare dependencies**: `makeGetStaticProps(['dashboard', 'common'])` loads only needed messages

8. **Mobile Support**:
   - **Capacitor 8** — bridge to iOS/Android native APIs
   - **Safe area handling** via CSS variables in `globals.css` (`--sai-top`, `--sai-bottom`, etc.)
   - **Landscape mode** — all pages tested in portrait + landscape orientation
   - **Push notifications** — FCM on Android, APNs on iOS

#### Key Files

| What | Where |
|------|-------|
| App entry | `src/pages/_app.tsx` |
| Document setup | `src/pages/_document.tsx` |
| State stores | `src/lib/store.ts` |
| API client | `src/lib/api.ts` |
| Auth handler | `src/lib/authManager.ts` |
| Hooks barrel | `src/hooks/index.ts` |
| Styles/variables | `src/styles/globals.css` |
| Dashboard layout | `src/components/layout/DashboardLayout.tsx` |
| UI components | `src/components/ui/` |
| Feature pages | `src/pages/[comments, messages, rules, templates, settings, integrations].tsx` |

### Backend (Fastify 5 + Drizzle ORM)

**Entry point**: `/Users/aliahdab/Documents/AutoReply/backend/src/index.ts`
**Port**: 3000 (both development and production)
**Runtime**: Node.js 22+
**Database**: PostgreSQL with Drizzle ORM

#### Architecture Patterns

1. **Request Pipeline**:
   ```
   Request
     ↓
   Middleware (auth, CSRF, rate-limit, error handler)
     ↓
   Routes (define endpoints)
     ↓
   Controllers (parse params, call services)
     ↓
   Services (business logic, DB queries, external API calls)
     ↓
   Response (JSON, error handling via Sentry)
   ```

2. **Middleware Stack** (`src/middleware/`):
   - `errorHandler.ts` — centralized error handling (logs to Sentry)
   - `auth.ts` — JWT/session validation, workspace scoping, CSRF protection
   - `admin.ts` — admin-only routes
   - `workspace.ts` — multi-workspace isolation; resolves default workspace via `workspaceService.resolveDefaultWorkspaceId` when no `X-Workspace-Id` header is sent
   - `geo.ts` — geolocation via MaxMind (for compliance checks, sanctioned countries)
   - `requestId.ts` — unique request ID for tracing

3. **Route Organization** (`src/routes/`):
   - **31 route files** (auth, messages, comments, rules, templates, payments, admin, waitlist, health, voice, customerNotifications, version, etc.)
   - Each route file imports a controller and registers endpoints
   - Routes grouped by feature/domain

4. **Controllers** (`src/controllers/`):
   - Thin layer: parse request, call service, return response
   - Handle HTTP semantics (status codes, headers)
   - Example: `webhookController.handleWebhook()` → enqueues job → immediate 200 OK

5. **Services** (`src/services/`):
   - Pure business logic — no HTTP knowledge
   - Examples:
     - `replyService.processComment()` — template/AI reply logic
     - `instagramReplyService.sendReply()` — Instagram Graph API calls
     - `stripe.ts` — subscription management
     - `ecommerce.ts` — Shopify/Salla/Zid product sync
     - `catalog.ts` — native catalog (Stage 2 v2): merchant-authored offerings (`catalog_items` table — generic `type` product/service/course/vehicle/custom, name, optional price/currency/description, `is_available`, per-page cap 300) for pages WITHOUT a connected store. CRUD via `/pages/:pageId/catalog` (reads = member, writes = workspace admin; Zod validation normalizes Arabic-Indic/formatted price input). **Reply-path contract:** items reach the AI as TEXT only — `renderCatalogPromptBlock` (pure, budget 12k chars, drops descriptions then truncates with an explicit non-exhaustive tail) feeds the existing `<product_catalog>` block; NO AI function-calling tools (D-004; v1 tool-based catalog was reverted). Every write runs row-op + `pagesService.invalidatePageCaches` in ONE transaction so the next reply regenerates (a committed delete without the bump would keep quoting the deleted item until cache TTL). Prompt wiring is LIVE: `contextEnricher` + `playgroundContext` fill `context.productCatalog` from `buildCatalogPromptBlock` for store-less pages (store-linked pages keep the store summary AND reject manual writes with 409 `PAGE_HAS_STORE` — a catalog write there would orphan the page's RAG chunks via the kbActiveVersion bump). UI is founder-only during canary (`isCatalogVisible` email allowlist in `featureFlags.ts`); backend CRUD is intentionally workspace-admin-gated regardless.
   - Subdomain services:
     - `kb/` — Knowledge Base (embedding, retrieval, semantic cache)
     - `reply/` — Reply generation pipeline (context, formatting, quality checks)
       - `commentProcessor.ts` — unified comment pipeline: Post Reply rule check (keyword match or any-comment mode) → AI generation → send → lead extraction (fire-and-forget). Any-comment mode runs — inside the per-comment idempotency check + reply lock — the shared skip rules + a no-AI complaint keyword-guard + the handoff-pause gate + an invisible per-post/24h cap before sending (see `postReplyRule.ts`, `protection/post-reply-cap.ts`, D-013)
       - `postReplyRule.ts` — pure Post Reply logic: rule resolution (`trigger_type` 'keyword'|'all'), keyword matching, payload validation (shared by the trigger controller), and `evaluateAnyCommentGuard` (skip spam / flag complaints before an any-comment template send; content-free comments — dot/emoji/digit CTA engagement — send, D-021). No DB/adapter deps — unit-testable in isolation
       - `commentPreprocess.ts` — single source of truth for comment skip classification (`preprocessCommentText`) and language resolution (`resolveCommentLanguage`). Shared by `generateForComment` and `generateForPlayground` so production and playground stay in sync. Implements the Facebook `message_tags` user-tag skip rule (see `docs/comment-and-message-handling.md`).
       - `messageProcessor.ts` — unified DM pipeline: shared post enrichment → template match → AI generation → send → optional product card follow-up → lead extraction (fire-and-forget)
       - `productCardBuilder.ts` — converts ecommerce tool results (e.g. `check_inventory`) into `ProductCard[]` for Messenger/Instagram Generic Template carousel. Requires a synced image from `ecommerceProducts`; degrades to text-only when no image is available.
     - `ecommerceAnalytics.ts` — read-only aggregator over `customerNotificationsLog` + `messages` for the merchant-facing analytics dashboard. Channel-keyed funnel (`{ total, byChannel }`) so the same shape carries SMS today and WhatsApp/DM later. Recovery attribution is approximate: matches `abandoned_cart` → `order_confirmed` by phone within a 72h window — UI surfaces the caveat. `parseAmount`/`extractCurrency` helpers extract numeric values from free-form `cartTotal` strings.
       - `leadExtractor.ts` — fire-and-forget lead capture: phone detection (Arabic-Indic normalization) → Redis rate limit → OpenAI extraction → merge-upsert leads table → SSE lead:captured. Card writes MERGE, never replace: fresh value wins per field key, existing keys are never dropped, a 'completed' card is never demoted to pending. No-phone follow-up messages from a fresh DM lead (status 'new', within `LEAD_REEXTRACT_WINDOW_HOURS`, default 24h / 0 = kill-switch) re-run extraction over the full history so post-phone order details (final size, recipient name, address) land on the card — bounded by a 180s per-lead Redis cooldown, an `extractionAttempts` cap of 10 (shared counter across capture runs and re-reads), and a separate `leads:reextraction:*` daily budget (150/workspace). `GET /leads?search=` filters server-side: senderName/phone ILIKE plus extracted-data summary/field VALUES (both jsonb encodings normalized; never JSON keys/labels), wildcards escaped via `utils/sqlLike.escapeLike`. Also owns lead status/sub-stage/custom-field writes; merchant customization config (sub-stages per status + field definitions) lives in workspace settings JSONB (`settings.leadStages` / `settings.leadFields`), with optional per-page overrides in nullable `pages.lead_stages` / `pages.lead_fields` (effective = page override ?? workspace default via shared `resolveEffectiveLeadStages/Fields`; admin-only `PATCH /pages/:id/lead-config`), validated server-side against the effective config in the leads/workspace/pages controllers
       - `nonTextHandler.ts` — handles non-text DMs via **store-then-enrich**: the attachment row is stored immediately at webhook receipt with a placeholder body + `enrichment_status='pending'` (and a `message:received` SSE so the inbox shows it instantly), enriched asynchronously (voice → Whisper; customer images → AI vision via `imageUnderstanding.ts` gpt-4.1-mini, gated by env kill switch + per-plan daily cap; shared posts → Graph fetch), then finalized with one atomic `finalizeEnrichment` UPDATE (text + status) before enqueuing the reply job (video/file/failed-enrichment → `failed` + text-only nudge). This lets the reply pipeline PARK on a pending sibling (see below) instead of answering a bare text/placeholder, and makes attachments crash-visible. Media download plumbing (fetch+timeout+size-cap) is shared via `utils/mediaDownload.ts` with transcription
       - **Text+attachment split-reply race / park** — because a text question and its attachment arrive as two separate webhook events seconds apart, `messageProcessor` step 11 PARKS (re-enqueue with a bounded `attachmentRetries` counter, kept separate from `handoffRetries` so it can't trip stale-backlog suppression) while a sibling row is `enrichment_status='pending'` (younger than a 60s crash cutoff), so the eventual reply consolidates text + enriched content into ONE message instead of a wrong-then-correct pair. `markOlderMessagesAsReplied` is id-scoped to the consolidated rows (no blanket per-sender sweep) to prevent silently dropping a row that finalizes mid-generation. All three park kinds (handoff / AI-unavailable / attachment) share `replyWorker.reEnqueueParked`. Docs: `docs/comment-and-message-handling.md` → "Store-then-enrich"
       - `imageUnderstanding.ts` — customer-image → text description (gpt-4.1-mini vision, `image_understanding` cost pipeline). Describe-then-enqueue, mirroring transcription; image bytes never persisted (only the text description). No per-merchant toggle (default-on like voice); `checkImageUnderstandingGate` = `IMAGE_UNDERSTANDING_ENABLED` env flag + workspace-owner plan resolution + shared `lib/dailyCap` counter (per-plan caps, ×2 with active top-up balance). Bodies use the `[صورة: …]`/`[Image: …]` marker protocol (`@jawab24/shared` `imageMessage.ts`, drift-guarded vs backend i18n); ai-worker's `promptBuilder` injects a per-call IMAGE MESSAGE directive when a marker is present so bare product screenshots are answered as implicit inquiries (non-image prompts stay byte-identical — no PROMPT_VERSION impact)
       - `sender.ts` — Facebook comment reply logic (public/private/dual modes with fallback)
       - `nudge.ts` — dual mode nudge variation picker (avoids Facebook spam detection)
       - `adapters/` — per-platform adapters: message adapters (Facebook, Instagram, WhatsApp) implementing `MessagePlatformAdapter`, comment adapters (Facebook, Instagram) implementing `CommentPlatformAdapter`. **Intentional design (D-016):** the reply pipeline (`messageProcessor`/`commentProcessor`) and the single `replyQueue` are shared across all channels; channel differences (send, fetch, media, 24h window, future templates/receipts) live ONLY in the adapter. When a channel needs different behavior, add an adapter method — never a `platform === 'x'` branch in the core. Separate by JOB (a future *outbound* pipeline for template broadcasts), never by channel.
     - `protection/` — Safety rules (price hallucination detection, angry customer alerts)
   - Backend i18n: `utils/i18n.ts` — centralized customer-facing strings (nudges, fallbacks, placeholders). Add new languages by extending the `Locale` type.
   - Language detection: consolidated in `packages/shared/src/language/` with two intentionally-separate surfaces — `detector.ts` (backend: rich `{language, confidence, script, isRTL}`, emits `unknown`; confidence is load-bearing for the DM `deferToHistory` gate `<0.6` and `isLowSignalLatinToken` `≤0.5`) and `resolveChain.ts` (ai-worker: script-property detection + history-first `resolveInputLanguage`; never `unknown`). `backend/src/utils/language.ts` and `ai-worker/src/services/language.ts` are thin re-export shims. Deep dist import (`@jawab24/shared/dist/language/*`), deliberately NOT in the shared barrel so the module (and its tinyld dep) can never enter the frontend bundle (guarded by `barrelGuard.test.ts`). Do not merge the two surfaces' alphabets/predicates — downstream gates key on their exact values.

6. **Database Layer** (`src/db/`):
   - `schema.ts` — Drizzle ORM table definitions (users, pages, messages, subscriptions, etc.)
   - `index.ts` — Drizzle client singleton
   - Migrations auto-generated via `drizzle-kit generate:pg`
   - 20+ tables for multi-workspace, multi-page, multi-language support

7. **Workers** (`src/workers/`):
   - **replyWorker.ts** — BullMQ worker consuming `REPLY_QUEUE`
     - Processes Facebook comments, Facebook messages, Instagram comments, Instagram messages, WhatsApp messages
     - `processMessageJob(job, label, service)` factory handles all DM platforms (FB/IG/WA)
     - Calls reply services via `MessagePlatformAdapter` interface, enqueues AI jobs if needed
     - Retries and error recovery
   - **ecommerceSyncWorker.ts** — Syncs Shopify/Salla/Zid product catalogs
   - **customerNotificationWorker.ts** — BullMQ worker consuming `customer-notifications` queue; sends SMS for order lifecycle events (confirmed, shipped, delivered, abandoned cart, review request); concurrency 10, rate limit 50/min

8. **Integrations** (`src/integrations/`):
   - **Plugin architecture** via `EcommerceIntegration` interface
   - Each integration (Shopify, Salla, ZID) implements:
     - `registerRoutes()` — OAuth callback endpoints
     - `enrichKnowledgeBase()` — product catalog enrichment
     - `claimPendingInstall()` — post-auth setup
     - `onStartup()` / `onShutdown()` — worker lifecycle
   - **Registry pattern** (`registry.ts`) — centralized integration registry

9. **Event System**:
   - **EventBus** — async event publishing (reply_sent, user_created, etc.)
   - **Sentry integration** — errors auto-logged
   - **Logging** — Fastify logger with request ID context

#### Key Files

| What | Where |
|------|-------|
| Entry point | `src/index.ts` |
| Fastify server config | `src/index.ts` (lines 66–120) |
| Routes | `src/routes/[31 files]` |
| Controllers | `src/controllers/` |
| Services | `src/services/[45+ root files, 75+ total with subdirs]` |
| DB schema | `src/db/schema.ts` |
| Drizzle client | `src/db/index.ts` |
| Middleware | `src/middleware/` |
| Workers | `src/workers/` |
| Integrations | `src/integrations/` |
| Config | `src/config/` |
| Types | `src/types/`, `src/interfaces/` |

### AI Worker (Node.js + OpenAI/Anthropic)

**Entry point**: `/Users/aliahdab/Documents/AutoReply/ai-worker/src/index.ts`
**Port**: 3002 (both development and production)
**Runtime**: Node.js 22+
**Queue consumer**: BullMQ (AI_QUEUE via Redis)

#### Architecture Patterns

1. **Job Processing Pipeline**:
   ```
   Backend enqueues AI job
     ↓ (BullMQ)
   AI Worker picks up job
     ↓
   Build context (conversation history, customer data, KB)
     ↓
   Call OpenAI API (gpt-4.1-mini or Anthropic Claude)
     ↓
   Parse + validate response
     ↓
   Cache result (Redis semantic cache)
     ↓
   Return to backend via job result
   ```

2. **Configuration** (`src/config/`):
   - OpenAI API key validation on startup
   - Queue concurrency (default 5 workers)
   - Port configuration
   - Sentry DSN for error tracking

3. **Server** (`src/server.ts`):
   - Fastify HTTP server for health checks + admin endpoints
   - Routes: `/health`, `/admin/playground` (draft + polish)
   - **Shared-secret auth**: an `onRequest` hook requires the `X-AI-Worker-Secret`
     header (constant-time compared to `AI_WORKER_SECRET`) on every route except
     `/health`. The backend attaches it to all 6 call sites via
     `backend/src/services/aiWorkerAuth.ts`. Mandatory in production (both services
     fail-fast on a missing/short secret); in dev an unset secret disables enforcement.
     This closes the "internet-exposed unauthenticated paid endpoints" gap — the
     worker's generation routes call billable OpenAI/Anthropic APIs and must only be
     driven by our backend over the internal network.

4. **Worker** (`src/worker.ts`):
   - BullMQ Worker listening to `AI_QUEUE_NAME`
   - Job data: `{ comment, language, context }`
   - Calls `openaiService.generateReply()`
   - Handles job failures with Sentry capture

5. **Services** (`src/services/`):
   - `openai.ts` — gpt-4.1-mini reply generation (thin orchestrator: the API
     call, token counting/cost estimation, retry logic, and `buildMessages`).
     Prompt construction and post-reply validation are split into the
     `src/services/reply/` module (see below).
   - `reply/` — reply-pipeline internals extracted from `openai.ts`:
     `systemPrompt.ts` (static cached prefix), `promptBuilder.ts` (system/user
     prompt construction), `replyValidator.ts` (6 post-reply safety checks as
     pure, unit-tested functions), `replyContext.ts` (shared `getKBText` /
     `resolveLanguage` / `resolveChannel`), `types.ts` (request/response contract,
     re-exported by `openai.ts` for backward compatibility).
   - `anthropic.ts` — Anthropic Claude integration (alternative provider)
   - Providers (`src/services/providers/`) — provider abstraction layer

   **Per-customer model override:** backend's `aiModelResolver.getModelForUser(userId)`
   reads `settings.ai_model` (allowlisted in `packages/shared/ALLOWED_AI_MODELS`,
   silent fallback to `DEFAULT_AI_MODEL` on miss/invalid). Resolved model is
   forwarded to the ai-worker `/generate` route only when non-default — the
   ai-worker then routes through the provider abstraction. Resolver result is
   LRU-cached (60s TTL) so the lookup costs nothing per reply. The cache key in
   `services/ai.ts` includes model, so two workspaces on different models do
   not share cached replies.

   **Known limitations:**
   - E-commerce tool-loop replies (`/generate-with-tools`) still use the
     default model regardless of override; threading the override through
     tool calls requires provider-abstraction support for OpenAI function
     calling and is deferred.
   - The allowlist is **OpenAI-only.** The ai-worker has a `ClaudeAdapter`,
     but `ANTHROPIC_API_KEY` is not present in production env files
     (`env/ai.env` lacks the entry; the running container confirms
     `ANTHROPIC_API_KEY=MISSING`). The pre-existing circuit-breaker
     failover-to-Claude path in `services/ai.ts` is also affected and
     does not actually fail over today — fix that separately by
     provisioning the key and adding a real Anthropic integration test.

6. **Prompt System** (v19 — current):
   - **System prompt** — role definition, behavior rules, safety guidelines
   - **User prompt** — comment text + context + KB + customer data
   - **Instructions**:
     - Respond in customer's language
     - Follow conversation style (professional, casual, enthusiastic)
     - Detect angry customers (5-point escalation trigger)
     - Avoid price hallucinations (only quote KB)
     - Keep responses concise (200 chars avg)
   - **Context** — last 10 messages, customer name, returning status, KB excerpt

7. **Caching**:
   - **Exact cache** — scoped by `kbActiveVersion`, `postMessage`, `replyStyle`, `customerContext`
   - **Semantic cache** — skipped when `customerContext` present (personalized replies need fresh generation)
   - Cache key hash: `md5(concat(keys))`

8. **Error Handling**:
   - OpenAI API errors → Sentry capture + job retry
   - Validation errors → UnrecoverableError (no retry)
   - Graceful shutdown: close queue, flush Sentry

#### Key Files

| What | Where |
|------|-------|
| Entry point | `src/index.ts` |
| Server setup | `src/server.ts` |
| Worker processor | `src/worker.ts` |
| OpenAI service (orchestrator) | `src/services/openai.ts` |
| Prompt building | `src/services/reply/promptBuilder.ts` + `reply/systemPrompt.ts` |
| Post-reply validation | `src/services/reply/replyValidator.ts` |
| Config | `src/config/` |
| Types | `src/types/` |

### Shared Package (`@jawab24/shared`)

**Entry point**: `/Users/aliahdab/Documents/AutoReply/packages/shared/src/index.ts`
**Purpose**: Shared types, constants, interfaces across backend + ai-worker + frontend

#### What's Shared

1. **Queue Contracts**:
   - `REPLY_QUEUE_NAME`, `AI_QUEUE_NAME` — queue identifiers
   - `ReplyJobData` — job schema for reply processing
   - `AIJobData` — job schema for AI generation
   - `ReplyJobResult`, `AIJobResult` — result schemas

2. **Event Types**:
   - `SSE_EVENTS` — Server-Sent Events (reply status, admin actions)
   - Event payloads for real-time UI updates

3. **Enums & Constants**:
   - `ReplyMethod` — 'template' | 'ai' | 'away' | 'escalated'
   - `PagePlatform` — 'facebook' | 'instagram' | 'tiktok'
   - `IntegrationPlatform` — 'shopify' | 'salla' | 'woocommerce'

4. **Type Definitions**:
   - `User`, `Page`, `Message`, `Comment`, `Rule`, `Template`
   - `KBEntry`, `Embedding` — Knowledge Base
   - `Subscription`, `Plan` — Payments
   - `Workspace` — Multi-tenant isolation

5. **Utility Functions**:
   - `ecommerce-tools.ts` — product parsing, KB enrichment helpers
   - `utils/` — locale detection, formatting, validation

6. **API Request Schemas (Zod, single source of truth)**:
   - `schemas/settings.ts` — `UpdateSettingsSchema` for `PUT /api/settings`.
     The backend route converts it to a Fastify JSON schema with
     `zod-to-json-schema`; the backend controller re-validates as defense
     in depth; the frontend `settings.tsx` save handler uses it to
     pre-validate before sending (no more round-trip 400s for known-bad
     payloads). Adding a new field requires changing the schema in this
     one place — Fastify, the controller, and the frontend pre-validator
     all pick it up automatically.

## Data Flow

### User Sends Comment on Facebook (Happy Path)

```
1. Customer comments on page post
   ↓
2. Facebook webhook → Backend POST /webhook
   ↓
3. webhookController validates signature, parses event
   ↓
4. Enqueues job: { pageId, commentId, postId, text, senderId }
   ↓
5. replyWorker picks up job
   ↓
6. replyService.processComment():
   - Load page config (rules, templates, KB)
   - Check business hours
   - Try template rules (keyword matching)
   - If no match → enqueue AI job, return "generating..." placeholder
   ↓
7. AI job in queue:
   - openaiService builds context (KB, history, customer data)
   - Calls OpenAI API → "Here's the answer..."
   - Returns result to backend
   ↓
8. Backend receives AI result:
   - Validate response (safety checks, price hallucination detection)
   - Post reply via Facebook Graph API
   - Mark message as handled
   ↓
9. SSE event → Frontend: reply_sent { status: 'success', method: 'ai' }
   ↓
10. Admin sees updated comment on dashboard in real-time
```

### User Updates Rule (Dashboard)

```
1. Frontend: PUT /api/rules/:id { pattern, replyText }
   ↓
2. Backend auth middleware validates JWT + workspace
   ↓
3. rulesController.update() → rulesService.update()
   ↓
4. Drizzle ORM updates `rules` table
   ↓
5. Invalidate cache (rule count, pattern index)
   ↓
6. Return 200 OK
   ↓
7. Frontend React Query refetch updates UI
```

### Knowledge Base Enrichment (Shopify)

```
1. Admin connects Shopify store → OAuth callback
   ↓
2. shopifyController.handleCallback():
   - Create `integration_connection` record
   - Call shopifyIntegration.claimPendingInstall()
   - Enqueue product sync job
   ↓
3. ecommerceSyncWorker:
   - Fetch products from Shopify GraphQL API
   - Chunk into embeddings (~500 chars each)
   - Store in pgvector (PostgreSQL vector column)
   ↓
4. Next time reply is generated for this page:
   - replyService retrieves top-k similar products
   - Injects into system prompt: "Available products: ..."
   - AI uses KB for grounding answers
```

### Authentication & Multi-Workspace (Web)

**Identity model:** phone number = identity. Facebook/Instagram/WhatsApp = channels connected after login.

**Phone OTP Login (primary, `PHONE_AUTH_ENABLED=true`):**
```
1. User enters phone number (E.164) on login page
   ↓
2. POST /auth/phone/request → OTP generated, bcrypt-hashed, stored in otpCodes table, sent via Vonage SMS
   ↓
3. User enters 6-digit code → POST /auth/phone/verify
   ↓
4. otpService verifies hash (timing-safe) → findOrCreateUserByPhone() upsert
   ↓
5. authController issues JWT (15min access) + refresh token (60 days), sets HttpOnly cookies
   ↓
6. Subsequent requests:
   - Cookie auto-sent by browser
   - auth middleware validates JWT payload, extracts userId
   - X-Workspace-Id header scopes all DB queries
```

**Facebook OAuth (secondary):**
```
1. User clicks "Login with Facebook" → Facebook OAuth redirect
   ↓
2. /auth/callback exchanges code → authController creates session
   ↓
3. If PHONE_AUTH_ENABLED and user.phone is null → redirect to /auth/phone-collect
   ↓
4. POST /auth/phone/link (authenticated) links phone to existing account
```

**Multiple workspaces (server-authoritative selection):**

Users can belong to multiple workspaces (own + invited). The server is the source of truth for *which workspace a user lands in* on login — not the device's persisted state. Mirrors Linear/Vercel/Notion's pattern.

```
┌──────────────────────────────────────────────────────────────────┐
│  users.last_active_workspace_id (uuid, nullable, FK SET NULL)    │
│  ↑ persisted choice; survives device changes and reinstalls      │
└──────────────────────────────────────────────────────────────────┘
       ↓ read by
┌──────────────────────────────────────────────────────────────────┐
│  workspaceService.resolveDefaultWorkspaceId(userId)              │
│  1. Stored last-active (membership-checked) → return             │
│  2. Heuristic: most connected pages → owner-first → oldest       │
│  3. Zero memberships → null (caller maps to NO_WORKSPACE 404)    │
└──────────────────────────────────────────────────────────────────┘
       ↓ called by
┌──────────────────────────────────────────────────────────────────┐
│  Auth response: defaultWorkspaceId field on every login path     │
│  Middleware fallback: when no X-Workspace-Id header              │
│  Invite acceptance: also writes last-active for the new joiner   │
└──────────────────────────────────────────────────────────────────┘
       ↓ honored by
┌──────────────────────────────────────────────────────────────────┐
│  Frontend store: setWorkspaces({ defaultWorkspaceId }) overrides │
│  any persisted activeWorkspaceId on login. Mid-session refreshes │
│  preserve user intent.                                           │
└──────────────────────────────────────────────────────────────────┘
       ↓ writes back via
┌──────────────────────────────────────────────────────────────────┐
│  PATCH /me/last-workspace { workspaceId }                        │
│  Membership-checked; throws WorkspaceAccessDeniedError → 403.    │
│  Called fire-and-forget by setActiveWorkspace so other devices   │
│  and future logins converge on the chosen workspace.             │
└──────────────────────────────────────────────────────────────────┘
```

**Conflict-aware page-connect UX:** when `pages.syncFromFacebook` finds a page in another workspace AND the user is already a member of that holding workspace (e.g. invitee re-syncing pages already in the inviter's workspace), the response includes `alreadyMemberOf: [{ workspaceId, workspaceName, role, pageName }]` so the client can render an actionable *"Switch to ‹X›"* affordance instead of the misleading *"ask the owner to invite you"* warning.

**Mobile workspace switcher:** rendered in the More-tab `MobileMenuOverlay` when `workspaces.length > 1`. Closes the gap that previously left mobile multi-workspace users with no way to switch (the desktop sidebar switcher is `hidden lg:block`).

**Edge cases handled:**
- `last_active_workspace_id` references a deleted workspace → FK `ON DELETE SET NULL` empties the column, resolver falls through to heuristic
- User was removed from the workspace they had pinned → resolver's membership check fails, falls through
- Concurrent switch from two devices → last write wins (acceptable for current scale)
- Mobile clients on old builds (pre-1.2.0) ignore `defaultWorkspaceId` and use their existing logic — no break, they just don't get the override until they update

**Files:**
- Schema: [`backend/src/db/schema.ts`](backend/src/db/schema.ts) (`users.lastActiveWorkspaceId`)
- Service: [`backend/src/services/workspace.ts`](backend/src/services/workspace.ts) (`resolveDefaultWorkspaceId`, `setLastActiveWorkspace`, `WorkspaceAccessDeniedError`)
- Middleware: [`backend/src/middleware/workspace.ts`](backend/src/middleware/workspace.ts) (delegates to resolver)
- Endpoint: [`backend/src/routes/workspace.ts`](backend/src/routes/workspace.ts) (`PATCH /me/last-workspace`)
- Frontend store: [`frontend/src/lib/store.ts`](frontend/src/lib/store.ts) (`setWorkspaces` defaultWorkspaceId override, `setActiveWorkspace` PATCH)
- Mobile switcher: [`frontend/src/components/layout/DashboardLayout.tsx`](frontend/src/components/layout/DashboardLayout.tsx) (`MobileMenuOverlay`)

## Key Abstractions

### 1. Service Layer Pattern

```typescript
// Backend: reply service (business logic only)
export class ReplyService {
  async processComment(pageId, commentId, text, senderId) {
    // 1. Load page config + templates
    // 2. Check business hours
    // 3. Try templates
    // 4. Enqueue AI if needed
    // 5. Post reply
    // 6. Log metrics
  }
}
```

**Benefits**:
- Testable (mock DB, APIs)
- Reusable (called from webhook + admin retry)
- Composable (services call other services)

### 2. Middleware Chain (Backend)

```typescript
fastify.use(errorHandler);         // Catch all errors
fastify.use(requestIdMiddleware);  // Add request ID
fastify.use(geoMiddleware);        // Add geolocation
fastify.use(authMiddleware);       // Validate auth
fastify.use(workspaceMiddleware);  // Scope workspace
```

**Benefits**:
- Separation of concerns (auth ≠ business logic)
- Request enrichment (requestId, user, workspace)
- Error handling in one place

### 3. Integration Registry (Backend)

```typescript
// plugins/demo.ts, plugins/shopify.ts, plugins/salla.ts
// register(integrationRegistry);
integrationRegistry.register(shopifyIntegration);
integrationRegistry.register(sallaIntegration);

// Index.ts:
for (const integration of integrationRegistry.getEnabled()) {
  await integration.registerRoutes(fastify);
  await integration.onStartup(logger);
}
```

**Benefits**:
- Decoupled integration code
- Easy to enable/disable via env var
- Plugin architecture scales to 10+ platforms

### 4. Zustand Stores (Frontend)

```typescript
// Persistent, hydration-safe
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      activeWorkspaceId: null,
      setUser: (user) => set({ user }),
    }),
    { name: 'auth-store' }
  )
);
```

**Benefits**:
- Single source of truth for app state
- localStorage persistence
- Hydration guard prevents SSR mismatch

### 5. React Query (Frontend Data)

```typescript
// Automatic caching + refetch
const { data: comments } = useQuery({
  queryKey: ['comments', pageId],
  queryFn: () => api.get(`/comments?page=${pageId}`),
  staleTime: 5 * 60 * 1000,
});
```

**Benefits**:
- Background refetch
- Automatic retry
- Stale-while-revalidate pattern

### 6. BullMQ Queue Pattern

```typescript
// Backend enqueues:
await replyQueue.add('comment', { pageId, commentId, ... });

// Worker processes:
worker.process(async (job) => {
  const result = await replyService.processComment(job.data);
  return result; // Automatically stored
});
```

**Benefits**:
- Async processing (webhook responds immediately)
- Retry logic built-in
- Job status tracking
- Scales horizontally (multiple workers)

### 7. Fastify Plugins (Backend)

```typescript
// plugins/demo.ts — runs when DEMO_MODE=true
// plugins/swagger.ts — OpenAPI documentation
// plugins/[integration].ts — e-commerce integrations

export default async function demoPlugin(fastify) {
  fastify.get('/auth/demo', async () => ({
    token: generateDemoToken(),
  }));
}
```

**Benefits**:
- Conditional features (demo mode off in prod)
- Modular code organization
- Self-documenting routes via Swagger

### 8. Drizzle ORM (Backend DB)

```typescript
// Schema definition
export const users = pgTable('users', {
  id: uuid().primaryKey(),
  email: text().unique(),
  workspaceId: uuid().notNull(),
  ...
});

// Query with auto-typing
const user = await db.select().from(users).where(eq(users.id, userId));
```

**Benefits**:
- Type-safe queries (no stringly-typed SQL)
- Auto-generated migrations
- Composable filters

## Entry Points

| Service | Entry File | Port | Mode | Command |
|---------|-----------|------|------|---------|
| **Frontend** | `frontend/src/pages/_app.tsx` | 3001 | Next.js | `npm run dev` |
| **Backend** | `backend/src/index.ts` | 3000 | Fastify HTTP | `npm run dev` |
| **AI Worker** | `ai-worker/src/index.ts` | 3002 | Node.js + BullMQ | `npm run dev` |
| **Shared** | `packages/shared/src/index.ts` | — | Type definitions | `npm run build` |

---

## High-Level Request Flow Summary

```
User Action (web/mobile)
  ↓
Frontend React Component
  ↓
Axios API call (with auth + CSRF)
  ↓
Backend Middleware (auth, workspace, error handler)
  ↓
Route → Controller → Service
  ↓
DB Query (Drizzle ORM + PostgreSQL)
  ↓
If async: Enqueue to BullMQ
  ↓
Return response (200/400/500)
  ↓
Frontend React Query cache update
  ↓
UI re-render

For AI replies:
Backend enqueues → AI Worker reads → OpenAI API → Result cached → Backend checks cache → Post reply → SSE event to dashboard
```

---

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS, Capacitor 8 | Web + mobile UI |
| **Backend** | Fastify 5, Drizzle ORM, PostgreSQL, BullMQ, Redis | API + job queue + DB |
| **AI Worker** | Node.js, Fastify, OpenAI SDK, BullMQ | AI generation |
| **Shared** | TypeScript, npm workspaces | Types + constants |
| **Auth** | JWT, HttpOnly cookies, CSRF tokens | Session management |
| **Monitoring** | Sentry, Fastify logger, EventBus | Error tracking + observability |
| **Deployment** | Docker, GitHub Actions, Blue-green deployment | CI/CD |
