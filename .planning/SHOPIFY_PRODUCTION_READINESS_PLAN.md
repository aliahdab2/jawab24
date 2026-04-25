# Close Best-Practice Gaps in Shopify Install + Sync Pipeline

> **Status:** Planned 2026-04-25, ready to execute in a new Claude session.
> **Origin:** Follow-up to the dogfood session of `docs/testing/SHOPIFY_TEST_PLAN.md` Sections A + B (commits `723872b9` and earlier).
> **How to resume:** Open a new Claude Code session in this repo and say "execute `.planning/SHOPIFY_PRODUCTION_READINESS_PLAN.md`" — the assistant will read this file as the source of truth.

---

## Context

The 2026-04-25 dogfood session of `docs/testing/SHOPIFY_TEST_PLAN.md` Sections A + B found 5 real bugs in the install / sync / webhook pipeline. Two were fixed in commit `723872b9`:
- **A-1.3** — `getStoreByWorkspaceAny` ORDER BY (already fixed)
- **A-1.4** — sync wrapped in `db.transaction` (already fixed)

Three remain open and are documented as `it.todo` in `backend/test/regression/shopify-install-bugs.test.ts`:
- **A-1.5** (LOW) — `POST /shopify/store/sync` with empty body returns 400
- **A-1.9** (MEDIUM) — `claimPendingInstall` fires `registerWebhooks` fire-and-forget
- **B-3.1** (LOW, dormant) — products webhook does full re-sync; internal `id` rotates on every edit

This session also surfaced two general production-readiness gaps:
- No Sentry alert tag on Shopify webhook 5xx (silent failure mode)
- Sync uses `delete-all + insert-all` not per-row UPSERT — wasteful at merchant-scale catalogs

The bug grades from this session put us at **B / B+** overall. Fixing these closes the gap to **B+ / A−** — appropriate for app-store submission readiness without overengineering for an indie pre-launch.

## Why now

Before submitting to Shopify App Store:
- **A-1.9 must be fixed**. Reviewers install/uninstall on fresh dev stores. The fire-and-forget race fails quietly there → no incremental updates work for them → guaranteed rejection.
- **B-3.1 should be fixed at root**. The transaction wrap (A-1.4) handles concurrency but the underlying delete+insert pattern still rotates internal product IDs on every webhook. Dormant footgun for any future `messages.product_id` / `leads.product_id` foreign key.
- **A-1.5 is small** and bundles cleanly with the others.

Out of scope (requires separate work, see "Not in this plan" below):
- Automated `npm run dogfood:shopify` E2E suite
- Migration to `shopify app dev` CLI
- Security audit
- GitHub Issues migration of bug log

## Fixes

### Fix 1 — A-1.5: empty-body parser (~20 min)

**Problem:** Fastify's default JSON parser returns 400 "Unexpected end of JSON input" when `Content-Type: application/json` is set but body is empty. The UI sends `{}` so users don't hit it; only direct API/curl callers do. The `syncStore` controller doesn't even read the body.

**File:** `backend/src/index.ts` (or wherever Fastify is instantiated; grep for `fastify(` or `addContentTypeParser`)

**Approach:** Register a content-type parser override that treats empty body as `{}`:

```ts
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || (body as string).trim() === '') return done(null, {});
    try { done(null, JSON.parse(body as string)); }
    catch (err) { done(err as Error, undefined); }
});
```

Apply globally — empty-body should be `{}` for ANY route, not just sync. Existing routes that destructure body fields work unchanged because `{}` produces `undefined` for missing keys.

**Test (flip from `it.todo`):**
- Spin up the Fastify instance in a test
- POST to `/shopify/store/sync` with `Content-Type: application/json` and empty body
- Assert 200 (not 400)
- Repeat with body `{}` — assert same behavior

### Fix 2 — A-1.9: await webhook registration with retry (~45 min)

**Problem:** `services/ecommerce.ts:606-614` registers Shopify webhooks via `.then().catch()` without awaiting. In CLI scripts or process restarts during install, the async HTTP call dies before completing. Discovered when our claim script left Shopify with 0 webhooks registered → B-3 webhook test failed silently.

**File:** `backend/src/services/ecommerce.ts:606-614` (`claimPendingInstall`)
**Also:** `backend/src/controllers/shopify.ts:148-158` (the OAuth callback path uses the same `.then().catch()` pattern — fix both)

**Approach:**

1. **Await the registration inline.** Adds ~200-500ms to install latency — acceptable for a one-time event.

2. **Persist `webhookStatus` to `platform_data` before returning** so the controller can render registration errors to the merchant immediately.

3. **On failure, schedule a retry job.** Use existing BullMQ infrastructure (see `backend/src/lib/` for queue patterns, e.g. `customerNotificationQueue.ts`). Create `webhookRetryQueue.ts` with exponential backoff (max 3 retries over 30 min), or reuse a generic retry wrapper if one exists (grep for `BullMQ` + `attempts`).

4. **Log failures via `captureError`** with tags `{ service: 'shopify', stage: 'webhook-registration' }` so Sentry alerting can route them.

**Tests (flip 3 `it.todo`s in regression file):**
- Mock `registerWebhooksFn` to resolve with `{ registered: [...], failed: [] }` → assert function awaits before returning + `saveWebhookStatusFn` called
- Mock to reject → assert `captureError` called + retry job enqueued + function does NOT throw (don't fail the install for a webhook hiccup)
- Mock partial failure (some topics succeeded, some failed) → assert webhookStatus persisted + retry only for failed topics

### Fix 3 — B-3.1: per-row UPSERT + single-product webhook handler (~1.5 hr)

**Problem:** Two parts.

**(a) `replaceProductsAndRebuildSummary` does delete-all + insert-all.** Every full sync wipes all `ecommerce_products.id` values for the store. The A-1.4 transaction wrap fixed concurrent-sync 500s but didn't fix this rotation.

**(b) `webhookProductsUpdate` enqueues a full re-sync for every single-product update event.** Editing one product wipes all 24 product IDs. Wasteful, and creates a dormant footgun if anything joins by internal id.

**Files:**
- `backend/src/services/ecommerce.ts:685-730` (`replaceProductsAndRebuildSummary`)
- `backend/src/controllers/shopify.ts:174-197` (`webhookProductsUpdate`)
- `backend/src/services/shopify.ts` — find the single-product fetch helper (grep for `fetchProductById` or similar; if missing, write one based on the existing `fetchAllProducts` GraphQL query)

**Approach:**

1. **Per-row UPSERT in `replaceProductsAndRebuildSummary`:**
   ```ts
   await db.transaction(async (tx) => {
       // Insert new + update existing in one pass
       await tx.insert(ecommerceProducts)
           .values(rows)
           .onConflictDoUpdate({
               target: [ecommerceProducts.ecommerceStoreId, ecommerceProducts.platformProductId],
               set: { /* all mutable fields, excluding id and createdAt */ },
           });
       // Remove products no longer in the catalog
       const currentIds = rows.map(r => r.platformProductId);
       await tx.delete(ecommerceProducts).where(and(
           eq(ecommerceProducts.ecommerceStoreId, storeId),
           notInArray(ecommerceProducts.platformProductId, currentIds),
       ));
   });
   ```
   Result: existing product IDs preserved; only NEW products get fresh IDs; products deleted from Shopify are removed.

2. **Single-product upsert path for webhooks:**
   - Add `upsertSingleProduct(storeId, product)` to `services/ecommerce.ts` — same UPSERT as above but for one row
   - Modify `webhookProductsUpdate` to:
     - Read `request.body` as the Shopify product payload (already JSON-parsed by Fastify)
     - For `products/create` and `products/update`: parse into the standard product shape, call `upsertSingleProduct`
     - For `products/delete`: delete by `(storeId, platformProductId)` only — don't touch other rows
     - Drop the `enqueueSyncJob(store.id)` full-sync trigger

3. **Schedule full-sync still runs every 6h** (existing setInterval in `backend/src/index.ts`) for catalog repair if a webhook is ever missed. With `onConflictDoUpdate`, this becomes idempotent — no row ID rotation.

**Tests (flip 3 `it.todo`s):**
- `replaceProductsAndRebuildSummary` preserves `id` for existing platform_product_ids across consecutive calls
- `upsertSingleProduct` updates the matching row and leaves all other rows untouched
- `webhookProductsUpdate` for `products/delete` removes only the targeted row

### Fix 4 — Sentry observability for webhook 5xx (~30 min)

**Problem:** Shopify retries webhooks 19 times over 48h on 5xx, then gives up. We have no alert if the handler crashes — we'd find out from a customer complaint.

**File:** `backend/src/controllers/shopify.ts` (all webhook handlers — `webhookUninstall`, `webhookProductsUpdate`, `webhookOrders`, `gdpr*`)

**Approach:**

1. Wrap each webhook handler body in try/catch. On error, call `captureError` with explicit tags before re-throwing:
   ```ts
   try {
       // existing handler body
   } catch (error) {
       captureError(error, 'Shopify webhook handler failed', {
           tags: {
               service: 'shopify',
               webhook: 'products-update', // or 'orders', 'gdpr-shop-redact', etc.
           },
           extra: {
               shopDomain: request.headers['x-shopify-shop-domain'],
               topic: request.headers['x-shopify-topic'],
               webhookId: request.headers['x-shopify-webhook-id'],
           },
       });
       throw error;
   }
   ```

2. Add a `pipelineMetrics` counter (existing utility — see `backend/src/lib/pipelineMetrics.ts`):
   ```ts
   pipelineMetrics.record('shopify_webhook', success ? 'success' : 'failure');
   ```

3. **No new alerting infrastructure needed** — Sentry already routes by tag. Document the new tags in `docs/integrations/shopify.md` so on-call knows what to watch.

**Test:**
- Add a regression test that hits `/shopify/webhooks/products-update` with a body that triggers an error in the handler (e.g. malformed JSON in nested fields)
- Assert response status >= 500
- Assert `captureError` was called with the correct tags

### Fix 5 — Flip `it.todo` → real assertions (~30 min)

After fixes 1-3 land, all 7 `it.todo` entries in `backend/test/regression/shopify-install-bugs.test.ts` should become real passing tests.

Final state: regression file goes from `5 passing + 7 todo` → `12 passing + 0 todo`.

## Order of work (least risky first)

1. **Fix 1 (A-1.5)** — small, isolated, low blast radius
2. **Fix 4 (observability)** — pure additive, no behavior change
3. **Fix 2 (A-1.9)** — touches install path; verify with full integration test
4. **Fix 3 (B-3.1)** — biggest change; touches sync + webhook handler
5. **Fix 5** — flip todos as we go (per fix), final pass at end

After each major fix:
```bash
cd backend && npx tsc --noEmit && npm run lint && npm test
```

Don't proceed to next fix if anything fails.

## Critical files

| File | What changes |
|------|--------------|
| `backend/src/index.ts` | Fix 1: `addContentTypeParser` for empty body |
| `backend/src/services/ecommerce.ts` | Fix 2: await webhooks + retry. Fix 3: per-row UPSERT in `replaceProductsAndRebuildSummary` + new `upsertSingleProduct` |
| `backend/src/controllers/shopify.ts` | Fix 2: same await pattern in OAuth callback path. Fix 3: rewrite `webhookProductsUpdate` to per-product upsert. Fix 4: try/catch + captureError wrapping all webhook handlers |
| `backend/src/services/shopify.ts` | Fix 3: add `fetchProductById` helper if not present |
| `backend/test/regression/shopify-install-bugs.test.ts` | Fix 5: flip 7 `it.todo` to real assertions |
| New: `backend/src/lib/webhookRetryQueue.ts` | Fix 2: BullMQ retry queue (model after `customerNotificationQueue.ts`) |
| New: `backend/src/workers/webhookRetryWorker.ts` | Fix 2: processes retry jobs |
| `docs/testing/SHOPIFY_TEST_PLAN.md` | Update bug log: A-1.5, A-1.9, B-3.1 → CLOSED |

## Existing utilities to reuse (don't reinvent)

- `captureError` from `backend/src/utils/sentryHelpers.ts` — already used everywhere
- `pipelineMetrics` from `backend/src/lib/pipelineMetrics.ts` — for counters
- BullMQ pattern in `backend/src/lib/customerNotificationQueue.ts` + `backend/src/workers/customerNotificationWorker.ts` — copy verbatim for retry queue
- `db.transaction` pattern (just used in fix A-1.4) — same shape works for fix 3
- Drizzle `onConflictDoUpdate` — already used in `claimPendingInstall` (search for `onConflictDoUpdate` for examples)

## Verification

Run after all fixes:

```bash
cd backend
npx tsc --noEmit                     # 0 errors
npm run lint                         # 0 warnings
npm test                             # 3179 + new tests passing
npx vitest run test/regression/      # 12 passing, 0 todo
```

Manual smoke test (requires running stack):

1. Start ngrok + backend + frontend (`/shopify-dev` skill)
2. Connect a fresh Shopify dev store via direct OAuth URL
3. Verify `platform_data.webhookStatus.registered` is populated immediately (not after delay)
4. Open Shopify admin → edit a product title → Save
5. Wait 5s → fetch `/shopify/store/products` → confirm:
   - Title updated
   - `id` of edited product is **the same as before** (key B-3.1 verification)
   - `id` of OTHER products is also unchanged (proves the fix didn't accidentally regress)
6. Delete a product in Shopify → confirm only that row is removed; other 23 ids unchanged
7. POST `/shopify/store/sync` with empty body → confirm 200

Then update the bug log in `docs/testing/SHOPIFY_TEST_PLAN.md` to mark A-1.5, A-1.9, B-3.1 as CLOSED with commit references.

## What is NOT in this plan (separate work)

These would push us from A− to A+ but are out of scope for this session:

| Item | Why deferred | Effort |
|------|--------------|--------|
| Automated `npm run dogfood:shopify` E2E suite | Requires real Shopify dev store + CI secrets | ~1 day separate session |
| Adopt `shopify app dev` CLI | Process change, not code | 15 min one-time setup |
| External security audit | Needs human reviewer | $$$ separate |
| GitHub Issues migration of bug log | Tracking system change | 30 min one-time |
| Verify CI gate runs regression tests on every PR | Read GitHub Actions config + test | 30 min |

These should be picked up after the code-level fixes ship.

## Expected outcomes

- 3 real production bugs closed (A-1.5, A-1.9, B-3.1)
- Webhook handler observability for production failures
- Sync becomes idempotent (no internal id churn)
- 7 `it.todo` regression tests become 7 passing tests
- Production-readiness grade: B+ / A− (up from B / B+)
- App store submission unblocked from a code-quality standpoint (still needs Section I GDPR test plan + listing assets, both separate)
