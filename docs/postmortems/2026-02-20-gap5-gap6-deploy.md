# Post-Deploy Report: Gap 5 + Gap 6 Epic

**Date**: 2026-02-20
**Deployed by**: Ali Ahdab
**Commits**: `059fe00` (features + tests), `0659e06` (nginx routing fix)
**Deploy method**: Blue-green via `deploy-production.sh -y --skip-tests`
**Deploy time**: 12m 20s

---

## What shipped

### Gap 6 — Shopify Cache Invalidation
- `invalidateCachesForStore()` bumps `kbActiveVersion`, scans+deletes Redis `cache:ai_reply:*` keys, deletes `semantic_cache` rows
- Called at end of `syncProducts()` and `syncPolicies()`
- 7 unit tests

### Gap 5 — Audit Trail + PII Controls
- **Audit log service** (`auditLog.ts`): fire-and-forget structured logging to `logs` table, 16 action types
- **Facebook GDPR data deletion callback** (`POST /webhook/data-deletion`): signed_request HMAC verification, async user deletion, returns confirmation code per Facebook spec
- **Cleanup scheduler**: runs every 6h + 60s delayed first run. Cleans ai_cache (30d), logs (90d), usage_logs (180d), refresh_tokens (expired + revoked >7d)
- **Audit hooks**: settings save, account deletion, GDPR deletion
- 13 new tests (4 audit, 7 GDPR, 2 cleanup)

### Additional
- **Circuit breaker concurrency test**: 6 tests validating fail-fast under concurrent pressure
- **Nginx fix**: `proxy_pass` was dropping `/data-deletion` suffix due to variable interpolation disabling prefix replacement. Fixed to use `$uri`.

---

## Rollback Information

| Item | Value |
|------|-------|
| **Active color** | blue |
| **Previous color** | green |
| **Switched at** | 2026-02-20 16:04:46 UTC |

### Rollback command
```bash
ssh root@91.99.95.196 "cd /var/www/jawab24 && ./scripts/rollback.sh"
```

Or manual:
```bash
ssh root@91.99.95.196 << 'EOF'
cd /var/www/jawab24
# Switch nginx upstream to green
cat > nginx/upstream.conf << 'CONF'
upstream backend_active { server jawab24-backend-green:3000; }
upstream frontend_active { server jawab24-frontend-green:3001; }
upstream ai_worker_active { server jawab24-ai-worker-green:3002; }
CONF
docker cp nginx/upstream.conf jawab24-nginx:/etc/nginx/upstream.conf
docker exec jawab24-nginx nginx -s reload
EOF
```

---

## Production Verification

### Health
| Check | Result |
|-------|--------|
| `/api/health` | healthy — DB 2ms, Stripe up, AI circuit **closed** |
| Redis `cb:*` keys | Empty (no failures) |
| Backend error logs | None |

### Cleanup Scheduler (first run, 60s after startup)
| Table | Rows cleaned |
|-------|-------------|
| ai_cache | 1 |
| logs | 0 |
| usage_logs | 0 |
| refresh_tokens | 65 |

### GDPR Data Deletion Endpoint
| Test | Response |
|------|----------|
| No body | `400 Missing signed_request` |
| Bad signature | `403 Invalid signature` |
| Existing webhook GET | `403 Verification token mismatch` (unchanged) |
| Existing webhook POST | `403 Invalid signature` (unchanged) |

### Latency (no regression)
| Metric | Value |
|--------|-------|
| Health endpoint steady-state | 5-8ms |
| First cold request | 265ms (includes cleanup) |
| Subsequent requests | 5-11ms |

---

## 24h Monitoring Checklist

- [ ] `circuit.ai_worker.opened` stays at 0 (no Sentry alerts)
- [ ] Cleanup job runs again at ~22:04 UTC (6h interval)
- [ ] No `ai_usage_log.dropped` events
- [ ] **Shopify sync checkpoint**: next product webhook triggers `invalidateCachesForStore()` — first post-sync AI query should be a cache miss (fresh LLM response, not stale product data)
- [ ] No unhandled exceptions in Sentry

---

## Test Coverage
**1608 tests** (was 1582 before epic): +26 new tests across circuit breaker concurrency, Shopify cache invalidation, audit log, GDPR handler, and cleanup.
