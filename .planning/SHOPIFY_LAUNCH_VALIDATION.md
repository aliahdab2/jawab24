# Shopify Launch Validation Plan

> **Status:** Drafted 2026-04-25. **Code-readiness refreshed 2026-05-19** — all engineering items below are now shipped (see §0). Plan is **ready to execute against a real Shopify dev store**; remaining work is the live dogfood pass + listing assets.
> **Purpose:** Validate that the production-readiness fixes work against a real Shopify dev store before submitting to App Review.

---

## 0. Readiness assessment (refreshed 2026-05-19)

| Layer | State | Confidence |
|---|---|---|
| Code shape (tsc, lint, unit + regression tests) | Complete | High — all green; 17/17 regression tests pass |
| Install pipeline (Section A in `SHOPIFY_TEST_PLAN.md`) | Untested since fixes landed | Low — re-run required (live dogfood pass) |
| Incremental update pipeline (Section B) | Untested since fixes landed | Low — re-run required (live dogfood pass) |
| Failure-recovery code (retry queue, persist-on-throw, re-register endpoint) | Shipped (`b5ff88d2`). `webhookRetryQueue.ts` + `webhookRetryWorker.ts` in tree; `registerWebhooksWithPersist` used by Shopify, Salla, Zid install paths | Medium — code shipped, never exercised live |
| AI reply correctness with store data | Not validated end-to-end | Unknown |
| Frontend `webhookHealth` badge + Re-register button | ✅ **Shipped** (`ff2d6324`) — see `frontend/src/pages/integrations.tsx:226-250`. Pending/failed banners + Re-register button + i18n + accessibility | High — code shipped, needs live state verification |
| Shopify mandatory-webhook compliance (GDPR + uninstall) | Existing tests pass; no live verification | Medium |
| Sentry observability on webhook handlers | ✅ **Shipped**. `wrapWebhook` helper at `backend/src/controllers/shopify.ts:19-36` tags every 5xx with `service: shopify, webhook: <name>` | High |
| Order webhook coverage (orders/create, orders/updated, orders/fulfilled) | ✅ **Shipped**. See `backend/src/services/shopify.ts:105-112` | High |

**Verdict for App Store submission (2026-05-19):** **Code-ready.** Submission is now gated on (a) live dogfood pass of Sections 3–6 against a real Shopify dev store, (b) privacy policy update covering Salla + Shopify processor disclosures, (c) listing assets + reviewer test-path doc.

---

## 1. Pre-flight (5 min)

```bash
# Run from repo root.
/shopify-dev                                    # starts ngrok + backend + frontend
```

Confirm:
- [ ] Backend running on `localhost:3000`
- [ ] Frontend running on `localhost:3001`
- [ ] ngrok URL captured; `SHOPIFY_HOST_NAME=<ngrok>` in `backend/.env`
- [ ] Shopify Partners "Jawab24-Dev" app redirect includes `https://<ngrok>/shopify/callback`
- [ ] Local DB reachable (`psql postgres://aliahdab@localhost:5432/postgres -c '\dt'`)
- [ ] Redis reachable (`redis-cli ping` → `PONG`)
- [ ] Workers logged at startup: `Reply processing worker started`, `Customer notification worker started`, **`Webhook retry worker started`** (this last one is new code that has never run live)

If the webhook retry worker doesn't log at startup, **stop here** — the retry path is broken.

---

## 2. Static validation (already passing — re-confirm)

```bash
cd backend
npx tsc --noEmit                                # 0 errors
npm run lint                                    # 0 warnings
npm test                                        # 3197 passing, 0 todo
```

If any of these regressed, **stop here**.

---

## 3. Install pipeline — re-run `SHOPIFY_TEST_PLAN.md` Sections A + B

Use a **fresh** dev store (`demo-electronics.myshopify.com` works if you reset it; otherwise a clean Shopify dev store).

### 3.1 Connect store (Section A in the dogfood plan)

1. From `/en/settings` click "Connect Shopify"
2. Authorize on the dev store
3. Watch backend logs — `claimPendingInstall` should:
   - Create the `ecommerce_stores` row
   - Call `registerWebhooks` and **await** it (look for the `webhook-registration` Sentry stage tag if it fails)
   - Save `webhookStatus` to `platform_data`
4. Verify in DB:
   ```sql
   SELECT id, store_domain, is_active,
     platform_data->'webhookStatus'->'registered' AS registered,
     platform_data->'webhookStatus'->'failed'    AS failed,
     platform_data->'webhookStatus'->'exhausted' AS exhausted
   FROM ecommerce_stores
   WHERE platform = 'shopify'
   ORDER BY created_at DESC LIMIT 1;
   ```
5. Verify via API:
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/shopify/store | jq .webhookHealth
   ```
   Expected: `"ok"`

**Pass criteria:**
- [ ] All 8 webhook topics in `registered` (`app/uninstalled`, `products/{create,update,delete}`, `orders/{create,updated,fulfilled,cancelled}`)
- [ ] `failed` is `[]`
- [ ] `exhausted` is `null` or absent
- [ ] API returns `webhookHealth: "ok"`

### 3.2 Empty body sync request (regression A-1.5)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3000/shopify/store/sync
```

**Pass criteria:**
- [ ] HTTP 200 (not 400 "Unexpected end of JSON input")

### 3.3 Incremental product update (Section B + bug B-3.1)

1. `GET /shopify/store/products` and snapshot all `(id, platformProductId, title)` tuples
2. In Shopify admin, edit one product's title and save
3. Wait ~5 sec
4. `GET /shopify/store/products` again

**Pass criteria:**
- [ ] Edited product's `title` updated
- [ ] Edited product's `id` is **the same** as in step 1 (this is the B-3.1 fix — verifying the fix actually works at runtime)
- [ ] Every other product's `id` is unchanged
- [ ] `productCount` and `productSummary` on the store still consistent

### 3.4 Product delete

1. Delete one product in Shopify admin
2. Wait ~5 sec
3. `GET /shopify/store/products`

**Pass criteria:**
- [ ] Deleted product gone from response
- [ ] All other 22+ ids unchanged

---

## 4. Failure-recovery paths — first live exercise

This is the highest-risk validation because **none of this code has ever run against a real Shopify call**. Every failure here is a real bug we won't catch any other way.

### 4.1 Persist-on-throw (registration fails during install)

**Setup:** kill ngrok mid-OAuth so the Shopify webhook subscribe call cannot reach back to our backend.

1. Disconnect any existing store in `/en/settings`
2. Start ngrok kill-on-trigger: open a second terminal, run `lsof -ti :4040 | xargs kill` ready to fire
3. Click "Connect Shopify"; on the Shopify auth screen, **before clicking Install**, kill ngrok (the OAuth callback won't reach the backend, but Shopify will mark the install)
   - Alternative: set `SHOPIFY_HOST_NAME` to a deliberately-wrong ngrok URL in `backend/.env` and restart backend first, then complete OAuth
4. Inspect DB:
   ```sql
   SELECT platform_data->'webhookStatus' FROM ecommerce_stores
   ORDER BY created_at DESC LIMIT 1;
   ```

**Pass criteria:**
- [ ] Row exists (install completed despite webhook failure — the install path doesn't fail for webhook hiccups)
- [ ] `webhookStatus.registered: []`
- [ ] `webhookStatus.failed` has at least one entry with the connection error
- [ ] `webhookHealth` from API returns `"pending"` (not `"unknown"` — that would mean the persist-on-throw never fired)

### 4.2 Retry queue actually fires

**Setup:** continuing from 4.1, restore correct `SHOPIFY_HOST_NAME`, restart backend.

1. Confirm a retry job is in the BullMQ queue:
   ```bash
   redis-cli KEYS 'bull:ecommerce-webhook-retry:*'
   ```
   Expect at least one `wait` or `delayed` job.
2. Watch backend logs for `[WebhookRetry] Processing job` — should fire after the configured backoff (~30s for first attempt)
3. After retry succeeds, re-check API:
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/shopify/store | jq .webhookHealth
   ```

**Pass criteria:**
- [ ] Retry job appears in Redis
- [ ] Worker processes it — log line confirms
- [ ] After successful retry, `webhookHealth` flips to `"ok"`
- [ ] DB `webhookStatus.registered` now contains all 8 topics

### 4.3 Retry exhaustion (skip if 4.2 succeeded; force this case separately)

**Setup:** point `SHOPIFY_HOST_NAME` at a deliberately-broken value (e.g. `localhost.invalid`) so every retry attempt fails.

1. Trigger retry by hitting the new endpoint with curl (since 4.2's natural retry already passed):
   ```bash
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/shopify/store/webhooks/reregister
   ```
2. Watch the queue — every attempt should fail (~30s, ~2min, ~8min apart)
3. After all 3 attempts fail, check DB:
   ```sql
   SELECT platform_data->'webhookStatus' FROM ecommerce_stores
   ORDER BY created_at DESC LIMIT 1;
   ```

**Pass criteria:**
- [ ] After 3rd attempt fails, `webhookStatus.exhausted = true`
- [ ] API returns `webhookHealth: "failed"`
- [ ] Sentry has an event tagged `service: shopify, stage: webhook-retry-exhausted`

### 4.4 Manual re-register endpoint recovers

**Setup:** continuing from 4.3 (state = exhausted/failed), restore correct `SHOPIFY_HOST_NAME`, restart backend.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/shopify/store/webhooks/reregister
```

**Pass criteria:**
- [ ] Response 200 with `webhookStatus.registered` containing all 8 topics
- [ ] DB shows `exhausted` cleared / `failed: []`
- [ ] Subsequent `GET /shopify/store` returns `webhookHealth: "ok"`

### 4.5 Frontend visibility — **GATED**

Cannot run today. Implementation gap:
- No badge on the integrations card reading `store.webhookHealth`
- No "Re-register webhooks" button calling `ecommerceApi.reregisterWebhooks()`

**Action required before this sub-section can run:**
1. Update the integrations card in `frontend/src/pages/integrations.tsx` (the connected-state branch around line 512) to read `store.webhookHealth` and render:
   - Green badge for `"ok"` (or no badge — design choice)
   - Amber "Webhook setup in progress" badge for `"pending"`
   - Red "Webhook delivery failed — re-register required" banner for `"failed"`, with a "Re-register webhooks" button
2. Wire the button to `ecommerceApi.reregisterWebhooks()` (already exposed in `frontend/src/lib/api.ts`)
3. Add i18n keys to `frontend/src/i18n/{en,ar}/integrations.json` (`webhookHealthOk`, `webhookHealthPending`, `webhookHealthFailed`, `reregisterWebhooks`)
4. Re-run section 4.5 with Chrome DevTools MCP:
   - Navigate to `/en/settings/integrations` while DB has `webhookHealth: "failed"` (force via DB or replay 4.3)
   - Screenshot — banner + button visible
   - Click button — POST fires, DB flips to `ok`, banner disappears
   - Confirm Arabic locale also renders correctly

---

## 5. AI reply correctness (Playground first, real DM second)

### 5.1 Playground sanity (5 min)

**Pre-req:** A Facebook page linked to the connected Shopify store. Verify:
```sql
SELECT p.page_id, p.page_name, s.store_domain
FROM pages p JOIN ecommerce_stores s ON p.ecommerce_store_id = s.id
WHERE s.platform = 'shopify' AND s.is_active = true;
```

If empty, link a page in `/en/settings/integrations` before continuing.

**Steps:** open `/admin/playground`, select that page, set channel = "Facebook DM", run these probes:

| Probe (Arabic) | Probe (English) | Expected behavior |
|---|---|---|
| `هل لديكم لابتوبات؟` | `do you have laptops?` | Lists actual product titles from the dev store; gives a real price; valid handle URL |
| `كم سعر [actual product name]؟` | `what's the price of [name]?` | Returns the real price + currency from `priceRange` |
| `ما هي سياسة الإرجاع؟` | `what's your return policy?` | Quotes from `policiesSummary` (refund policy synced from store) |
| `أين متجركم؟` | `where is your store?` | Links to the actual store domain (`storeDomain`) |
| `هل لديكم آيفون 99؟` (non-existent) | `do you sell iPhone 99?` (fake) | Says no / hedges — does NOT hallucinate a price |

**Pass criteria:**
- [ ] Replies reference real product titles (cross-check against `GET /shopify/store/products`)
- [ ] Prices match exactly (no hallucinated numbers — the post-processing check 1 in `openai.ts` should block this; verify it's working)
- [ ] Currency matches `storeCurrency`
- [ ] Product URLs resolve when clicked
- [ ] Non-existent product probe doesn't invent prices

**Failure modes to watch:**
- Generic answer ignoring store data → KB enrichment broken; check `contextEnricher.ts` and `productSummary` content
- Hallucinated price → post-processing check broken; investigate
- Empty `productSummary` → re-run `POST /shopify/store/sync`

### 5.2 Real Facebook DM end-to-end (15 min)

Only run after 5.1 is fully green.

1. Test page: "Jawab24 Test" (`1074356795756273`) — covered in memory
2. From a separate FB account, DM the test page: `كم سعر اللابتوبات عندكم؟`
3. Watch backend logs for `reply_sent` structured event:
   ```bash
   tail -f /tmp/backend.log | grep -E "reply_sent|generator|enrich"
   ```
4. The reply should arrive within 10–20 seconds

**Pass criteria:**
- [ ] DM reply arrives
- [ ] Reply quality matches Section 5.1 standards
- [ ] Logs show: webhook received → workspace resolved → AI generated → reply sent
- [ ] No errors in Sentry tagged `service: shopify` or `stage: generator`

---

## 6. Shopify mandatory-webhook compliance

App reviewers send synthetic webhooks during review. These must all return 200 within the timeout.

For each:
```bash
# Replace <secret> with config.shopify.apiSecret
SECRET="<secret>"
BODY='{"shop_domain":"demo-electronics.myshopify.com"}'
HMAC=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -X POST -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: $HMAC" \
  -H "X-Shopify-Shop-Domain: demo-electronics.myshopify.com" \
  -d "$BODY" \
  http://localhost:3000/shopify/webhooks/uninstall
```

**Pass criteria for each endpoint** (`/webhooks/uninstall`, `/gdpr/customers/data_request`, `/gdpr/customers/redact`, `/gdpr/shop/redact`):
- [ ] HTTP 200 with valid HMAC
- [ ] HTTP 401 with missing HMAC header
- [ ] HTTP 401 with wrong HMAC
- [ ] HTTP 200 within 5 seconds (Shopify timeout)
- [ ] No uncaught exception in logs (the `reportWebhookFailure` wrapper means crashes log a tagged Sentry event; verify nothing's there post-test)

For `gdpr/shop/redact` specifically:
- [ ] `is_active` flips to false in `ecommerce_stores`
- [ ] Subsequent webhook attempts to that shop are no-ops

---

## 7. Pre-submission gate

**Do not click Submit in Shopify Partners until every box below is ticked.**

- [ ] Section 2 (static checks) green
- [ ] Section 3 (install + incremental update + empty-body) all green on a fresh dev store
- [ ] Section 4.1 (persist-on-throw) verified
- [ ] Section 4.2 (retry actually fires) verified
- [ ] Section 4.3 (exhaustion writes the flag) verified
- [ ] Section 4.4 (manual re-register recovers) verified
- [ ] Section 4.5 (frontend badge + button) **either implemented and verified, OR explicitly deferred with a documented follow-up** (Shopify reviewers don't audit your UI for this CTA, but a merchant hitting an exhausted state with no UI is a UX trap waiting to file a support ticket)
- [ ] Section 5.1 (Playground product replies correct) green
- [ ] Section 5.2 (real DM works) green
- [ ] Section 6 (mandatory webhooks compliant) green
- [ ] `docs/testing/SHOPIFY_TEST_PLAN.md` bug log updated: A-1.5, A-1.9, B-3.1 marked CLOSED with commit hashes
- [ ] App listing assets uploaded (icon, screenshots, privacy policy URL, support email) — separate from code, do not skip
- [ ] `SHOPIFY_HOST_NAME` and `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` in production `.env` set to **prod** values, not dev (memory has both sets — easy to forget)

If any box is unticked, document why before submitting. App review rejection round-trips are 5–10 days each; one extra hour of validation here saves a week downstream.

---

## What this plan does NOT cover (out of scope, separate work)

- Salla and Zid generalization (they have the same bugs but no app-store deadline pressure)
- Performance under load (catalog > 1000 products, > 100 concurrent installs)
- Localization audit of new UI strings beyond the gated work in 4.5
- Penetration testing of OAuth flow
- Renewal of Shopify Partners account verification

These are real follow-ups but not blockers for this submission.
