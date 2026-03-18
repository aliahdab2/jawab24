# Technology Stack

## Runtime & Language
- **Language**: TypeScript 5.6.0
- **Runtime**: Node.js 22.0.0+ (workspaces monorepo)
- **Package Manager**: npm with workspace support
- **TypeScript Compilation**: tsc (frontend), tsc (backend), tsc (ai-worker)

## Frontend
- **Framework**: Next.js 15.5.12 with React 19.0.0
- **Styling**: Tailwind CSS 3.4.0 + RTL support via `tailwindcss-rtl`
- **Mobile**: Capacitor 8.0.0 (iOS + Android)
- **State Management**: Zustand 5.0.0
- **HTTP Client**: Axios 1.7.0 + React Query 5.0.0
- **UI Components**: Custom components + Lucide React icons (0.468.0)
- **Animations**: Framer Motion 12.36.0
- **Content**: React Markdown 10.1.0 + Remark GFM 4.0.1
- **Notifications**: Sonner 1.4.0 (toast)
- **Internationalization**: next-intl 4.8.3 (Arabic + English)
- **Error Tracking**: Sentry NextJS 10.35.0
- **Authentication**: @capacitor-community/facebook-login 8.0.0
- **Payments**: @stripe/stripe-js 2.4.0
- **Device APIs**: Capacitor plugins (keyboard, network, preferences, push-notifications, status-bar, haptics)
- **Storage**: capacitor-secure-storage-plugin 0.13.0
- **Testing**: Vitest 3.0.0, @testing-library/{react, dom, jest-dom}
- **E2E Testing**: Playwright 1.58.1
- **Linting**: ESLint 9.0.0 + TypeScript support
- **Mobile Builds**: Capacitor CLI 8.0.2

## Backend
- **Framework**: Fastify 5.7.4
- **HTTP Plugins**: @fastify/{cors, helmet, compress, cookie, rate-limit, swagger, swagger-ui}
- **Database ORM**: Drizzle ORM 0.29.3 with PostgreSQL
- **Database Migrations**: Drizzle-kit 0.20.13
- **Database Client**: postgres 3.4.3 (native driver)
- **Cache/Queue**: Redis via ioredis 5.8.2
- **Job Queue**: BullMQ 5.66.4 (job scheduling)
- **AI/LLM**: OpenAI SDK 6.27.0 (pinned exact version for stability)
- **Payments**: Stripe 14.11.0
- **Authentication**: JWT (custom), Facebook OAuth
- **Error Tracking**: Sentry Node 10.35.0
- **Push Notifications**: Firebase Admin SDK 13.6.1
- **Geolocation**: geoip-lite 1.4.10
- **Schema Validation**: Zod 3.25.76 + zod-to-json-schema 3.25.1
- **API Documentation**: OpenAPI/Swagger via Fastify plugins
- **Testing**: Vitest 3.0.0 (unit + integration)
- **Development**: ts-node-dev 2.0.0, ts-node 10.9.2
- **Linting**: ESLint 9.0.0 + TypeScript support
- **Compression**: @fastify/compress (gzip, deflate, brotli)

## AI Worker
- **Framework**: Fastify 5.7.4
- **LLM Providers**:
  - **Primary**: OpenAI 6.27.0 (gpt-4.1-mini, pinned exact version)
  - **Fallback/Playground**: Anthropic SDK 0.78.0 (Claude models)
- **Job Queue**: Redis via ioredis 5.3.2 + BullMQ 5.66.4
- **Error Tracking**: Sentry Node 10.35.0
- **HTTP Plugins**: @fastify/{cors, rate-limit}
- **Testing**: Vitest 3.0.0
- **Development**: ts-node-dev 2.0.0
- **Linting**: ESLint 9.0.0

## Shared Packages
- **Location**: `packages/shared/` (compiled TypeScript)
- **Exports**: Shared types, constants, enums across frontend/backend/ai-worker
- **Examples**: `DEFAULT_AI_MODEL`, subscription plan types, API request/response schemas
- **Build Process**: Compiled via `npm run build --workspace=@jawab24/shared` (postinstall hook)

## Database
- **Engine**: PostgreSQL 15 with pgvector extension (for embeddings/semantic search)
- **ORM**: Drizzle ORM 0.29.3
- **Migration Tool**: Drizzle-kit 0.20.13
- **Migrations Location**: `/backend/migrations/` (auto-generated from schema)
- **Schema File**: `/backend/src/db/schema.ts` (single source of truth)
- **Vector Search**: pgvector 15 for RAG/semantic similarity
- **Connection**: Native PostgreSQL driver via `postgres` package (not pg)
- **Connection Pool**: Built-in via postgres driver

## Build & Dev Tools
- **Bundler**: Next.js (frontend), Fastify (backend/ai-worker)
- **Linter**: ESLint 9.0.0 (all workspaces)
- **Type Checker**: TypeScript tsc (all workspaces)
- **Unit Testing**: Vitest 3.0.0 (all workspaces)
- **E2E Testing**: Playwright 1.58.1 (frontend only)
- **Code Coverage**: @vitest/coverage-v8 3.0.0
- **Git Hooks**: Husky 9.1.7 + lint-staged 15.5.2
- **Bundle Analysis**: @next/bundle-analyzer (optional)
- **Development Server**: Next.js dev (port 3001), Fastify dev (ports 3000, 3002)
- **Documentation**: OpenAPI/Swagger auto-generated from Fastify routes

## Mobile
- **Framework**: Capacitor 8.0.0 (web-native bridge)
- **Platforms**: iOS (Xcode) + Android (Gradle)
- **Build Output**: Static export from Next.js to `out/` directory
- **App ID**: com.jawab24.app
- **Config Location**: `/frontend/capacitor.config.ts`
- **Android WebView**: Chrome-based, debugging disabled in production
- **iOS Deployment**: Minimum iOS support defined in Capacitor config
- **Plugins Used**:
  - Core: app, browser, keyboard, network, preferences, status-bar, splash-screen, haptics, push-notifications
  - Community: facebook-login, secure-storage
- **Native Code**: TypeScript wrappers around Capacitor APIs (no native Java/Swift code)

## Key Dependencies

| Package | Version | Purpose | Scope |
|---------|---------|---------|-------|
| Next.js | 15.5.12 | React framework + SSR/SSG | Frontend |
| React | 19.0.0 | UI library | Frontend |
| Tailwind CSS | 3.4.0 | Utility-first CSS + RTL | Frontend |
| Fastify | 5.7.4 | HTTP server (3x faster than Express) | Backend, AI Worker |
| Drizzle ORM | 0.29.3 | Type-safe SQL ORM | Backend |
| PostgreSQL | 15 | Relational database + pgvector | Infrastructure |
| Redis | 7-alpine | Cache + job queue (BullMQ) | Infrastructure |
| OpenAI SDK | 6.27.0 | GPT-4.1-mini LLM provider | AI Worker, Backend (embeddings) |
| Anthropic SDK | 0.78.0 | Claude fallback + playground | AI Worker |
| Stripe | 14.11.0 | Payment processing | Backend |
| Firebase Admin | 13.6.1 | Push notifications | Backend |
| Sentry | 10.35.0 | Error tracking + performance monitoring | Backend, AI Worker, Frontend |
| Zustand | 5.0.0 | Client-side state management | Frontend |
| React Query | 5.0.0 | Server state management | Frontend |
| Capacitor | 8.0.0 | Cross-platform mobile framework | Frontend |
| Vitest | 3.0.0 | Fast unit test runner | All workspaces |
| Playwright | 1.58.1 | E2E test automation | Frontend |
| ESLint | 9.0.0 | Code quality linting | All workspaces |
| TypeScript | 5.6.0 | Type safety | All workspaces |
| ts-node-dev | 2.0.0 | Dev server (TypeScript reload) | Backend, AI Worker |
| BullMQ | 5.66.4 | Redis-based job queue | Backend, AI Worker |
| Zod | 3.25.76 | Runtime schema validation | Backend |

## Environment Configuration

### Frontend (.env files)
- `NEXT_PUBLIC_API_URL` - API base URL
- `NEXT_PUBLIC_FB_APP_ID` - Facebook App ID (public)
- `NEXT_PUBLIC_SITE_URL` - Canonical site URL
- `NEXT_PUBLIC_SENTRY_DSN` - Sentry DSN (public)
- `NEXT_PUBLIC_GA_ID` - Google Analytics ID (public)
- `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` - Google Search Console verification

### Backend (.env/backend.env)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - Redis config
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` - Facebook OAuth
- `FACEBOOK_WEBHOOK_VERIFY_TOKEN` - Webhook security
- `FACEBOOK_TOKEN_ENCRYPTION_KEY` - Token encryption (AES-256-GCM)
- `JWT_SECRET` - JWT signing key
- `OPENAI_API_KEY` - OpenAI API key (for embeddings)
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` - Stripe payment
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_HOST_NAME` - Shopify OAuth
- `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET` - Salla e-commerce
- `SENTRY_DSN` - Sentry error tracking
- `AI_SERVICE_URL` - AI worker endpoint
- `FRONTEND_URL` - Frontend base URL
- `DEMO_MODE_ENABLED` - Demo mode flag

### AI Worker (.env/ai.env)
- `OPENAI_API_KEY` - OpenAI API key (primary LLM)
- `ANTHROPIC_API_KEY` - Anthropic API key (Claude fallback)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - Redis config
- `SENTRY_DSN` - Sentry error tracking

## Infrastructure
- **Containerization**: Docker (multi-stage builds)
- **Container Orchestration**: Docker Compose (development/production blue-green)
- **Reverse Proxy**: Nginx (production, not in this repo)
- **Database**: pgvector/pgvector:pg15 Docker image
- **Cache**: redis:7-alpine Docker image
- **Deployment**: Blue-green deployment via Docker Compose
- **Logging**: JSON-file driver with rotation (max 10m per file)
- **Health Checks**: HTTP + Redis ping (container-level)
- **Network**: Docker bridge network (jawab24-network)
- **Volumes**: Named volumes for postgres-data + redis-data persistence

## CI/CD
- **Provider**: GitHub Actions
- **Workflows**: `.github/workflows/`
  - `ci.yml` - Linting, tests, type-checking
  - `deploy.yml` - Build Docker images, push to registry, deploy
  - `smoke-tests.yml` - Post-deploy health checks
  - `rollback.yml` - Automated rollback on failure
- **Pre-deploy Script**: `./scripts/pre-deploy-check.sh` (linting + tests locally)

## Monitoring & Observability
- **Error Tracking**: Sentry (DSN configured per environment)
- **Performance Monitoring**: Sentry Performance (tracing enabled)
- **Logging**: Fastify built-in logger (JSON structured logs)
- **Health Checks**: HTTP endpoints (`/health` on port 3000/3002)
- **Request Tracking**: X-Request-ID header propagation
- **Database Monitoring**: Drizzle-kit check & validate commands
- **Circuit Breaker**: Custom circuit breaker for ai-worker HTTP calls

---

## Architecture Notes
- **Monorepo**: npm workspaces (shared, frontend, backend, ai-worker)
- **API Style**: RESTful JSON (Fastify) + WebSockets (Server-Sent Events)
- **Authentication**: JWT (issued on Facebook login, persisted in secure storage)
- **Database Transactions**: Drizzle transaction support for consistency
- **Caching Strategy**: Redis for sessions, job queue, rate-limit counters
- **Type Safety**: Full TypeScript across all services (no `any` types)
- **i18n**: next-intl for frontend (39 namespace files per language)
