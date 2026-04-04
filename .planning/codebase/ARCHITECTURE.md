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
├── backend/            # Express + Fastify API server
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
        │   Backend (Express + Fastify)  │ :3000
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
     - Public instance: for unauth endpoints
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
   - `workspace.ts` — multi-workspace isolation
   - `geo.ts` — geolocation via MaxMind (for compliance checks, sanctioned countries)
   - `requestId.ts` — unique request ID for tracing

3. **Route Organization** (`src/routes/`):
   - **25 route files** (auth, messages, comments, rules, templates, payments, etc.)
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
   - Subdomain services:
     - `kb/` — Knowledge Base (embedding, retrieval, semantic cache)
     - `reply/` — Reply generation pipeline (context, formatting, quality checks)
     - `protection/` — Safety rules (price hallucination detection, angry customer alerts)

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
   - **ecommerceSyncWorker.ts** — Syncs Shopify/Salla product catalogs
   - **shopifySyncWorker.ts** — Shopify-specific sync logic

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
| Routes | `src/routes/[25 files]` |
| Controllers | `src/controllers/` |
| Services | `src/services/[30+ files]` |
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

4. **Worker** (`src/worker.ts`):
   - BullMQ Worker listening to `AI_QUEUE_NAME`
   - Job data: `{ comment, language, context }`
   - Calls `openaiService.generateReply()`
   - Handles job failures with Sentry capture

5. **Services** (`src/services/`):
   - `openai.ts` — gpt-4.1-mini reply generation
     - Prompt engineering (system role, user prompt)
     - Token counting, cost estimation
     - Retry logic for API failures
   - `anthropic.ts` — Anthropic Claude integration (alternative provider)
   - Providers (`src/services/providers/`) — provider abstraction layer

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
| OpenAI service | `src/services/openai.ts` |
| Prompt building | `src/services/openai.ts` (lines 80–150) |
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

**Multiple workspaces:**
```
- Frontend: useAuthStore.activeWorkspaceId
- Backend middleware: all queries filtered by workspace_id
```

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
