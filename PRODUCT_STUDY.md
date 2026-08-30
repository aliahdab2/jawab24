# Jawab24 - Complete Product Study

> **Last updated**: 2026-04-15
> **Purpose**: Comprehensive reference for the entire Jawab24 product — architecture, features, data flow, and capabilities.

---

## What It Is

Jawab24 is an **AI-powered auto-reply platform for Facebook, Instagram, WhatsApp, and e-commerce stores (Shopify, Salla, Zid)**. It automatically responds to customer comments and messages 24/7 in Arabic and English, using a sophisticated 3-layer reply system. The platform also provides AI-powered lead extraction, a knowledge base with RAG, and transactional email notifications.

---

## Core Architecture

| Layer | Technology | Port | Purpose |
|-------|-----------|------|---------|
| **Frontend** | Next.js 15 + Capacitor 8 | 3001 | Web + Native mobile app |
| **Backend** | Fastify + Drizzle ORM + PostgreSQL | 3000 | API, webhooks, business logic |
| **AI Worker** | Fastify + OpenAI GPT-4o-mini | 3002 | Reply generation, translation |
| **Queue** | BullMQ + Redis | 6379 | Async job processing |
| **Search** | pgvector (PostgreSQL) | — | Semantic KB retrieval |
| **Payments** | Stripe | — | Subscriptions & billing |
| **Notifications** | Firebase FCM | — | Push notifications |

### Monorepo Structure

```
/
├── frontend/           # Next.js 15 + Tailwind + Capacitor 8
├── backend/            # Fastify + Drizzle ORM + PostgreSQL
├── ai-worker/          # Fastify + OpenAI
└── packages/
    └── shared/         # Shared TypeScript types & utilities
```

---

## The 3-Layer Reply System (Core Product)

```
Customer Comment/Message
        │
        ▼
  ┌─────────────────┐
  │ Layer 1: Post    │  Per-post keyword match → configured DM
  │ Reply            │  Fastest, cheapest, deterministic. Comments only.
  └────────┬─────────┘
           │ No match
           ▼
  ┌─────────────────┐
  │ Layer 2: Smart   │  AI-generated reply with KB context
  │ Reply (AI)       │  3-tier caching: exact → semantic → full API
  └────────┬─────────┘
           │ Fails/disabled/low confidence
           ▼
  ┌─────────────────┐
  │ Layer 3: Pending │  Flagged for human review
  │ (Human)          │  Push notification sent to merchant
  └──────────────────┘
```

### Safety Features

- **Price hallucination detection** — replaces made-up prices with safe fallback
- **Offensive content detection** — skips reply entirely
- **Low confidence detection** — flags for human review instead of auto-replying
- **Prompt injection sanitization** — 24+ regex patterns
- **Never guesses**: prices, availability, stock, delivery dates, payment terms

---

## Processing Pipelines

### Message Processing (DMs) — 20 Steps

1. Validate page exists
2. Check auto-reply enabled
3. Fetch sender name
4. Store incoming message
5. Debounce check (skip if newer message pending)
6. Handoff pause check (human took over)
7. Rate limiting (10 messages/min per sender per page)
8. Check user settings (auto-reply enabled + business hours)
9. Skip if already replied
10. Send greeting message (if new conversation)
11. Apply reply delay
12. Consolidate unreplied messages (conversation history)
13. Generate reply (template → AI with KB)
14. Apply safe fallback for price hallucinations
15. Skip reply entirely if offensive
16. Send reply
17. Mark as replied
18. Store outgoing message
19. Mark older debounced messages as replied
20. Notify if flagged

### Comment Processing — 12 Steps

1. Validate page + content
2. Check auto-reply enabled
3. Find/create post/media
4. Store comment
5. Check user settings
6. Handoff pause check
7. Rate limiting (5 comments/min per sender per page)
8. Skip if already replied
9. Generate reply
10. Send reply
11. Mark as replied
12. Notify if flagged

---

## AI Capabilities

| Capability | Detail |
|-----------|--------|
| **Model** | GPT-4o-mini (cost-optimized, 128K context) |
| **Embedding** | text-embedding-3-small (512 dimensions) |
| **Languages** | Arabic (Syrian dialect preference), English, Swedish |
| **Token Budget** | 2000 input, 300 output, KB limited to 1500 chars |

### Intent Classification (8 types)

| Intent | Response Strategy |
|--------|------------------|
| **QUESTION** | Search KB; if not found, say "I'll check with the team" |
| **COMPLIMENT** | Thank warmly |
| **COMPLAINT** | Apologize sincerely, offer to help |
| **PURCHASE_INTENT** | Guide on ordering, share contact info from KB |
| **GREETING** | Brief warm response |
| **BUSINESS_INQUIRY** | Thank for interest, ask for details |
| **OFFENSIVE** | Reply calmly, don't engage |
| **SPAM_OR_IRRELEVANT** | Brief polite generic response |

### Channel-Specific Behavior

| Channel | Max Length | Can Share Prices? | Special |
|---------|-----------|------------------|---------|
| **Public Comments** | 1 sentence, 40 words | No | Questions → "Send us a message!" |
| **Direct Messages** | 1-4 sentences | Yes (from KB) | Full detailed answers, don't say "DM us" |

### 3-Tier Caching (Cost Optimization)

| Layer | Method | Cost | Hit Rate |
|-------|--------|------|----------|
| **Exact Cache** | SHA-256 hash of normalized comment (Redis + DB) | Free | High for repeated comments |
| **Semantic Cache** | Embedding similarity search (pgvector) | 1 embedding API call | Good for similar questions |
| **Full AI Call** | GPT-4o-mini via AI Worker | Full API call | Fallback |

**Result**: ~70-80% of comments served from cache.

---

## Knowledge Base (RAG System)

### Architecture

```
Merchant writes business info
        │
        ▼
  ┌─────────────┐
  │  Chunking    │  Split into semantic chunks by category
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │  Embedding   │  text-embedding-3-small (512 dims)
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │  pgvector    │  Store in PostgreSQL with vector index
  └──────┬──────┘
         │
   On customer query:
         ▼
  ┌─────────────┐
  │  Retrieval   │  Semantic search → top K chunks
  └──────┬──────┘
         ▼
  ┌─────────────┐
  │  AI Worker   │  Chunks injected into GPT context
  └─────────────┘
```

### Features

- **Chunk types**: offering, policy, faq, info, hours, location
- **Versioning**: KB versions track changes, invalidate caches
- **Auto-translation**: Write in one language, auto-translate to other
- **Suggested KB**: Auto-extract from Facebook business profile
- **Shopify enrichment**: Append product data to KB context
- **Gap detection**: Track unanswered questions, notify after 5+ occurrences

---

## Frontend Pages

### Public Pages

| Page | Route | Function |
|------|-------|----------|
| **Landing** | `/landing` | Marketing page — features, testimonials, FAQ, pricing CTA |
| **Login** | `/login` | Facebook OAuth (web + native) + Demo mode |
| **Pricing** | `/pricing` | Plan comparison, upgrade flow, FAQ |

### Dashboard Pages (Authenticated)

| Page | Route | Function |
|------|-------|----------|
| **Dashboard** | `/dashboard` | KPI cards, recent comments, usage meter, trial countdown |
| **Comments** | `/comments` | Filter chips (Needs Action / All / Auto-replied), resolve, CSV export |
| **Messages** | `/messages` | Conversation view, smart reply pause/resume, search & filter |
| **Pages** | `/pages` | Manage FB/IG pages, toggle auto-reply, KB editor |
| **Templates** | `/templates` | CRUD for reply templates with `{{name}}` variables |
| **Rules** | `/rules` | Keyword-triggered auto-reply rules with priority |
| **Settings** | `/settings` | Auto-reply config, business hours, away/greeting messages, reply mode |
| **Complete Profile** | `/complete-profile` | Email capture on first login |

### Integration Pages

| Page | Route | Function |
|------|-------|----------|
| **Shopify Onboarding** | `/pages/shopify/onboarding` | Connect store, sync products, link to FB page |

### Admin Pages

| Page | Route | Function |
|------|-------|----------|
| **Customers** | `/admin/customers` | List all users, filter by status/plan, search |
| **Customer Detail** | `/admin/customers/[userId]` | User profile, usage, manual upgrade form |

---

## Settings Configuration

### Auto-Reply

| Setting | Options | Default |
|---------|---------|---------|
| Enable Smart Replies | On/Off | Off |
| Reply to Comments | On/Off | Off |
| Reply to Messages | On/Off | Off |
| Comment Reply Mode | Public / Private / Dual | Public |
| Dual Reply Nudge | Short text (max 80 chars) | — |

### Business Hours & Away Mode

| Setting | Options | Default |
|---------|---------|---------|
| Business Hours | On/Off | Off |
| Start/End Time | Time pickers | 9 AM - 6 PM |
| Away Message | Textarea (auto-translated) | — |
| Greeting Message | Textarea (auto-translated) | — |

### Advanced Settings

| Setting | Options | Default |
|---------|---------|---------|
| Reply Delay | Instant / 2-5s / Slower | Instant |
| Comment Escalation | N minutes | 60 min |
| Message Escalation | N minutes | 30 min |
| Handoff Pause Duration | 15min / 30min / 1hr / 2hr / 4hr / 24hr | 12 min |
| Default Reply Language | AR / EN | Auto-detect |
| Auto-detect Language | On/Off | On |

---

## Integrations

### Facebook

- Multi-page support (limited by plan)
- Comment + message webhooks with HMAC signature verification
- Public replies, private replies, dual mode (public + DM)
- Page syncing and access token management
- Business profile extraction

### Instagram

- Business accounts linked via Facebook page
- Support for Posts, Reels, Stories, Carousel albums
- Media-level auto-reply toggle
- Comment and DM processing

### Shopify

- OAuth flow (read products, orders, inventory)
- Product sync with ~800 char structured summaries
- Price range, inventory, variants, shipping/return policies
- Auto-enrichment of KB context during retrieval
- GDPR compliance webhooks

### Stripe

- Checkout sessions for upgrades
- Billing portal (self-service invoices, payment methods)
- Webhook-driven subscription lifecycle
- Sanctions compliance (geo-blocking before ANY Stripe call)

### Salla

- OAuth flow (read products, policies)
- Product sync with structured summaries
- Auto-enrichment of KB context during retrieval
- Webhook registration for inventory updates

### Zid

- OAuth flow + token management (X-MANAGER-TOKEN auth header)
- Product sync with structured summaries
- Auto-enrichment of KB context during retrieval
- Webhook registration for inventory updates

### WhatsApp

- Meta WhatsApp Cloud API integration (Tech Provider model)
- Text message sending via phone_number_id
- Message read status tracking ("mark as read")
- Backend reply adapter fully implemented
- Status: Backend complete, Meta Embedded Signup approval pending

### Resend Email

- Transactional email delivery via Resend REST API
- Bilingual email templates (Arabic/English)
- Waitlist notifications, customer communications
- Graceful degradation (logs in development, error if unconfigured)

### Firebase

- FCM push notifications (Android, iOS, Web)
- Device token registration/removal
- Bilingual notification content (titleAr/titleEn, bodyAr/bodyEn)

### Additional Features (since 2026-02-18)

- **Leads Module**: AI-powered lead extraction from conversations (phone/email capture, intent summary, daily limits per workspace)
- **Waitlist**: Feature waitlist signup with HMAC-based unsubscribe tokens
- **Blog**: 13+ bilingual blog posts (Arabic/English) covering e-commerce guides, setup tutorials
- **Admin Panel**: Playground (AI testing), waitlist management, customer management, observability dashboard
- **Unsubscribe Page**: Email unsubscribe management

---

## Subscription Plans

| Feature | Starter | Business | Pro |
|---------|---------|----------|-----|
| Pages | Limited | More | Unlimited |
| AI Replies/month | Capped | Higher | Unlimited |
| Templates | Limited | More | Unlimited |
| Rules | Limited | More | Unlimited |
| Platforms | Facebook | FB + IG | FB + IG + Shopify |
| Branding | Shown | Hidden | Hidden |
| Support | Standard | Priority | Priority |
| Trial | 14 days | — | — |

### Usage Tracking

- Monthly counters: AI replies, comments processed, messages processed
- Daily breakdown (JSONB) for charts
- Auto-reset on billing period boundary
- Real-time limit checks before each AI call

---

## Backend API Surface (~90+ endpoints)

### Core Domains

| Domain | Endpoints | Key Operations |
|--------|-----------|---------------|
| **Auth** | 7 | Facebook OAuth, native mobile login, refresh tokens, logout |
| **Comments** | 8 | List, stats, reply, resolve/unresolve, feedback |
| **Messages** | 7 | List, stats, reply, conversation pause/resume |
| **Templates** | 5 | CRUD + active toggle |
| **Rules** | 5 | CRUD + priority ordering |
| **Settings** | 2 | Get/update all settings |
| **Pages** | 6 | CRUD, sync, auto-reply toggle |
| **Posts** | 5 | CRUD, auto-reply toggle |
| **Instagram** | 5 | Media list, comments, reply, sync |
| **AI** | 4 | Generate (sync/async), job status, cache management |
| **Analytics** | 1 | Overview with configurable time range |
| **Payments** | 4 | Checkout, billing portal, cancel, Stripe webhook |
| **Subscriptions** | 9 | Status, usage, limits, change plan, cancel, pause/resume |
| **Plans** | 7 | Public list + admin CRUD |
| **Admin** | 5 | User management, manual upgrades, audit logs |
| **Notifications** | 5 | Token registration, list, read, mark-all-read |
| **Shopify** | 7+ | OAuth, webhooks, store management, product sync, GDPR |
| **Translation** | 1 | Translate text with language detection |
| **Webhooks** | 2 | Facebook/Instagram webhook verify + receive |
| **Health** | 5 | Liveness, readiness, cleanup, cache stats, pipeline metrics |

---

## Data Flow

```
┌──────────────────────────────────────────┐
│         CUSTOMER INTERACTION              │
│    (Facebook Comment / Instagram DM)      │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│            BACKEND (Fastify)              │
│  Webhook → Validate → Store → Queue      │
└─────────┬────────────────────┬───────────┘
          │                    │
   Cache Check            AI Service
          │                    │
   ┌──────▼────────────────────▼──────┐
   │   AIService.generateReply()      │
   │  L1: Exact Cache (Redis + DB)    │
   │  L2: Semantic Cache (pgvector)   │
   │  L3: Full AI Worker Call         │
   └──────┬───────────────────────┬───┘
          │                       │
    Cache Hit               No Cache
          │                       │
          │              ┌────────▼────────┐
          │              │ OpenAI Embedding │
          │              │ (512 dims)       │
          │              └────────┬────────┘
          │              ┌────────▼────────┐
          │              │ KB Retrieval     │
          │              │ (pgvector)       │
          │              └────────┬────────┘
          │              ┌────────▼────────┐
          │              │ AI Worker        │
          │              │ (GPT-4o-mini)    │
          │              └────────┬────────┘
          │                       │
          └───────────┬───────────┘
                      │
               ┌──────▼──────┐
               │ Save Caches │
               └──────┬──────┘
                      │
               ┌──────▼──────────┐
               │ Safety Checks    │
               │ (hallucination,  │
               │  offensive,      │
               │  confidence)     │
               └──────┬──────────┘
                      │
               ┌──────▼──────┐
               │ Post Reply   │
               │ to Platform  │
               └──────────────┘
```

---

## Background Jobs & Workers

| Job | System | Interval/Trigger | Purpose |
|-----|--------|-----------------|---------|
| **Reply Processing** | BullMQ | On webhook | Process comments/messages asynchronously |
| **Escalation Sweep** | setInterval | Every 5 min | Flag unreplied items past SLA |
| **AI Cache Cleanup** | Manual/cron | On demand | Remove stale cache entries |
| **KB Ingestion** | BullMQ | On KB save | Chunk, embed, store KB content |
| **Product Sync** | Manual/webhook | On Shopify change | Refresh product data |

### Reply Queue Config

- **Retry**: 3 attempts with exponential backoff (2s, 4s, 8s)
- **Cleanup**: Keep last 100 completed, last 500 failed
- **Concurrency**: 5 jobs parallel (AI Worker)

---

## Rate Limiting

| Context | Limit | Backing |
|---------|-------|---------|
| Comments | 5/min per sender per page | Redis sliding window |
| Messages | 10/min per sender per page | Redis sliding window |
| AI Worker API | 100 requests/min | Fastify rate limiter |
| Strategy | Fail-open (if Redis down, allow requests) | — |

---

## Security & Compliance

| Area | Implementation |
|------|---------------|
| **Auth** | JWT + refresh token rotation with hash storage |
| **Webhooks** | HMAC signature verification (Facebook, Stripe, Shopify) |
| **Shopify Tokens** | AES-256-GCM encryption with per-token IV |
| **Sanctions** | Geo-blocking before ANY Stripe API call (Cuba, Iran, NK, Syria, Crimea) |
| **GDPR** | Shopify data request/redaction handlers |
| **User Isolation** | Users only see their own data; page ownership enforced |
| **Input Sanitization** | 24+ regex patterns for prompt injection, HTML stripping, 2000 char cap |
| **KB Sanitization** | Separate patterns preserving legitimate business content |

---

## Mobile App (Capacitor 8)

- Native Android/iOS wrappers
- Safe area handling for notches/home indicators (CSS variables in `globals.css`)
- Native Facebook SDK for auth (pre-initialized on login page)
- Swipe-to-dismiss notifications
- Landscape mode awareness across all pages
- Push notifications via FCM
- Optimized modal heights (90vh max)

---

## Deployment & Infrastructure

### Docker Compose Services

| Service | Image | Health Check |
|---------|-------|-------------|
| PostgreSQL 15 | pgvector extension | pg_isready |
| Redis 7-alpine | — | redis-cli ping |
| Backend | Node 20 | wget /health every 30s |
| AI Worker | Node 20 | wget /health every 30s |
| Frontend | Node 20 | wget / every 30s |
| Nginx | — | Reverse proxy (80/443) |

### Deployment Pipeline

1. Pre-deploy checks (12 steps: config, translations, lock sync, plugin compat, audit, TypeScript, lint, code quality, unit tests, integration tests, E2E, Docker build)
2. SSH to production server
3. Blue-green deployment (zero downtime)
4. Health checks + content smoke tests
5. Automatic rollback on failure

---

## Cost Optimization Summary

| Strategy | Savings |
|----------|---------|
| GPT-4o-mini instead of GPT-4 | ~10x cheaper |
| 3-tier caching (70-80% hit rate) | Majority of requests are free |
| text-embedding-3-small | Cheapest embedding model |
| Translation on save only (not per message) | One-time cost vs per-message |
| Token budgets (2000 in, 300 out) | Prevents expensive prompts |
| Rate limiting per sender | Prevents abuse/spam flooding |

---

## Localization

- **Languages**: Arabic (RTL) + English (LTR)
- **Translation system**: 1000+ keys in `en.json` / `ar.json`
- **CSS**: Tailwind logical properties (`ps-*`, `pe-*`, `start`, `end`) for RTL/LTR
- **Auto-translation**: Merchant content (greeting, away, KB) auto-translated via GPT-4o-mini
- **Arabic normalization**: Diacritics removal, alef normalization, digit conversion (for cache/search)
- **Arabic pluralization**: Proper singular/dual/plural/accusative forms in notifications
