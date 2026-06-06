# Directory Structure

## Root Layout

```
AutoReply/
├── .github/                    # CI/CD workflows (GitHub Actions)
├── .planning/                  # Architecture docs, roadmaps, decisions
├── ai-worker/                  # AI generation worker service (Node.js)
├── backend/                    # Main API server (Fastify)
├── data/                       # Development data, seed files
├── docs/                       # User documentation, guides
├── env/                        # Environment examples (.env.example)
├── frontend/                   # Web + mobile app (Next.js + Capacitor)
├── marketing/                  # Marketing website content
├── nginx/                      # Nginx reverse proxy config
├── packages/                   # Monorepo packages
│   └── shared/                 # @jawab24/shared (types, constants)
├── scripts/                    # Utility scripts (deploy, db, testing)
├── node_modules/               # Root-level deps (workspace)
├── .env.example                # Environment template
├── .gitignore
├── .lighthouserc.json          # Lighthouse CI config
├── docker-compose.yml          # Local dev stack
├── package.json                # Workspace root
└── README.md
```

---

## Frontend Structure

**Location**: `/frontend`

### Directory Tree

```
frontend/
├── src/
│   ├── __tests__/              # Unit tests (pages, components)
│   ├── components/
│   │   ├── comments/           # Comment-related components
│   │   ├── dashboard/          # Dashboard layout + features
│   │   ├── knowledge-base/     # KB UI components (incl. VoiceRecordButton.tsx)
│   │   ├── landing/            # Landing page sections
│   │   ├── layout/             # Layouts (DashboardLayout, PublicLayout, AppShell)
│   │   ├── messages/           # Message UI + conversation
│   │   ├── notifications/      # Toast, alerts, push
│   │   ├── onboarding/         # Signup, guided tours
│   │   ├── rules/              # Rules builder, list
│   │   ├── settings/           # Settings pages (account, workspace, business hours)
│   │   ├── templates/          # Template replies editor
│   │   ├── ui/                 # Reusable primitives (Button, Modal, Input, Card, etc.)
│   │   ├── ErrorBoundary.tsx   # Error boundary for exception handling
│   │   └── [other components]
│   ├── constants/              # Global constants (BRAND_ASSETS, API endpoints)
│   ├── content/                # Static content
│   │   └── blog/               # Blog post data (markdown/TSX)
│   ├── data/                   # Seed data (pricing plans, features)
│   ├── features/
│   │   └── demo/               # Demo mode feature flag
│   ├── hooks/                  # Custom React hooks (14 hooks)
│   │   ├── index.ts            # Barrel export
│   │   ├── useAiGeneration.ts  # Draft/polish AI replies
│   │   ├── useConversationActions.ts # Mark handled, resend, replay
│   │   ├── useSSE.ts           # Server-Sent Events subscription
│   │   ├── useTheme.ts         # Dark/light/system theme
│   │   ├── useBodyScrollLock.ts # Prevent scroll in modals
│   │   ├── useMobileMessages.ts # Mobile message handling
│   │   ├── useLandscape.ts     # Landscape mode detection
│   │   ├── useSwipeToDismiss.ts # Touch gesture handling
│   │   ├── useOtpRequest.ts    # Phone OTP request flow
│   │   ├── useVoiceRecorder.ts # Voice recording for KB input
│   │   ├── useWorkspaceRole.ts # Current user's workspace role
│   │   ├── useDebounce.ts
│   │   ├── useEscapeKey.ts
│   │   └── useSwipe.ts
│   ├── i18n/                   # Internationalization (next-intl)
│   │   ├── en/                 # English translations (39 namespace files)
│   │   │   ├── common.json
│   │   │   ├── dashboard.json
│   │   │   ├── messages.json
│   │   │   ├── settings.json
│   │   │   ├── rules.json
│   │   │   ├── templates.json
│   │   │   ├── ...
│   │   │   └── [39 namespace files]
│   │   ├── ar/                 # Arabic translations (same 39 namespaces)
│   │   ├── getMessages.ts      # Static prop helpers for page-level i18n loading
│   │   └── hooks.ts            # useLanguage() hook for language switching + dateLocale
│   ├── lib/                    # Utility libraries
│   │   ├── api.ts              # Axios client (authenticated + public instances)
│   │   ├── authManager.ts      # Token refresh, 401 handling, logout
│   │   ├── api-utils.ts        # Helper functions for API requests
│   │   ├── store.ts            # Zustand stores (auth, UI)
│   │   ├── axiosRetry.ts       # Retry logic, timeout config
│   │   ├── capacitor.ts        # Capacitor.isNativePlatform() check
│   │   ├── fonts.ts            # Web fonts (DM Sans, Cairo, Tajawal, Outfit, JetBrains Mono)
│   │   ├── formatDuration.ts   # Time formatting utilities
│   │   ├── notifications.ts    # Push notification setup (Capacitor)
│   │   ├── sentryHelpers.ts    # Sentry error capture helpers
│   │   ├── zustandStorage.ts   # localStorage serialization for Zustand
│   │   ├── blog.ts             # Blog post utilities
│   │   ├── openExternalUrl.ts  # Open URLs in native browser
│   │   └── useVersion.ts       # Version info
│   ├── pages/                  # Next.js file-based routes
│   │   ├── index.tsx           # Landing page / login redirect
│   │   ├── dashboard.tsx       # Dashboard home
│   │   ├── comments.tsx        # Comments page
│   │   ├── messages.tsx        # Messages/conversations page
│   │   ├── rules.tsx           # Rules builder page
│   │   ├── templates.tsx       # Template replies page
│   │   ├── settings.tsx        # Settings main page
│   │   ├── integrations.tsx    # E-commerce integrations page
│   │   ├── pricing.tsx         # Pricing page
│   │   ├── what-is-jawab24.tsx # Product info page
│   │   ├── login.tsx           # Login page
│   │   ├── checkout.tsx        # Stripe checkout
│   │   ├── contact.tsx         # Contact form page
│   │   ├── terms.tsx           # Terms of service
│   │   ├── privacy.tsx         # Privacy policy
│   │   ├── complete-profile.tsx # Onboarding profile completion
│   │   ├── data-deletion.tsx   # GDPR data deletion
│   │   ├── admin/              # Admin panel routes
│   │   ├── auth/               # Auth-related routes
│   │   ├── blog/               # Blog post routes [slug].tsx
│   │   ├── compare/            # Comparison pages
│   │   ├── integrations/       # Integration-specific pages (Shopify, Salla)
│   │   ├── payment/            # Payment flows
│   │   ├── shopify/            # Shopify OAuth callback
│   │   ├── salla/              # Salla OAuth callback
│   │   ├── zid/                # Zid OAuth onboarding callback
│   │   ├── _app.tsx            # App wrapper, providers, SSE setup
│   │   ├── _document.tsx       # HTML document shell (dir, lang, fonts)
│   │   ├── 404.tsx             # Not found page
│   │   └── 500.tsx             # Error page
│   ├── styles/
│   │   └── globals.css         # CSS variables (colors, safe areas, semantic classes)
│   └── utils/                  # Utility functions
│       ├── locale.ts           # getOGLocale(), isRTLLocale(), getNextLocale(), etc.
│       └── [other utilities]
├── test/                       # Unit test setup
│   └── setup.ts                # Vitest setup (mock translations, browser APIs)
├── e2e/                        # Playwright E2E tests (19 spec files) — NOT under test/
│   ├── checkout.spec.ts
│   ├── comments.spec.ts
│   ├── complete-profile.spec.ts
│   ├── dashboard.spec.ts
│   ├── integrations.spec.ts
│   ├── landing.spec.ts
│   ├── login.spec.ts
│   ├── messages.spec.ts
│   ├── pages.spec.ts
│   ├── payment-flow.spec.ts
│   ├── payment.spec.ts
│   ├── pricing.spec.ts
│   ├── rules.spec.ts
│   ├── seo.spec.ts             # 39 SEO regression tests (canonical, hreflang, OG, noindex, JSON-LD)
│   ├── settings.spec.ts
│   ├── ssr.spec.ts
│   ├── team.spec.ts
│   ├── templates.spec.ts
│   └── visual.spec.ts          # Visual regression tests (macOS baselines only)
├── android/                    # Capacitor Android project
│   ├── app/
│   ├── build.gradle
│   └── gradlew
├── ios/                        # Capacitor iOS project
│   ├── App/
│   └── Podfile
├── public/                     # Static assets (robots.txt, sitemap, icons)
│   ├── robots.txt
│   ├── sitemap.xml
│   └── [images, icons]
├── .eslintrc.js                # ESLint config
├── .prettierrc                 # Prettier config
├── next.config.js              # Next.js config (i18n, image optimization, redirects)
├── vitest.config.ts            # Unit test config
├── playwright.config.ts        # E2E test config
├── capacitor.config.ts         # Capacitor mobile config
├── tsconfig.json               # TypeScript config
├── tailwind.config.js          # Tailwind CSS config (themes, safe areas)
├── postcss.config.js           # PostCSS config
└── package.json                # Frontend dependencies

### Environments
- Dev: `npm run dev` (Next.js dev server, hot reload)
- Build: `npm run build` (Next.js production build — Pages Router, webpack/Turbopack bundling)
- Mobile: `npm run build:mobile` (Output to `out/` for Capacitor sync)
- Test: `npm run test` (Vitest), `npm run test:e2e` (Playwright)
```

### Key Frontend File Paths

| What | Path |
|------|------|
| App wrapper | `src/pages/_app.tsx` |
| Document shell | `src/pages/_document.tsx` |
| Auth store | `src/lib/store.ts` → `useAuthStore` |
| UI store | `src/lib/store.ts` → `useUIStore` |
| API client | `src/lib/api.ts` (authenticated instance) |
| Public API | `src/lib/api.ts` (public instance) |
| Dashboard layout | `src/components/layout/DashboardLayout.tsx` |
| Styles/variables | `src/styles/globals.css` |
| i18n messages | `src/i18n/[en,ar]/[39 namespace files].json` |
| Locale utilities | `src/utils/locale.ts` |
| Custom hooks | `src/hooks/[14 hooks + index.ts barrel]` |
| Landing page | `src/pages/index.tsx` |
| Dashboard pages | `src/pages/[comments, messages, rules, templates, settings, integrations].tsx` |
| E2E tests | `e2e/[19 spec files]` (NOT under test/) |
| Unit tests | `src/**/*.test.tsx`, `test/setup.ts` |

---

## Backend Structure

**Location**: `/backend`

### Directory Tree

```
backend/
├── src/
│   ├── __tests__/              # Unit tests (services, controllers, utils)
│   ├── config/                 # Configuration
│   │   ├── index.ts            # Env variables + defaults
│   │   └── [feature configs]
│   ├── controllers/            # Request handlers (thin layer)
│   │   ├── webhook.ts          # Facebook/Instagram webhook
│   │   ├── comments.ts         # Comment CRUD
│   │   ├── messages.ts         # Message CRUD
│   │   ├── rules.ts            # Rule CRUD
│   │   ├── templates.ts        # Template CRUD
│   │   ├── settings.ts         # Workspace settings
│   │   ├── auth.ts             # OAuth, login, logout
│   │   ├── payment.ts          # Stripe REST endpoints + handleWebhook entry
│   │   ├── paymentWebhookHandlers.ts # Stripe event processing (dispatchStripeEvent)
│   │   ├── admin.ts            # Admin panel
│   │   └── [15+ more controllers]
│   ├── db/
│   │   ├── index.ts            # Drizzle client singleton
│   │   └── schema.ts           # Table definitions (20+ tables)
│   ├── integrations/           # E-commerce integrations (plugin architecture)
│   │   ├── index.ts            # Integration registry
│   │   ├── registry.ts         # EcommerceIntegration interface
│   │   ├── shopify.ts          # Shopify integration
│   │   ├── salla.ts            # Salla integration
│   │   └── zid.ts              # ZID integration
│   ├── interfaces/             # TypeScript interfaces
│   │   ├── EcommerceIntegration.ts
│   │   └── [other interfaces]
│   ├── lib/                    # Core utilities
│   │   ├── sentry.ts           # Sentry initialization
│   │   ├── redis.ts            # Redis client
│   │   ├── replyQueue.ts       # BullMQ queue helpers
│   │   ├── sseManager.ts       # Server-Sent Events broadcast
│   │   ├── eventBus.ts         # Async event publishing
│   │   ├── pipelineMetrics.ts  # Metrics collection
│   │   ├── [other utilities]
│   │   └── tenancy.ts          # Multi-workspace scoping
│   ├── middleware/             # Fastify middleware
│   │   ├── auth.ts             # JWT validation, CSRF, workspace scoping
│   │   ├── errorHandler.ts     # Centralized error handling (Sentry logging)
│   │   ├── admin.ts            # Admin-only route protection
│   │   ├── workspace.ts        # Workspace isolation
│   │   ├── geo.ts              # Geolocation (sanctioned country checks)
│   │   ├── requestId.ts        # Unique request ID injection
│   │   └── validation.ts       # Input validation
│   ├── plugins/                # Fastify plugins
│   │   ├── demo.ts             # Demo mode routes (only in DEMO_MODE=true)
│   │   ├── swagger.ts          # OpenAPI documentation
│   │   └── [integration plugins]
│   ├── routes/                 # API endpoints (25 files)
│   │   ├── health.ts           # Health check + version info
│   │   ├── auth.ts             # OAuth, login, logout, session
│   │   ├── webhook.ts          # Facebook/Instagram webhook listener
│   │   ├── messages.ts         # GET/POST messages, conversation
│   │   ├── comments.ts         # GET/POST comments, replies
│   │   ├── rules.ts            # CRUD rules
│   │   ├── templates.ts        # CRUD template replies
│   │   ├── settings.ts         # GET/PUT workspace settings
│   │   ├── pages.ts            # Linked Facebook pages
│   │   ├── posts.ts            # Facebook posts
│   │   ├── instagram.ts        # Instagram-specific endpoints
│   │   ├── ai.ts               # AI generation endpoints
│   │   ├── payment.ts          # Stripe payment intent, webhook
│   │   ├── subscriptions.ts    # Subscription management
│   │   ├── plans.ts            # Pricing plans
│   │   ├── admin.ts            # Admin dashboard (large file with multiple endpoints)
│   │   ├── analytics.ts        # Reply analytics
│   │   ├── sse.ts              # Server-Sent Events subscription
│   │   ├── workspace.ts        # Workspace creation, switching
│   │   ├── notifications.ts    # Push notification settings
│   │   ├── integrations.ts     # E-commerce integration list
│   │   ├── shopify.ts          # Shopify OAuth callback
│   │   ├── salla.ts            # Salla OAuth callback
│   │   ├── zid.ts              # Zid OAuth callback
│   │   ├── translation.ts      # Multi-language message translation
│   │   ├── geo.ts              # Geolocation endpoint
│   │   ├── version.ts          # Version info
│   │   └── waitlist.ts         # Beta waitlist signup
│   ├── services/               # Business logic (30+ files)
│   │   ├── reply/              # Core reply generation
│   │   │   ├── index.ts        # Main reply service
│   │   │   ├── nudge.ts        # Nudge reply logic
│   │   │   ├── confidence.ts   # Confidence scoring
│   │   │   └── [other reply utilities]
│   │   ├── kb/                 # Knowledge Base
│   │   │   ├── retrieval.ts    # Semantic search (pgvector)
│   │   │   ├── embedding.ts    # OpenAI embeddings
│   │   │   ├── ingestion.ts    # KB document ingestion
│   │   │   ├── chunker.ts      # Text chunking
│   │   │   ├── pgvector-store.ts # PostgreSQL vector storage
│   │   │   ├── gap-detector.ts # Find unanswered questions
│   │   │   ├── intent-detector.ts # Classify query intent
│   │   │   ├── semantic-cache.ts # Cache semantically similar queries
│   │   │   ├── category-defaults.ts # Per-category default replies
│   │   │   └── interfaces.ts   # KB types
│   │   ├── protection/         # Safety & compliance
│   │   │   ├── hallucination.ts # Price hallucination detection
│   │   │   ├── escalation.ts   # Angry customer detection
│   │   │   └── [other safety checks]
│   │   ├── comments.ts         # Comment fetching, replying
│   │   ├── messages.ts         # Message CRUD, customer context
│   │   ├── instagram.ts        # Instagram comment/message API
│   │   ├── instagramReply.ts   # Instagram-specific reply logic
│   │   ├── ecommerce.ts        # E-commerce integration utilities
│   │   ├── shopify.ts          # Shopify API client
│   │   ├── salla.ts            # Salla API client
│   │   ├── sms.ts              # Vonage SMS (phone OTP delivery)
│   │   ├── transcription.ts    # Whisper (GPT-4o-mini-transcribe) for voice messages
│   │   ├── stripe.ts           # Stripe subscription management
│   │   ├── analytics.ts        # Reply metrics + aggregation
│   │   ├── workspace.ts        # Workspace management
│   │   ├── workspaceInvite.ts  # Invite emails
│   │   ├── translation.ts      # Google Translate integration
│   │   └── [more services]
│   ├── types/                  # TypeScript type definitions
│   │   ├── index.ts            # Shared types (Logger, RequestLogger)
│   │   └── [domain-specific types]
│   ├── utils/                  # Utility functions
│   │   ├── env.ts              # Environment validation
│   │   ├── logSanitizer.ts     # Remove secrets from logs
│   │   ├── adminSetup.ts       # Admin user initialization
│   │   └── [other utilities]
│   ├── workers/                # BullMQ job processors
│   │   ├── replyWorker.ts      # Main reply processing (comments, messages, Instagram)
│   │   ├── ecommerceSyncWorker.ts # Sync products from Shopify/Salla
│   │   └── shopifySyncWorker.ts # Shopify-specific sync
│   ├── migrations/             # Drizzle migrations (auto-generated)
│   │   ├── meta/               # Migration metadata (snapshots)
│   │   └── [NNNN_migration.sql]
│   ├── index.ts                # Server entry point
│   ├── migrate.ts              # Migration runner
│   └── types.ts                # Global type definitions
├── test/                       # Test files
│   ├── setup.ts                # Vitest setup
│   ├── mocks.ts                # Mock data for tests
│   └── [test files]
├── scripts/
│   ├── validate-migrations.ts  # Check schema consistency
│   ├── manage-admin.ts         # Add/remove admin users
│   └── [other scripts]
├── .eslintrc.js
├── vitest.config.ts            # Unit test config
├── vitest.integration.config.ts # Integration test config (real Postgres)
├── tsconfig.json
├── package.json
└── README.md

### Environments
- Dev: `npm run dev` (ts-node-dev with auto-reload)
- Build: `npm run build` (tsc compilation, lint required)
- Test: `npm run test` (unit tests), `npm run test:integration` (real DB)
- DB: `npm run db:generate` (create migrations), `npm run db:push` (apply to DB)
```

### Key Backend File Paths

| What | Path |
|------|-------|
| Server entry | `src/index.ts` |
| Fastify config | `src/index.ts` (lines 66–120) |
| Config loading | `src/config/index.ts` |
| Routes | `src/routes/[~30 files]` |
| Controllers | `src/controllers/[~19 files]` |
| Services | `src/services/[~39 top-level + subdirs]` |
| DB schema | `src/db/schema.ts` |
| DB client | `src/db/index.ts` |
| Middleware | `src/middleware/[7 files]` |
| Workers | `src/workers/[3 files]` |
| Integrations | `src/integrations/[4 files: index, shopify, salla, zid]` |
| Types | `src/types/`, `src/interfaces/` |
| Utils | `src/utils/` |
| Migrations | `src/migrations/` (auto-generated) |

---

## AI Worker Structure

**Location**: `/ai-worker`

### Directory Tree

```
ai-worker/
├── src/
│   ├── __tests__/              # Unit tests
│   ├── config/                 # Configuration
│   │   └── index.ts            # Env validation, OpenAI key check
│   ├── lib/                    # Core utilities
│   │   ├── sentry.ts           # Sentry initialization
│   │   ├── redis.ts            # Redis client
│   │   └── [other utilities]
│   ├── services/               # Business logic
│   │   ├── openai.ts           # LLM orchestrator (gpt-4.1-mini): API call,
│   │   │                        # token counting, structured JSON, buildMessages
│   │   ├── reply/              # Reply-pipeline internals (extracted from openai.ts)
│   │   │   ├── systemPrompt.ts   # Static cached system prefix (prompt-cache safe)
│   │   │   ├── promptBuilder.ts  # System + user prompt construction
│   │   │   ├── replyValidator.ts # Post-reply safety checks (price/lang/self-id/...)
│   │   │   ├── replyContext.ts   # Shared getKBText / resolveLanguage / resolveChannel
│   │   │   └── types.ts          # Request/response contract (re-exported by openai.ts)
│   │   ├── ecommerceToolHandler.ts # AI agent tools for order/inventory lookup
│   │   ├── translation.ts      # AI-powered translation service
│   │   └── providers/          # Provider abstraction layer (adapter pattern)
│   │       ├── openai-adapter.ts   # OpenAI API adapter
│   │       ├── claude-adapter.ts   # Anthropic Claude adapter (tier-2 failover)
│   │       ├── index.ts            # Provider registry + generateReplyWithProvider()
│   │       └── types.ts            # LLMProvider interface + intent schema
│   ├── types/                  # TypeScript types
│   │   └── index.ts
│   ├── index.ts                # Entry point (startup, graceful shutdown)
│   ├── server.ts               # Fastify HTTP server (health checks)
│   └── worker.ts               # BullMQ worker processor
├── test/
│   └── setup.ts
├── .eslintrc.js
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── README.md

### Environments
- Dev: `npm run dev` (ts-node-dev with auto-reload)
- Build: `npm run build` (tsc compilation)
- Test: `npm run test` (unit tests)
```

### Key AI Worker File Paths

| What | Path |
|------|-------|
| Entry point | `src/index.ts` |
| Server setup | `src/server.ts` |
| Worker processor | `src/worker.ts` |
| OpenAI service | `src/services/openai.ts` |
| Config | `src/config/index.ts` |

---

## Shared Package Structure

**Location**: `/packages/shared`

### Directory Tree

```
packages/shared/
├── src/
│   ├── __tests__/              # Type tests
│   ├── index.ts                # Main exports
│   │                            # - Queue names (REPLY_QUEUE_NAME, AI_QUEUE_NAME)
│   │                            # - Job data types (ReplyJobData, AIJobData)
│   │                            # - Result types (ReplyJobResult, AIJobResult)
│   │                            # - Event types (SSE_EVENTS)
│   │                            # - Enums (ReplyMethod, PagePlatform, IntegrationPlatform)
│   │                            # - Core types (User, Page, Message, Rule, etc.)
│   ├── sse-events.ts           # Server-Sent Events constants + types
│   ├── ecommerce-tools.ts      # Product parsing, KB enrichment helpers
│   └── utils/                  # Shared utilities
│       ├── index.ts
│       ├── locale.ts           # Locale detection
│       ├── validation.ts       # Input validation
│       └── [other utils]
├── dist/                       # Compiled output (auto-generated)
├── tsconfig.json
└── package.json

### Export Summary (src/index.ts)
- Queue contracts: REPLY_QUEUE_NAME, AI_QUEUE_NAME
- Job types: ReplyJobData, AIJobData, ReplyJobResult, AIJobResult
- Event types: SSE_EVENTS enum
- Domain types: User, Workspace, Page, Message, Comment, Rule, Template, etc.
- Integration types: EcommerceIntegration, IntegrationPlatform, Subscription, etc.
- Enums: ReplyMethod, PagePlatform, PageSource, SubscriptionStatus, etc.
```

### Key Shared File Paths

| What | Path |
|------|-------|
| Main exports | `src/index.ts` |
| SSE events | `src/sse-events.ts` |
| Ecommerce tools | `src/ecommerce-tools.ts` |
| Utils | `src/utils/` |

---

## Key File Locations

| What | Where |
|------|-------|
| **API Routes** | `backend/src/routes/[~30 feature files]` |
| **API Controllers** | `backend/src/controllers/[~19 files]` |
| **API Services** | `backend/src/services/[~39 top-level + kb/, reply/, protection/ subdirs]` |
| **Database Schema** | `backend/src/db/schema.ts` |
| **Database Migrations** | `backend/src/migrations/` (auto-generated — do not edit manually) |
| **Drizzle Client** | `backend/src/db/index.ts` |
| **Components** | `frontend/src/components/[10 feature dirs + ui/]` |
| **Pages** | `frontend/src/pages/[23 top-level .tsx + subdirs: admin, auth, blog, compare, integrations, payment, shopify, salla, zid]` |
| **Custom Hooks** | `frontend/src/hooks/[14 hooks + index.ts barrel]` |
| **Stores (Zustand)** | `frontend/src/lib/store.ts` |
| **API Client** | `frontend/src/lib/api.ts` |
| **Translations EN** | `frontend/src/i18n/en/[39 namespace files]` |
| **Translations AR** | `frontend/src/i18n/ar/[39 namespace files]` |
| **Styles/Variables** | `frontend/src/styles/globals.css` |
| **E2E Tests** | `frontend/e2e/[19 spec files]` (NOT under `test/`) |
| **Unit Tests (Frontend)** | `frontend/src/**/*.test.{ts,tsx}`, `frontend/test/setup.ts` |
| **Unit Tests (Backend)** | `backend/src/**/*.test.ts`, `backend/test/setup.ts` |
| **BullMQ Workers** | `backend/src/workers/[3 files]` |
| **BullMQ Queue Helpers** | `backend/src/lib/replyQueue.ts` |
| **AI Worker** | `ai-worker/src/worker.ts` |
| **OpenAI Service** | `ai-worker/src/services/openai.ts` + `ai-worker/src/services/providers/` |
| **Integrations** | `backend/src/integrations/[4 files: index, shopify, salla, zid]` |
| **Shared Package** | `packages/shared/src/[index.ts, sse-events.ts, ecommerce-tools.ts, utils/]` |
| **Middleware** | `backend/src/middleware/[7 files]` |
| **Config Files** | `backend/src/config/`, `ai-worker/src/config/`, `frontend/next.config.js` |

---

## Naming Conventions

### Files & Directories

| Category | Pattern | Examples |
|----------|---------|----------|
| **React Components** | PascalCase, `.tsx` | `DashboardLayout.tsx`, `CommentCard.tsx`, `Button.tsx` |
| **Pages** | kebab-case, `.tsx` | `dashboard.tsx`, `complete-profile.tsx`, `what-is-jawab24.tsx` |
| **Hooks** | camelCase, `use*`, `.ts/.tsx` | `useAiGeneration.ts`, `useSSE.ts`, `useBodyScrollLock.ts` |
| **Services** | camelCase, feature-based filename, `.ts` | `comments.ts`, `messages.ts`, `shopify.ts`, `transcription.ts` |
| **Controllers** | camelCase, feature-based filename, `.ts` | `webhook.ts`, `auth.ts`, `payment.ts` |
| **Routes** | camelCase, feature-based filename, `.ts` | `webhook.ts`, `comments.ts`, `shopify.ts` |
| **Middleware** | camelCase, `.ts` | `auth.ts`, `errorHandler.ts`, `workspace.ts` |
| **Utilities** | camelCase, `.ts` | `locale.ts`, `formatDuration.ts`, `validation.ts` |
| **Types/Interfaces** | PascalCase, `.ts` | `User.ts`, `ReplyJobData.ts`, `EcommerceIntegration.ts` |
| **Tests** | matching name, `.test.tsx` / `.test.ts` | `Button.test.tsx`, `api.test.ts` |
| **Config Files** | camelCase or UPPERCASE | `next.config.js`, `vitest.config.ts`, `tailwind.config.js` |
| **Migrations** | `NNNN_description.sql` | `0001_initial_schema.sql`, `0042_add_customer_context.sql` |
| **i18n Namespaces** | kebab-case, `.json` | `common.json`, `dashboard.json`, `reply-rules.json` |

### Variables & Functions

| Type | Convention | Examples |
|------|-----------|----------|
| **Constants** | UPPER_SNAKE_CASE or PascalCase | `MAX_RETRIES`, `REPLY_QUEUE_NAME`, `BRAND_ASSETS` |
| **Variables** | camelCase | `userId`, `replyText`, `isLoading` |
| **Functions** | camelCase | `processComment()`, `enrichKnowledgeBase()`, `captureError()` |
| **Boolean vars** | `is*`, `has*`, `can*` | `isRTL`, `hasHydrated`, `canReply` |
| **Zustand stores** | `use*Store` | `useAuthStore`, `useUIStore` |
| **React Query keys** | camelCase array | `['comments', pageId]`, `['rules', workspaceId]` |
| **Enum values** | UPPER_SNAKE_CASE or camelCase | `ReplyMethod.AI`, `PagePlatform.FACEBOOK` |
| **DB table names** | snake_case, plural | `users`, `workspaces`, `pages`, `messages` |
| **DB column names** | snake_case | `created_at`, `updated_at`, `workspace_id` |

### Database Tables (20+ in `backend/src/db/schema.ts`)

| Table | Purpose |
|-------|---------|
| `users` | User accounts |
| `workspaces` | Multi-tenant workspaces |
| `pages` | Linked Facebook/Instagram pages |
| `messages` | Conversations (Facebook DM) |
| `comments` | Comments on posts |
| `rules` | Rule-based templates (keyword matching) |
| `templates` | User-created template replies |
| `integrations` | E-commerce platform connections (Shopify, Salla, Zid) |
| `subscriptions` | Subscription tiers (Free, Pro, Business) |
| `reply_logs` | Reply history + metrics |
| `embeddings` | KB vector embeddings (pgvector) |
| `escalations` | Escalated conversations |
| `analytics` | Reply analytics + aggregates |
| [15+ more tables] | Settings, auth tokens, invites, etc. |

---

## Development Setup Quick Reference

### Frontend
```bash
cd frontend
npm install
npm run dev           # Port 3001
npm run test          # Unit tests
npm run test:e2e      # Playwright tests
npm run lint
```

### Backend
```bash
cd backend
npm install
npm run dev           # Port 3000
npm run test          # Unit tests
npm run test:integration # With real DB
npm run db:generate   # Create migration
npm run db:push       # Apply to DB
npm run lint
```

### AI Worker
```bash
cd ai-worker
npm install
npm run dev           # Port 3002
npm run test          # Unit tests
npm run lint
```

### Root Monorepo
```bash
npm install           # Install all workspaces
npm run lint          # Lint all services
npm run test          # Test all services
npm run build         # Build all services
```

---

## Testing Structure

### Frontend Tests
- **Unit**: Vitest + jsdom, `frontend/src/**/*.test.{ts,tsx}`, `frontend/test/setup.ts`
- **E2E**: Playwright, `frontend/e2e/[19 spec files]` (NOT under test/)
- **Visual**: Playwright snapshots (macOS baselines only)
- **SEO**: 39 regression tests in `e2e/seo.spec.ts`

### Backend Tests
- **Unit**: Vitest, `backend/src/**/*.test.ts`, mocked DB/external APIs
- **Integration**: Vitest (real Postgres), `backend/test/[integration tests]`

### AI Worker Tests
- **Unit**: Vitest, `ai-worker/src/**/*.test.ts`, mocked OpenAI API

---

## CI/CD & Deployment

### GitHub Actions Workflows (`.github/workflows/`)
- **CI** — lint, test, build on every push
- **Deploy** — blue-green deployment to production
- **Rollback** — manual rollback script
- **Smoke Tests** — post-deploy health checks

### Build Artifacts
- **Docker images**: frontend, backend, ai-worker (separate images)
- **Next.js build**: `frontend/.next/`
- **Backend dist**: `backend/dist/` (compiled TypeScript)
- **AI Worker dist**: `ai-worker/dist/` (compiled TypeScript)

### Environment Files
- `backend/.env` — API keys, DB connection, Stripe, etc.
- `ai-worker/.env` — OPENAI_API_KEY, Redis, Sentry
- `frontend/.env.local` — Not used (config via Next.js env vars)
- `.env.example` — Template for local development
