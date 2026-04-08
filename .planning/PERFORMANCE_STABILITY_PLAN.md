# Jawab24 — Performance & Stability Plan

> Long-term roadmap for scaling from first customers to hundreds of active pages.
> Updated: 2026-04-08

## Current State

- **Server**: Single Hetzner VPS (7.5GB RAM, multi-core)
- **Architecture**: Docker Compose, blue-green deploys, BullMQ job queue, Redis, PostgreSQL
- **Traffic**: First customers onboarding. App is live with all Facebook/Instagram permissions approved.
- **Recent incident**: Server crash when a busy page connected (fixed: OOM in job promotion, DB pool exhaustion, push notification storm)

---

## Phase 1 — Launch Ready (Now → 50 pages)

**Goal**: Survive first customers without silent failures or data loss.

| Task | Status | Impact |
|------|--------|--------|
| Facebook axios interceptor (429 + 5xx + network retry) | DONE | All Facebook API calls auto-retry on rate limit, 5xx, network errors. No business logic changes needed. |
| Reply worker concurrency 5 → 8 | DONE | Faster reply throughput |
| Webhook concurrency cap (10 slots, 503 backoff) | DONE (76719d10) | Prevents DB pool exhaustion on traffic spikes |
| Paginated delayed job promotion | DONE (76719d10) | Prevents OOM on large queues |
| Push notification rate limiting | DONE (76719d10) | Prevents FCM storm on busy pages |
| Redis noeviction + 1GB limit | DONE (2d2737da) | Queue jobs never silently dropped |
| Redis auth retry storm fix | DONE (40ac2cfb) | No more 3k+ Sentry events per restart |
| Add CloudFlare (free tier) | TODO | CDN for static assets, DDoS protection, analytics |
| Instagram service — use fbAxios | TODO | Same interceptor pattern — replace bare `axios` with `fbAxios` in instagram.ts |
| Monitor queue depth via Sentry | TODO | Alert if waiting > 500 jobs for > 2 min |

**Estimated capacity**: ~50 active pages, ~5 msg/sec sustained, ~250 msg/min.

---

## Phase 2 — Growth (50 → 200 pages)

**Goal**: Handle moderate traffic without manual intervention.

| Task | Priority | Description |
|------|----------|-------------|
| **CDN for static assets** | High | CloudFlare or similar — cache headers already configured (1yr immutable) |
| **DB connection pool → 50** | High | Current 30 may be tight with 200 pages + 8 workers + crons |
| **Webhook concurrency → 20** | Medium | 10 slots may throttle at 200 pages during peak |
| **Token refresh jitter** | Medium | Randomize cron start within 5-min window to avoid FB rate limit during mass refresh |
| **Batch sender name lookups** | Medium | Cache in Redis (24h TTL, already partially done), avoid per-message FB API call |
| **Queue depth alerting** | Medium | Sentry alert when reply queue waiting > 1000, > 5000, > 10000 |
| **Instagram retry + rate limit** | Medium | Apply same `callWithRetry` pattern to Instagram send methods |
| **WhatsApp retry + rate limit** | Low | Same pattern, lower priority (fewer WhatsApp users expected) |
| **Verify DB indexes** | Low | Confirm composite indexes on (pageId, replied, createdAt) for hot queries |

---

## Phase 3 — Scale (200 → 1000 pages)

**Goal**: Horizontal scaling, observability, zero-touch operations.

| Task | Priority | Description |
|------|----------|-------------|
| **Multiple backend containers** | High | Run 2-3 backend instances behind nginx upstream round-robin. BullMQ already distributes jobs across workers. |
| **PgBouncer** | High | Connection pooling proxy — essential when multiple app containers share one DB |
| **Separate worker containers** | High | Decouple reply workers from API server — scale independently |
| **Metrics dashboard** | High | Grafana or Sentry dashboards: queue depth, worker lag, FB API latency, reply success rate |
| **Database read replica** | Medium | Route analytics/dashboard queries to replica, keep writes on primary |
| **Redis Sentinel or cluster** | Medium | Redis HA — currently single instance is a SPOF |
| **Auto-restart on OOM** | Low | Docker healthcheck + restart already in place, but add memory usage alerting |
| **Rate limit per-page** | Low | Track FB rate limit headers per page token, throttle busiest pages first |

---

## Phase 4 — Enterprise (1000+ pages)

**Goal**: Fully managed, auto-scaling, multi-region ready.

| Task | Description |
|------|-------------|
| **Container orchestration** | Docker Swarm or Kubernetes — auto-scale based on queue depth / CPU |
| **Managed database** | Move to managed PostgreSQL (Hetzner Cloud DB, AWS RDS, etc.) for automated backups, failover |
| **Managed Redis** | Redis Cloud or ElastiCache for HA + auto-failover |
| **Multi-region** | Deploy to EU + MENA for lower latency to Arabic-speaking customers |
| **Webhook fanout** | Dedicated webhook ingestion service that only enqueues, separate from API server |
| **AI worker auto-scaling** | Scale AI workers based on queue depth — most expensive operation per reply |
| **Cost optimization** | Track OpenAI spend per page, implement tiered AI limits, semantic cache hit rate optimization |

---

## Monitoring Checklist (Implement Incrementally)

| Metric | Alert Threshold | Where |
|--------|----------------|-------|
| Reply queue waiting count | > 500 for 2 min | Sentry / custom metric |
| Reply queue waiting count | > 5000 for 1 min | PagerDuty-level |
| Webhook 503 rate | > 10% of requests in 5 min | Nginx access log |
| Facebook API error rate | > 5% of send calls in 10 min | Sentry |
| DB active connections | > 25 of 30 for 30 sec | PostgreSQL stats |
| Redis memory usage | > 700MB of 1GB | Redis INFO |
| Container restart count | > 0 in 1 hour | Docker events |
| Reply latency p95 | > 30 sec | BullMQ job duration |
| AI worker circuit breaker open | Any | Sentry alert |

---

## Principles

1. **Measure before optimizing** — don't add complexity for hypothetical load. Add monitoring first, scale what's actually bottlenecked.
2. **Scale the queue, not the webhook** — Facebook retries 503s. Let the queue absorb bursts, process at sustainable pace.
3. **Fail loud, not silent** — every dropped message should be a Sentry event. No fire-and-forget for critical paths.
4. **One thing at a time** — don't jump to Kubernetes when a second Docker container would do.
5. **The AI worker is the bottleneck** — OpenAI calls are 2-5s each. Everything else is fast. Optimize here first.
