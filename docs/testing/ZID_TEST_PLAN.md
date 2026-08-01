# Zid Integration — Live Validation & Pre-Publish Test Plan

> **Purpose:** Verify every Zid-facing feature end-to-end on the REAL dev store with REAL
> traffic before un-gating the integration (D-020) and before publishing to the Zid App
> Market. This is a tickable run-book — execute in order, log pass/fail, capture evidence.
>
> **Status: BLOCKED on Zid's agreement approval (external).** Everything else is ready.
> Code shipped dark in PR #586 (merged 2026-08-01); `ZID_CLIENT_ID` is unset in prod and
> the integrations page shows `coming_soon` until this plan's exit gates pass.
>
> **Companion docs:** `docs/integrations/zid.md` (verified API contract + `[provisional]`
> parser list), `SHOPIFY_TEST_PLAN.md` (same structure; shared-infrastructure cases mirror
> it). This plan supersedes the session file
> `~/.claude/plans/zid-live-validation-full-loop.md` — it is the authoritative run-book.

---

## Evidence discipline — captures-first is non-negotiable

**The Salla precedent (Phase 4.2, 2026-06-07):** live webhook bodies from a real Salla dev
store *contradicted* the doc-based research (`order.created` was real, the researched
rename was wrong, the shipment event never fired on a status flip). Every Zid parser is a
`[provisional]` fixture invented from docs.zid.sa — assume at least one envelope/event
surprise.

- Save **every raw webhook delivery** (headers + body, verbatim) and every notable API
  response to `zid_live_payloads.jsonl` (same convention as
  `memory/salla_phase42_real_payloads.jsonl`). The ngrok inspector
  (`http://127.0.0.1:4040`) records deliveries with headers — copy verbatim.
- Every capture ID below (**C1–C11**) must end up in that file. The fixture-finalization
  step (§K) consumes them one-to-one.
- A test that "passes" without its capture saved is NOT passed.

---

## Pre-flight: environment

| # | Item | How to verify | Status |
|---|------|---------------|:--:|
| P-1 | **Zid partnership agreement APPROVED** (submitted 2026-08-01, "In Review") | partner.zid.sa → Partnership page shows approved/signed agreement | ☐ |
| P-2 | Dev store **3195980 "Jawab24 Dev"** accessible and **OUT of maintenance mode** (maintenance blocked Salla's cart captures) | `https://h47p59.zid.store/` renders the storefront publicly | ☐ |
| P-3 | Partner app **7367** (Client ID 7192) reachable; decide dev-redirect strategy: dedicated DEV app (mirrors `Jawab24-Dev` on Salla, recommended) OR temporarily point app 7367's Redirection/Callback URLs at ngrok | Partner Dashboard → app → General Settings | ☐ |
| P-4 | Backend running locally with dev `.env`: `ZID_CLIENT_ID`, `ZID_CLIENT_SECRET`, `ZID_APP_ID`, `ZID_HOST_NAME=<ngrok host>`, `ZID_WEBHOOK_SECRET` (≥16 chars) | `curl http://localhost:3100/health` — ⚠️ backend runs on **3100** on this machine (3000 is taken by an unrelated dev server; check `lsof -iTCP:3000 -sTCP:LISTEN`, never kill what you find) | ☐ |
| P-5 | ai-worker running (port 3005) — the KB-enrichment reply and agent-tool cases need it | `curl http://localhost:3005/health` | ☐ |
| P-6 | ngrok tunnel to the backend; inspector open at `127.0.0.1:4040` | `https://<ngrok>/health` OK | ☐ |
| P-7 | At least one Facebook test page connected with a valid token (for §C/§D live DMs) | Pages list shows it | ☐ |
| P-8 | Test phone number that can receive real SMS (the order loop sends real messages) | — | ☐ |
| P-9 | Dev-store catalog seeded per §B-0 | Zid admin → Products | ☐ |
| P-10 | Partner Dashboard lifecycle webhook points at the tunnel for the session: `app.market.application.uninstall` → `https://<ngrok>/zid/webhooks?e=app.market.application.uninstall` (today it points at prod jawab24.com) | Dashboard → app → Webhooks | ☐ |

> ⚠️ **Do NOT click "Install App" on the dev store before P-3/P-4/P-6 are green** — the
> app's Redirection URL otherwise sends the OAuth flow to prod `jawab24.com`, where
> `ZID_CLIENT_ID` is unset and the flow dead-ends.
>
> ⚠️ Partner-dashboard Vue forms fight automation: v-model needs native-setter + events;
> "Save disabled" usually means a hidden required field (e.g. scope justification,
> 50–200 chars).

**Still-open questions this plan must answer from captures** (from
`docs/integrations/zid.md`): the OAuth **scope strings** for the authorize URL (dashboard
shows groups, not strings — fix `config.zid.scopes` from the real consent screen); whether
`ZID_APP_ID` (webhook `original_id`) is the app id **7367** or the Client ID **7192**;
what auth `app.market.*` lifecycle deliveries carry.

---

## A. OAuth Connect Loop (captures C1–C3)

### A-1. Logged-in connect (integrations page)
**Steps:** `/en/integrations` → Connect on the Zid card (`POST /zid/store/connect` →
authorize redirect) → approve on Zid → land back via `GET /zid/auth/callback`.

**Expected:**
- `ecommerce_stores` row: `platform='zid'`, `is_active=true`, **BOTH credentials
  encrypted** (`access_token` AND `authorization_token`/`_iv` — the dual-credential
  design, migration 0146), `store_domain` = hostname, `merchant_id` set
- Webhook registration ran: `platformData.webhookStatus` = **6/6 registered**
  (`product.create/update/publish/delete`, `order.create`, `order.status.update`)
- Background product sync enqueued

**Captures:**
- **C1 — token response**: form-urlencoded grant accepted? `Authorization` field present
  and its exact key casing? `expires_in` value. Note the **real scope string** shown on
  Zid's consent screen → fix `config.zid.scopes` if it differs.
- **C2 — profile envelope** (`/v1/managers/account/profile`): `user.store` nesting?
  `title` vs `name`, `url` vs `domain`, email location.
- **C3 — webhook subscription responses**: per-event status codes; confirm which id
  (7367 vs 7192) Zid accepted as `original_id`.

### A-2. Duplicate-subscription status (the 409-vs-422 pin)
**Steps:** `POST /zid/store/webhooks/reregister` (admin JWT) immediately after A-1.

**Expected:** All 6 events resolve as already-registered. **Capture the real duplicate
status code** — the code tolerates BOTH 409 and 422; pin the real one in the fixtures and
narrow the tolerance if Zid is unambiguous.

### A-3. Logged-out connect (pending-install claim path)
**Steps:** Log out → run the install from Zid's side → callback with no session →
pending install staged → log in → claim.

**Expected:** `pending_ecommerce_installs` row with BOTH encrypted credentials; after
login the claim creates/reactivates the store row; pending row consumed.

### A-4. Negatives
- Replayed callback (same `code` twice) → rejected, no second row, no token overwrite.
- Tampered/wrong `state` → 400, nothing persisted.

---

## B. Product Sync + KB (capture C4)

### B-0. Seed the dev store FIRST
Seed products covering every parser branch: Arabic-only name · `{ar,en}` multilingual
name+description · HTML-rich description · variants/options · an out-of-stock item ·
a draft/unpublished item · a `sale_price` item · **>100 products if feasible** (pins
pagination at the `page_size` boundary; cap check against shared `PRODUCT_SAFETY_CAP`).

### B-1. Full sync
**Steps:** `POST /zid/store/sync` (or wait for the post-connect sync).

**Expected:**
- `ecommerce_products` rows match the seeded catalog; localized fields Arabic-preferred;
  slug/handle, image shape, and status mapping (draft excluded or marked) all correct
- `product_count` and `last_sync_at` updated on the store row

**Capture — C4, products envelope**: `results` vs `store_products` vs `products`? Is
there a `next`/pagination field? Multilingual `name` shape confirmed?

### B-2. Scripted live smoke
**Steps:** `ADMIN_TOKEN=<jwt> npm run test:ecommerce:zid` (repo root).

**Expected:** Green — covers data quality, store info, page linking, and a
KB-enrichment reply that cites a real product.

### B-3. Incremental webhook (`product.update`)
**Steps:** Edit a product's price in the Zid admin.

**Expected:** Delivery hits `/zid/webhooks` (Basic-auth verified) → product sync
enqueued → row reflects the change. Save the delivery (headers + body) — it doubles as
the product-event envelope capture.

---

## C. Page Linking + Live DM (shared infrastructure)

Mirrors `SHOPIFY_TEST_PLAN.md` §C (link/unlink/multi-page/cross-workspace-rejection) —
same shared routes, so run the happy path plus the security case:

- **C-1.** Link the FB test page to the Zid store → `pages.ecommerce_store_id` set.
- **C-2.** Cross-workspace link attempt via forged workspace header → 403/404.
- **C-3.** Real DM to the linked page asking about a seeded product (Arabic) → reply
  cites the real Zid product/price; `dir`/language correct.

---

## D. AI Agent Tools + Real Search Params (capture C9)

**Steps:** Exercise `lookup_order` / `track_shipment` / `check_inventory` via the
playground AND via real DMs against the dev store (order placed in §E first for the
order tools).

**Expected:** Verification challenge before order data (never leak on failed
verification); inventory answers match the seeded catalog; Arabic queries resolve.

**Capture — C9, orders search/filter params:** the shipped code scans up to 3×100 recent
orders client-side behind the `findOrderByCode` seam because **no search param is
confirmed**. From the live API, resolve:
- the real order search/filter param (then swap the seam's internals — zero caller changes)
- **does the orders search index the customer phone?** (gates order auto-resolve —
  open question from `ECOMMERCE_POWER_FEATURES_PLAN.md`)
- same for `checkInventory`'s product search.

---

## E. Order Webhook Loop → SMS (captures C5–C8) — the round-trip that closes D-020

### E-1. `order.create` → order_confirmed SMS
**Steps:** Place a REAL order on the dev storefront with the test phone as customer.

**Expected:** Delivery Basic-auth verified → `customer_notifications_log` row
(`order_confirmed`, `delivered`) → **SMS arrives on the test phone**.

**Capture — C5**: headers (is `Authorization: Basic` present? exact scheme casing —
verification fails closed on `basic …`), envelope (`data` vs `order` vs root),
`customer.mobile` format (confirm full-intl-without-`+` → `normalizeZidPhone`),
`code`/`id` fields.

### E-2. Status → in-delivery → order_shipped SMS
**Steps:** Flip the order to in-delivery in the Zid admin (may need carrier config on
the dev store — Salla's shipment event needed a real shipment object).

**Expected:** `order.status.update` maps to shipped → SMS with tracking.
**Capture — C6**: status spelling (`indelivery` vs `inDelivery`), tracking field
location (`tracking_number` vs `shipping.*`).

### E-3. Status → delivered → order_delivered SMS
**Capture — C7**: the delivered payload. Expected: delivered SMS (+ review request if
configured).

### E-4. Payment field
**Capture — C8**: does `payment_status` exist on orders? Finalize the `'unknown'`
mapping either way.

### E-5. Dedupe on redelivery
**Steps:** Redeliver the same `order.create` (Zid dashboard redelivery if available;
otherwise replay the captured delivery verbatim with curl).

**Expected:** No duplicate `customer_notifications_log` row (deduped by
`(store, type, platform_event_id)`); no second SMS.

### E-6. Auth negatives
- Delivery with wrong Basic password → **401** AND the scheme-only `warn` log fires
  (never log the password).
- Delivery with no auth header at all → 401.

---

## F. Refresh + Lifecycle (captures C10–C11)

### F-1. Token refresh
**Steps:** Shrink `token_expires_at` in the dev DB to <24h → trigger the shared
refresher (`ecommerceTokenRefresh.ts`).

**Expected:** Refresh grant succeeds; store row updated.
**Capture — C10**: does the refresh response **rotate the `Authorization` token**?
(Both paths shipped — pin which is real and narrow.)

### F-2. Uninstall lifecycle
**Steps:** Uninstall the app from the dev-store admin.

**Expected:** `app.market.application.uninstall` delivery arrives at `/zid/webhooks`
(via the `?e=` hint) → store deactivated → old tokens actually invalid (a direct API
call with them 401s — verify, don't assume).

**Capture — C11 + DECISION POINT**: what auth does the lifecycle delivery carry? If NO
Basic auth → decide between a separate lifecycle route with store cross-check vs relying
on sync-failure reauth marking — **decide from the capture, don't pre-build**.

### F-3. Reinstall
**Steps:** Reinstall + reconnect.

**Expected:** Same store row reactivates with a FRESH credential pair; no duplicates;
webhooks re-registered 6/6.

---

## G. Multi-Tenant Security

- **G-1.** Cross-workspace store access: workspace B hits `GET /zid/store/products`
  scoped to workspace A's store → 403 or correctly-scoped empty result.
- **G-2.** Webhook spoofing: valid-shaped body, wrong Basic credentials → 401, no writes.
- **G-3.** Workspace B's AI replies never surface workspace A's Zid catalog (DM test).

---

## H. Billing — Zid App Market subscriptions (SPEC — blocked on the Zid billing PR)

> ⛔ **Not runnable yet**: the Zid billing PR does not exist. This section pins what that
> PR must make testable, so the PR is written against these cases. Architecture ruling:
> mirror **D-054**'s local-mirror model but **webhook-driven** — unlike Shopify, Zid
> delivers `app.market.subscription.*` lifecycle events. Reuse the
> `config/shopifyBilling.ts` vocabulary where it generalizes; add a `zid` entry to
> `LAZY_EXPIRY_CANARIES` (never another copied if-block). The PR must also append the
> owed DECISIONS entries: no-Starter-on-marketplaces (ecommerceEnabled=false makes the
> app useless on Starter), the gross-up principle (SAR price nets ≈ Stripe USD after
> Zid's 20% + VAT), and the 14-day marketplace trial.

Plans as configured (PROVISIONAL — owner defers final pricing until WHT confirmed):
Business/الأعمال id 3740 = 189 SAR · Pro/الاحترافي id 3741 = 379 SAR · Recurring,
1 month, 14-day trial. Editable until publish.

| ID | Test | Expected |
|----|------|----------|
| H-1 | Subscribe on the dev store (trial) | `app.market.subscription.active` (or install-time equivalent — CAPTURE the real first event) → local mirror row `payment_method='zid'`, status `trialing`, subject = workspace OWNER |
| H-2 | Trial expiry / `subscription.expired` | Mirror pauses or expires per the PR's ruling; lazy-expiry canary does NOT fire when webhooks do their job |
| H-3 | `subscription.renew` | Period advances contiguously; no duplicate row |
| H-4 | `subscription.upgrade` | `plan_id` moves; usage window handled per ruling |
| H-5 | Unknown plan id/name in a subscription event | NO activation; Sentry; fail-loud (the D-054 principle) |
| H-6 | Uninstall while subscribed | Mirror canceled; no paid local sub outlives the app |
| H-7 | Stripe-paying workspace subscribes on Zid | Adoption REFUSED (D-H analog); Sentry; human decides |
| H-8 | While zid-billed: all six Stripe surfaces | 400 rejection (the D-G analog), canceled-mirror exemption honored |
| H-9 | Missed webhook (deliver failure window) | Whatever reconcile/verify mechanism the PR ships heals the mirror — the return-endpoint-must-not-be-SPOF principle (Shopify O-6) applies here as webhook-must-not-be-SPOF |

**Capture every `app.market.*` delivery** — the subscription-event envelopes are as
unconfirmed as everything else was.

---

## I. Real-Traffic Soak & Robustness

> Run AFTER §A–§F are green. Same philosophy as `SHOPIFY_TEST_PLAN.md` §Q: the unit
> suites prove logic; this proves the integration under the traffic shapes production
> actually sees. At current scale the binding risk is contract surprises, not load —
> so each case doubles as a capture opportunity.

### I-1. Live DM soak (real AI traffic)
**Steps:** Over ~1 hour, send ≥30 real DMs to the linked page mixing: Arabic dialects +
فصحى + English, product questions (in and out of catalog), order lookup, follow-ups,
rapid-fire consecutive messages.

**Expected:**
- Every reply grounded (prices only from the synced catalog; "let me check" on unknowns)
- Consolidation merges rapid-fire messages; no double replies
- Phase 6.5 counters stay coherent for the window: `attempts == returns`,
  `returns == logged` (or explained by cache hits / refusals — see
  `scripts/phase6_5_breakdown.ts`); zero `failed_before_log:*:AiWorkerUnreachable`
- No reply-latency regression: cache-hit replies in ms; misses within the 2–4s OpenAI
  band (Rule 17 — don't eyeball, read the stage laps)

### I-2. Webhook burst / dedupe under fire
**Steps:** Replay the captured `order.create` delivery 10× within ~5s (curl, verbatim
headers+body), interleaved with 2 distinct real orders.

**Expected:** Exactly 1 notification row + 1 SMS per DISTINCT order; replays all 200
(or Zid's semantics — capture) but produce zero duplicate side effects.

### I-3. Endpoint-down window (Zid's redelivery policy — UNKNOWN, capture it)
**Steps:** Stop the backend (keep ngrok up → 502s) for ~5 minutes; during the window,
place 1 real order and 1 product edit; restart.

**Expected/Capture:** Does Zid retry? With what backoff, for how long? This is
UNDOCUMENTED and determines how much §H-9-style healing matters. If deliveries are
simply LOST, record that as a hard finding — sync-on-reconnect and any billing
reconcile become mandatory, not defensive.

### I-4. Sync-vs-webhook race
**Steps:** Trigger a full `store/sync` and, mid-sync, fire product edits in the admin.

**Expected:** Both complete; final DB state matches the admin; no deadlock, no
duplicate rows.

### I-5. Rate limiting (capture)
**Steps:** During B-1's >100-product sync, watch response headers.

**Capture:** Any rate-limit headers / 429 behavior Zid exposes (nothing is documented).
If throttling appears, verify the sync retries rather than truncating (the old silent
300-product truncation is D-020 history — must not regress).

---

## J. Publish Rehearsal (Zid App Market)

1. Read the app-listing copy in the Partner Dashboard (bilingual descriptions, AR
   screenshots — currently the Salla gallery set) against what §A–§I proved. Every
   claim maps to a passing test ID or gets removed. Screenshots should be re-shot
   with Zid UI before publish (`docs/store-listing/` pipeline pattern).
2. Clean install on a FRESH store (not the seeded dev store) as a new merchant; time
   install → first grounded AI reply. Target <10 min.
3. Pricing final check with the owner (189/379 SAR are provisional; WHT answer
   outstanding) — plans are editable until publish, NOT after.
4. Support obligations rehearsal: the agreement binds to 48h support response with
   invoice penalties — confirm `info@jawab24.com` is monitored.

---

## K. Finalize + Un-Gate (exit)

1. Fold every capture (C1–C11 + §H/§I captures) into the test fixtures; finalize all
   `[provisional]` parsers; delete the markers (grep
   `[provisional — pending Zid live captures]` — must return zero).
2. Green: full backend suite + `npm run test:ecommerce:zid`.
3. Prod cutover: prod app Redirection/Callback → `jawab24.com`; set `ZID_*` in
   `env/backend.env`; deploy — remember `up -d --force-recreate --no-deps` +
   `nginx -s reload` (a plain restart does NOT reload env); point the dashboard
   lifecycle webhook back at prod.
4. Only then: remove the `coming_soon` badge (`frontend/src/pages/integrations.tsx`),
   flip the status tables in `.planning/codebase/INTEGRATIONS.md` +
   `SYSTEM_ANALYSIS.md` + `docs/integrations/zid.md`, and append the D-NNN that closes
   D-020's gate.

## Exit gates

**D-020 gate (functional, all with saved captures):**
connect → both creds stored → products synced → KB reply cites a real product →
`order.create` SMS → in-delivery shipped-SMS (with tracking) → delivered SMS →
uninstall deactivates the store → reconnect works → refresh proven.

**Publish gate:** D-020 gate + §G security + §I soak/robustness + §J rehearsal +
(once the billing PR exists) §H billing cases green.

**Effort estimate once P-1 lands:** 1–2 focused sessions for §A–§F (Salla's equivalent
took one evening); §H after its PR; §I adds ~half a session.

---

## How to use this doc

Work top to bottom; §A–§F in order (each builds on the last), §G–§I after. Log
pass/fail inline (☐ → ✅/❌ + date), file bugs as you go, and keep
`zid_live_payloads.jsonl` growing. Re-run affected sections after every Zid-touching
code change before publish.

## Change log

- 2026-08-01: Created — absorbs the session capture plan (C1–C11, D-020 exit) and adds
  billing spec (§H), real-traffic soak/robustness (§I), and publish rehearsal (§J).
