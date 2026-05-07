# E-commerce Launch Validation — Reusable Template

> **Purpose:** Single source-of-truth checklist for validating an e-commerce
> integration before submitting to its App Store / Partner Marketplace.
>
> Each platform (Shopify, Salla, Zid, …) inherits this template via a thin
> `<PLATFORM>_LAUNCH_VALIDATION.md` file that overrides only what genuinely
> differs (callback URL, dev store, HMAC encoding, mandatory-webhook contract,
> Partners-portal mechanics).
>
> **How to use this file:**
> 1. Read the platform-specific override file (e.g. `SALLA_LAUNCH_VALIDATION.md`).
> 2. The override file says *"follows ECOMMERCE_LAUNCH_VALIDATION.md sections X–Y, with these substitutions."*
> 3. Walk this file's section list, applying the substitutions table from the override.
>
> Adding a new section here propagates to every platform automatically.

---

## Section 0 — Readiness assessment

Before running anything, fill in this table for the platform under test:

| Layer | State | Confidence |
|---|---|---|
| Code shape (tsc, lint, unit + regression tests) | | |
| Install pipeline (logged-in OAuth) | | |
| Install pipeline (platform-first install — claim during login) | | |
| Incremental update pipeline (sync, product webhooks) | | |
| Webhook hardening (retry queue, persist-on-throw, reregister endpoint) | | |
| Frontend `webhookHealth` recovery UI | | |
| AI reply correctness with synced store data | | |
| Mandatory-webhook compliance (`app.uninstalled` and any platform-specific GDPR endpoints) | | |

**Verdict:** Submission readiness is gated on every row reading "Complete — High confidence" or being explicitly waived with a documented reason.

---

## Section 1 — Pre-flight (5 min)

```bash
# Run from repo root.
/shopify-dev                                    # starts ngrok + backend + frontend
```

Confirm:
- [ ] Backend running on `localhost:3000`
- [ ] Frontend running on `localhost:3001`
- [ ] ngrok URL captured; `<PLATFORM>_HOST_NAME=<ngrok>` in `backend/.env`
- [ ] Platform's Partners app redirect URLs include `https://<ngrok>/<platform>/auth/callback`
- [ ] Local DB reachable (`psql postgres://aliahdab@localhost:5432/postgres -c '\dt'`)
- [ ] Redis reachable (`redis-cli ping` → `PONG`)
- [ ] Workers logged at startup: `Reply processing worker started`, `Customer notification worker started`, `[WebhookRetry] Worker started` *(the retry worker now dispatches via `integrationRegistry.get(platform).registerWebhooks(store)` — Phase 1.4 of the platform-agnostic lift; verify it actually logs at startup)*

**Stop-the-line:** if the webhook retry worker doesn't log at startup, the retry path is broken — stop and fix before proceeding.

---

## Section 2 — Static validation (re-confirm)

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

All four green. If any regress, stop.

---

## Section 3 — Install pipeline

Use a **fresh** dev store. Reset/recreate if you've already authorized the app once on it.

### 3.1 Connect store via the merchant-side flow

1. From `/en/integrations` click "Connect Store" (or initiate from the platform's App Store listing for the platform-first variant — see 3.5).
2. Authorize on the dev store.
3. Watch backend logs — the install path should:
   - Create the `ecommerce_stores` row
   - Call `registerWebhooksWithPersist(store.id, '<platform>', () => adapter.registerWebhooks(...))` and **await** it
   - Save `webhookStatus` to `platform_data` JSONB
4. Verify in DB:
   ```sql
   SELECT id, store_domain, is_active,
     platform_data->'webhookStatus'->'registered' AS registered,
     platform_data->'webhookStatus'->'failed'    AS failed,
     platform_data->'webhookStatus'->'exhausted' AS exhausted
   FROM ecommerce_stores
   WHERE platform = '<platform>'
   ORDER BY created_at DESC LIMIT 1;
   ```
5. Verify via API:
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/<platform>/store | jq .webhookHealth
   ```
   Expected: `"ok"`

**Pass criteria:**
- [ ] All expected webhook topics (see override file for the exact list) appear in `registered`
- [ ] `failed` is `[]`
- [ ] `exhausted` is `null` or absent
- [ ] API returns `webhookHealth: "ok"`

### 3.2 Empty-body / malformed sync request (regression)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3000/<platform>/store/sync
```

**Pass criteria:**
- [ ] HTTP 200 (not 400 "Unexpected end of JSON input")

### 3.3 Incremental product update

1. `GET /<platform>/store/products` and snapshot all `(id, platformProductId, title)` tuples
2. In the platform's admin UI, edit one product's title and save
3. Wait ~5 sec
4. `GET /<platform>/store/products` again

**Pass criteria:**
- [ ] Edited product's `title` updated
- [ ] Edited product's `id` is **the same** as in step 1 (regression — guards the upsert path against accidental re-creation)
- [ ] Every other product's `id` is unchanged
- [ ] `productCount` and `productSummary` on the store still consistent

### 3.4 Product delete

1. Delete one product in the platform's admin
2. Wait ~5 sec
3. `GET /<platform>/store/products`

**Pass criteria:**
- [ ] Deleted product gone from response
- [ ] All other product ids unchanged

### 3.5 Platform-first install (claim flow) — only if the platform supports it

When the merchant initiates from the platform's App Store rather than from `/en/integrations`:
1. Click Install in the platform's App Store
2. The OAuth callback creates a `pending_ecommerce_installs` row (encrypted token, 30-min TTL)
3. Sets a signed cookie redirecting to login
4. After Facebook OAuth completes, `claimPendingInstall` consumes the cookie and finalizes the store

**Pass criteria:**
- [ ] Pending install row exists with `expiresAt > now`
- [ ] After claim, `ecommerce_stores` row exists, `pending_ecommerce_installs` row removed
- [ ] `webhookStatus` populated as in 3.1

---

## Section 4 — Failure-recovery paths (highest-risk validation)

These exercise the retry queue, persist-on-throw, exhaustion flag, manual reregister endpoint, and frontend recovery UI. **Run every sub-section.**

### 4.1 Persist-on-throw (registration fails during install)

**Setup:** kill ngrok mid-OAuth, OR set `<PLATFORM>_HOST_NAME` to a deliberately-wrong value before starting OAuth.

1. Disconnect any existing store
2. Trigger Connect, complete OAuth on the platform side
3. Inspect DB: `SELECT platform_data->'webhookStatus' FROM ecommerce_stores ORDER BY created_at DESC LIMIT 1;`

**Pass criteria:**
- [ ] Store row exists (install completes despite webhook failure — install path must not crash)
- [ ] `webhookStatus.registered: []`
- [ ] `webhookStatus.failed` has at least one entry
- [ ] API returns `webhookHealth: "pending"` (not `"unknown"`)
- [ ] A retry job appears in BullMQ: `redis-cli KEYS 'bull:ecommerce-webhook-retry:*'` returns ≥1 entry

### 4.2 Retry queue actually fires

**Setup:** continuing from 4.1, restore correct `<PLATFORM>_HOST_NAME`, restart backend.

1. Watch logs for `[WebhookRetry] Processing job` (fires after the configured backoff — first attempt at ~30s)
2. After the retry succeeds, re-check API: `curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/<platform>/store | jq .webhookHealth`

**Pass criteria:**
- [ ] Worker processes the retry job (log line confirms)
- [ ] After successful retry, `webhookHealth` flips to `"ok"`
- [ ] DB `webhookStatus.registered` now contains every expected topic

### 4.3 Retry exhaustion

**Setup:** point `<PLATFORM>_HOST_NAME` at a deliberately-broken value (e.g. `localhost.invalid`) so every retry attempt fails.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/<platform>/store/webhooks/reregister
```

Wait through 3 attempts (~30s, ~2min, ~8min apart).

**Pass criteria:**
- [ ] After the 3rd attempt fails, `webhookStatus.exhausted = true`
- [ ] API returns `webhookHealth: "failed"`
- [ ] Sentry has an event tagged `service: <platform>, stage: webhook-retry-exhausted`

### 4.4 Manual reregister recovers from exhaustion

**Setup:** continuing from 4.3 (state = exhausted/failed), restore correct `<PLATFORM>_HOST_NAME`, restart backend.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/<platform>/store/webhooks/reregister
```

**Pass criteria:**
- [ ] Response 200 with `webhookStatus.registered` containing every expected topic
- [ ] DB shows `exhausted` cleared, `failed: []`
- [ ] Subsequent `GET /<platform>/store` returns `webhookHealth: "ok"`

### 4.5 Frontend recovery UI

1. Force `webhookHealth: "failed"` in the DB (replay 4.3 or `UPDATE ecommerce_stores SET platform_data = jsonb_set(platform_data, '{webhookStatus,exhausted}', 'true') WHERE platform = '<platform>'`)
2. Load `/en/integrations` (and `/ar/integrations` to verify RTL)
3. Verify red banner reading "Connection problem" + "Try again" button on the platform's connected store card
4. Click "Try again" — DB flips to `ok`, banner disappears, success toast renders
5. Confirm POST in browser devtools network panel hits `/<platform>/store/webhooks/reregister`

**Pass criteria:**
- [ ] Banner + button render in both `en` and `ar` locales
- [ ] Click triggers the right platform-specific endpoint
- [ ] Success toast translates correctly in both locales

---

## Section 5 — AI reply correctness

### 5.1 Playground sanity (5 min)

**Pre-req:** A Facebook page linked to the connected store. Verify:
```sql
SELECT p.page_id, p.page_name, s.store_domain
FROM pages p JOIN ecommerce_stores s ON p.ecommerce_store_id = s.id
WHERE s.platform = '<platform>' AND s.is_active = true;
```

If empty, link a page in `/en/integrations` before continuing.

**Steps:** open `/admin/playground`, select that page, set channel = "Facebook DM", run Arabic + English probes against:
- "Do you have <generic product type from synced catalog>?" → returns real product titles + prices, not hallucinations
- "What's the price of <real product name>?" → returns the exact synced price + currency
- "What's your return policy?" → quotes from `policiesSummary` (synced from store)
- "Where is your store?" → links to actual `storeDomain`
- "Do you sell <fake product not in catalog>?" → declines / hedges, does NOT invent a price

**Pass criteria:**
- [ ] Replies reference real product titles (cross-check against `GET /<platform>/store/products`)
- [ ] Prices match exactly — the post-processing checks in `openai.ts` should block hallucinated prices
- [ ] Currency matches `storeCurrency`
- [ ] Product URLs resolve when clicked
- [ ] Non-existent product probe doesn't invent prices

### 5.2 Real Facebook DM end-to-end (15 min)

Only run after 5.1 is fully green.

1. Use the test page captured in user memory (`Jawab24 Test`, page id `1074356795756273`).
2. From a separate FB account, DM the page about a product on the connected store.
3. Watch backend logs:
   ```bash
   tail -f /tmp/backend.log | grep -E "reply_sent|generator|enrich"
   ```
4. Reply should arrive within 10–20 seconds.

**Pass criteria:**
- [ ] DM reply arrives
- [ ] Reply quality matches Section 5.1 standards
- [ ] Logs show: webhook received → workspace resolved → AI generated → reply sent
- [ ] No errors in Sentry tagged `service: <platform>` or `stage: generator`

---

## Section 6 — Mandatory-webhook compliance

App reviewers send synthetic webhooks during review. Each must return 200 within the platform's stated timeout.

The exact endpoint set varies by platform (Shopify requires GDPR; Salla does not). The override file lists the platform's required endpoints.

For each endpoint:
- [ ] HTTP 200 with valid HMAC
- [ ] HTTP 401 with missing HMAC header
- [ ] HTTP 401 with wrong HMAC
- [ ] Response within the platform's stated timeout (Shopify: 5s; check override file)
- [ ] No uncaught exception in logs (the `reportWebhookFailure` wrapper means crashes log a tagged Sentry event; verify nothing's there post-test)

For uninstall-equivalent endpoints specifically:
- [ ] `is_active` flips to false in `ecommerce_stores`
- [ ] Subsequent webhook attempts to that store are no-ops

---

## Section 7 — Pre-submission gate

**Do not submit to the platform's App Store until every box below is ticked or explicitly waived.**

- [ ] Section 2 (static checks) green
- [ ] Section 3.1–3.4 (install + incremental update + empty-body) green on a fresh dev store
- [ ] Section 3.5 (platform-first install) green if the platform supports that flow
- [ ] Section 4.1 (persist-on-throw) verified
- [ ] Section 4.2 (retry actually fires) verified
- [ ] Section 4.3 (exhaustion flag) verified
- [ ] Section 4.4 (manual reregister recovers) verified
- [ ] Section 4.5 (frontend banner + button) verified in both `en` and `ar`
- [ ] Section 5.1 (Playground product replies correct) green
- [ ] Section 5.2 (real DM works) green
- [ ] Section 6 (mandatory webhooks compliant) green
- [ ] Bug log in the platform's `<PLATFORM>_TEST_PLAN.md` updated: any deviations marked CLOSED with commit hashes
- [ ] App listing assets uploaded (icon, screenshots, privacy policy URL, support email) — separate from code, do not skip
- [ ] Production env vars set to **prod** values, not dev (memory has both sets — easy to forget)

If any box is unticked, document the waiver before submitting. App-review rejection round-trips are 5–10 days each; one extra hour of validation here saves a week downstream.

---

## What this template does NOT cover (out of scope; separate work)

- Performance under load (catalog > 1000 products, > 100 concurrent installs)
- Localization audit of every UI string
- Penetration testing of the OAuth flow
- Renewal of the platform's Partners account verification
- DM-based abandoned cart recovery + order notifications (Phase 3 of the launch plan; ships post-approval as v1.1)

These are real follow-ups but not blockers for app-store submission.
