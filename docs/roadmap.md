# Technical Roadmap & Architecture Evolution

> **Last updated**: 2026-02-17

This document outlines the technical infrastructure state and planned improvements for the Jawab24 platform.

---

## Completed Infrastructure

### 1. Asynchronous Job Queue System
**Status:** Done
- **Stack:** BullMQ v5 + Redis
- **Files:** `backend/src/lib/queue.ts`, `backend/src/workers/replyWorker.ts`, `backend/src/workers/shopifySyncWorker.ts`
- 3 retry attempts with exponential backoff
- 60-second job retention
- Two workers: auto-reply processing + Shopify product sync

### 2. Structured Logging
**Status:** Done
- **Stack:** Pino (built-in with Fastify 5)
- **Files:** `backend/src/types/logger.ts`, configured in `backend/src/index.ts`
- Configurable log levels via `config.logLevel`
- Request serializers capturing method, URL, headers, hostname, IP
- Custom logger adapters for dependency injection in services

### 3. Rate Limiting
**Status:** Done
- **Stack:** Dual-layer — `@fastify/rate-limit` (global) + custom Redis sliding window (business logic)
- **Files:** `backend/src/services/protection/rate-limiter.ts`
- Comments: 5/min per user per page
- Messages: 10/min per user per page
- Fail-open strategy (allows requests if Redis is down)

### 4. Security Headers
**Status:** Done
- **Stack:** `@fastify/helmet` v13
- X-Frame-Options, X-Content-Type-Options, and other standard headers enabled
- CSP disabled for API-only backend (no HTML served)

### 5. Error Tracking
**Status:** Done
- **Stack:** Sentry v10
- **Files:** `backend/src/lib/sentry.ts`, `frontend/next.config.js`
- Production: 10% trace sample rate, filtered noise (rate limits, connection errors)
- Development: 100% trace rate, no events unless `SENTRY_DEV_ENABLED=true`
- Frontend: source maps uploaded in production, hidden from users

### 6. Semantic Caching
**Status:** Done
- **Stack:** PostgreSQL + pgvector (cosine similarity)
- **Files:** `backend/src/services/kb/semantic-cache.ts`
- 93% similarity threshold for cache hits
- Scoped by pageId, intent, and KB version (auto-invalidates on KB changes)
- 7-day TTL with automatic expiration
- Async hit count tracking for analytics

### 7. E2E Testing
**Status:** Done (11 test suites)
- **Stack:** Playwright
- **Coverage:** comments, dashboard, landing, login, messages, pages, payment, pricing, rules, settings, templates
- **Directory:** `frontend/e2e/`

---

## Planned Improvements

### 8. Log Aggregation & APM
**Priority:** Medium
**Context:** Pino logging is in place but logs are per-container. No centralized view across backend, ai-worker, and frontend.
**Next steps:**
- Add request ID correlation across services
- Evaluate log aggregator (ELK, Datadog, or Grafana Loki)
- Add APM traces to identify slow queries and AI response times

### 9. CSP for Frontend
**Priority:** Medium
**Context:** Backend API doesn't serve HTML so CSP is N/A there. Frontend (Next.js) serves HTML and would benefit from strict CSP.
**Next steps:**
- Define allowed sources for scripts, styles, images, and fonts
- Use nonces for inline scripts if needed
- Configure via Next.js `headers()` in `next.config.js`

### 10. Database Connection Pooling & Monitoring
**Priority:** Medium
**Context:** As concurrent users grow, database connection management becomes critical.
**Next steps:**
- Monitor connection pool utilization
- Add query duration logging for slow query detection
- Consider PgBouncer for connection pooling at scale

### 11. WhatsApp Infrastructure (supports Phase 5)
**Priority:** High (when Phase 5 starts)
**Context:** WhatsApp integration requires new webhook handlers, message queue types, and template message support.
**Next steps:**
- New `whatsapp_message` job type in BullMQ queue
- Webhook receiver for Meta WhatsApp Business API
- Template message management (Meta requirement for first contact)
- 24-hour messaging window enforcement

### 12. Team & Multi-Tenancy Infrastructure (supports Phase 6)
**Priority:** Low
**Context:** Current architecture is single-user. Team features need authorization layer changes.
**Next steps:**
- `team_members` table with role-based access (admin/agent)
- Row-level security or middleware-based authorization
- Conversation assignment and agent activity tracking

### 13. Monorepo Build Optimization
**Priority:** Low
**Context:** Currently using npm workspaces. Build times are acceptable but will grow with codebase.
**When to act:** When full rebuild exceeds 3 minutes or CI costs become a concern.
**Options:** Turborepo (simple, caching) or Nx (advanced dependency graph)

### 14. Visual Regression Testing
**Priority:** Low
**Context:** E2E functional coverage is good (11 suites), but RTL + mobile + landscape UI can easily regress visually.
**Next steps:**
- Add Playwright visual comparison snapshots for key pages
- Cover: RTL layout, landscape mode, safe area rendering
- Run on CI for PR checks

---

## Architecture Overview

```
Client (Next.js + Capacitor)
    |
    v
Fastify 5 API (backend)
    |--- @fastify/helmet (security headers)
    |--- @fastify/rate-limit (global rate limiting)
    |--- @fastify/compress (brotli/gzip)
    |--- @fastify/cors
    |--- @fastify/cookie
    |--- @fastify/swagger (API docs)
    |
    |--- Drizzle ORM ---> PostgreSQL + pgvector
    |--- Redis <--- BullMQ job queue
    |--- Sentry (error tracking)
    |
    v
AI Worker (OpenAI integration)
    |--- Semantic cache (pgvector cosine similarity)
    |--- Knowledge Base retrieval (RAG)
    |--- Arabic normalization + language detection
```
