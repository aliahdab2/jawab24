# Zid Integration — Live Validation & Pre-Publish Test Plan

> **Purpose:** Verify every Zid-facing feature end-to-end on the REAL dev store with REAL
> traffic before un-gating the integration (D-020) and before publishing to the Zid App
> Market. This is a tickable run-book — execute in order, log pass/fail, capture evidence.
>
> **Status: NOT blocked externally — this run-book is the next action.**
> Zid support confirmed the real order on 2026-08-08/09: app **Draft → In Review → Zid's
> technical review passes → agreement countersigned**. The agreement is the EXIT, never an
> entry condition; the earlier "blocked on the agreement" header was wrong and cost eight
> idle days (08-01 → 08-09).
>
> App 7367 was submitted and **REJECTED on 2026-08-10**: *"OAuth does not yet meet our
> required standards. Key updates needed: • Direct merchant access (no sign-in prompt)
> • Full data integration with Zid."* The first bullet is addressed by the Embedded Apps
> work (§L below); the second needs §H billing plus a green §A–§F. Prod env vars ARE set
> (`ZID_CLIENT_ID`=7192 verified live); `ZID_CLIENT_SECRET` remains the one unverified
> value — §A-1 is what proves it.
>
> ✅ **Current status, portal-verified 2026-08-22: app 7367 is `In review`.** It was
> flipped `Draft` → `In review` on 08-09; Zid's reviewer install on 08-11 hit an error on
> our side that was fixed and deployed the same day; Zid said on 08-12 it would retest
> shortly and the 08-18 follow-up is still unread. So the app is **installable by a
> reviewer at any moment** — this plan is now waiting on Zid, not on a resubmission.
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
| P-1 | ⛔ **INVERTED 2026-08-11 — the agreement is NOT a precondition.** It is countersigned only AFTER Zid's technical review passes (Zid support, 08-08/09), so this run-book runs FIRST. Nothing here waits on partner.zid.sa. | Agreement state is an EXIT check in §K, not an entry one | n/a |
| P-1b | App **7367 is `In review`** — flipped from `Draft` on 08-09 after Zid support pointed out it was sitting in Draft. ⚠️ **A Draft app is not queued and nobody is reviewing it**, and nothing notifies you: it looked like "waiting on Zid" for days while the app was not in the queue at all. What put it back in Draft is NOT established — do not assume. Re-read the status in the portal whenever the wait feels long. | partner.zid.sa → My Apps → row 7367 shows `In review` | ☑ verified 2026-08-22 |
| P-2 | Dev store **3195980 "Jawab24 Dev"** accessible and **OUT of maintenance mode** (maintenance blocked Salla's cart captures). Store email **`qwhfqfihvm@zam-partner.email`** — ✅ confirmed to have NO existing Jawab24 account (2026-08-22), so §L's account-takeover guard will not fire and the auto-provision path is genuinely exercised. Re-check that before every §L run; if it ever has one, §L-1 fails for the WRONG reason. | `https://h47p59.zid.store/` renders the storefront publicly | ☑ 200, verified 2026-08-22 |
| P-3 | **Dev-redirect strategy: DECIDED 2026-08-22 — run against PRODUCTION, change nothing in the portal.** App 7367 (Client ID 7192) already points at `https://jawab24.com/zid/auth/callback` and prod answers (see the revised warning below). While 7367 is `In review` this is the only route that cannot disturb the review, and it exercises exactly what the reviewer walks. The ngrok and dedicated-DEV-app options stay documented for when the app is not under review. **On the production route, P-4, P-5, P-6 and P-10 do not apply.** | Partner Dashboard → app → General Settings shows the prod callback | ☑ |
| P-4 | Backend running locally with dev `.env`: `ZID_CLIENT_ID`, `ZID_CLIENT_SECRET`, `ZID_APP_ID`, `ZID_HOST_NAME=<ngrok host>`, `ZID_WEBHOOK_SECRET` (≥16 chars) | `curl http://localhost:3100/health` — ⚠️ backend runs on **3100** on this machine (3000 is taken by an unrelated dev server; check `lsof -iTCP:3000 -sTCP:LISTEN`, never kill what you find) | ☐ |
| P-5 | ai-worker running — the KB-enrichment reply and agent-tool cases need it. Default port **3002** (`ai-worker/src/config.ts`); if you run it on 3005 per the worktree convention, you MUST also set `AI_SERVICE_URL=http://localhost:3005` on the backend or every reply dies `AiWorkerUnreachable` | `curl http://localhost:3002/health` (or 3005 + matching `AI_SERVICE_URL`) | ☐ |
| P-6 | ngrok tunnel to the backend; inspector open at `127.0.0.1:4040` | `https://<ngrok>/health` OK | ☐ |
| P-7 | At least one Facebook test page connected with a valid token (for §C/§D live DMs) | Pages list shows it | ☐ |
| P-8 | Test phone number that can receive real SMS (the order loop sends real messages) | — | ☐ |
| P-9 | Dev-store catalog seeded per §B-0 | Zid admin → Products | ☐ |
| P-10 | Partner Dashboard lifecycle webhook points at the tunnel for the session: `app.market.application.uninstall` → `https://<ngrok>/zid/webhooks?e=app.market.application.uninstall` (today it points at prod jawab24.com) | Dashboard → app → Webhooks | ☐ |

> ⛔ **REVISED 2026-08-22 — the warning below was built on a false premise and now points
> the wrong way.** It used to read: *"Do NOT click Install App on the dev store before
> P-3/P-4/P-6 are green — the app's Redirection URL otherwise sends the OAuth flow to prod
> `jawab24.com`, where `ZID_CLIENT_ID` is unset and the flow dead-ends."* `ZID_CLIENT_ID`
> is **set** (7192) and prod `/zid/auth` returns its 302 — verified again 2026-08-22. So
> installing against **production** does not dead-end; it is the *safest* route, and the
> tunnel was never required for a first capture.
>
> ⚠️ **While app 7367 is `In review`, prefer the production route and change NOTHING in
> the portal.** Editing the app to point at a tunnel risks two things at once: it may drop
> 7367 back to `Draft` (a Draft app leaves the review queue silently — see P-1b), and if
> Zid's reviewer installs during your tunnel window they reach your laptop or a dead URL,
> costing a second review round. The ngrok route (P-3/P-6/P-10) is for when the app is NOT
> under review.
>
> ⚠️ **If a production-route install fails halfway, it leaves an orphan account that will
> block the reviewer's install** (same failure mode as 08-11 — see R-4 in
> `docs/integrations/zid.md`). Re-check R-4 immediately after any failed attempt and clean
> up before walking away.
>
> ⚠️ Partner-dashboard Vue forms fight automation: v-model needs native-setter + events;
> "Save disabled" usually means a hidden required field (e.g. scope justification,
> 50–200 chars).

> ✅ **Scope strings: RESOLVED 2026-08-11, no capture needed.** The dashboard's scope
> matrix (Account R, Account Identity R, Store Core Details R, Orders R, Products R,
> Webhooks RW) is what grants permissions — it is NOT expressed in the authorize URL. The
> only scope Zid documents for that parameter is `embedded_apps_tokens_write`
> (docs.zid.sa/embedded-apps Step 1), which is now what `config.zid.scopes` sends. The
> previous value was four invented names.

**Still-open questions this plan must answer from captures** (from
`docs/integrations/zid.md`): whether
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
  design, migration 0146), `store_domain` = hostname, merchantId present in
  `platform_data->>'merchantId'` (there is no `merchant_id` column on
  `ecommerce_stores` — only on `pending_ecommerce_installs`)
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
(`notification_type='order_confirmed'`, `status='sent'` — the enum is
pending/sent/failed/cancelled; there is no `delivered` status) → **SMS arrives on the
test phone**.

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

## H. Billing — Zid App Market subscriptions (rail SHIPPED; live validation blocked on EC3)

> ✅ **The Zid billing PR exists.** `services/zidBilling.ts` + `config/zidBilling.ts`,
> migration 0161 (`subscriptions.zid_store_id` + partial unique index + CHECK), the
> `zid` entry in `LAZY_EXPIRY_CANARIES`, the 6-hourly `ZidBillingReconcile` cron, and
> the webhook triggers in `controllers/zid.ts`. Rulings appended: **D-070** (verify-first),
> **D-071** (no Starter on marketplaces), **D-072** (gross-up), **D-073** (one marketplace
> guard). The 14-day trial is recorded in D-072 with the provisional pricing.
>
> ⚠️ **The architecture ruling below CHANGED.** This section originally specified a
> **webhook-driven** design. D-070 supersedes that: Zid documents
> `GET /v1/market/app/subscription`, so the API is the authority and
> `app.market.subscription.*` deliveries are only TRIGGERS that call the choke point
> `syncZidBilling(storeId)`. That closes H-9 by construction — a missed delivery is at
> most a six-hour delay, healed by the reconciler — and means an uncaptured envelope
> cannot write wrong billing state, because nothing is read out of it.
>
> ⛔ **Still not captured against a live store**, though no longer blocked by `EC3`: app
> 7367 is `In review` (portal-verified 2026-08-22), so an install is possible the moment
> Zid's reviewer runs one — the capture simply has not happened yet.
> H-1…H-9 below are covered at the UNIT level by
> `backend/test/services/zidBilling.test.ts` (40 cases) and
> `backend/test/controllers/zid.test.ts` (webhook wiring) against an envelope inferred
> from Zid's docs. **Unit-green is NOT the live validation this section asks for** — the
> rows below stay open until they are run against a real dev store.

Plans as configured (PROVISIONAL — owner defers final pricing until WHT confirmed):
Business/الأعمال id 3740 = 189 SAR · Pro/الاحترافي id 3741 = 379 SAR · Recurring,
1 month, 14-day trial. Editable until publish.

| ID | Test | Expected |
|----|------|----------|
| H-1 | Subscribe on the dev store (trial) | `app.market.subscription.active` (or install-time equivalent — CAPTURE the real first event) → local mirror row `payment_method='zid'`, status `trialing`, subject = workspace OWNER |
| H-2 | Trial expiry / `subscription.expired` | Mirror → `paused` (not canceled: the app is still installed, re-subscribing recovers); lazy-expiry canary does NOT fire when the triggers work |
| H-3 | `subscription.renew` | Period advances contiguously from the previous end; no duplicate row |
| H-4 | `subscription.upgrade` | `plan_id` moves; usage window re-initialized to the new period |
| H-5 | Unknown plan id/name in a subscription event | NO activation; Sentry; fail-loud (the D-054 principle) |
| H-6 | Uninstall while subscribed | Mirror canceled; no paid local sub outlives the app |
| H-7 | Stripe-paying workspace subscribes on Zid | Adoption REFUSED (D-H analog); Sentry; human decides |
| H-8 | While zid-billed: all six Stripe surfaces | 400 `ZID_BILLED` (the D-G analog), canceled-mirror exemption honored |
| H-9 | Missed webhook (deliver failure window) | The 6-hourly `ZidBillingReconcile` sweep heals the mirror — webhook-must-not-be-SPOF, closed by D-070's verify-first design |
| **H-10** | **Unrecognised `subscription_status`** | **NOTHING written, Sentry `unknown_status`. Explicitly NOT treated as inactive — see D-070: a status string we have not seen must never revoke a merchant Zid is billing** |
| **H-11** | **Response shape we cannot parse** (unexpected nesting, transport wrapper only, list where an object was expected) | **NOTHING written, Sentry `zid-billing-unreadable-response`. Explicitly NOT treated as "no subscription" — an unreadable 200 must never reach the pause branch. Only an explicit empty container (`{"data": null}`) is a positive "nobody is paying" and may pause** |

**Capture every `app.market.*` delivery** — the subscription-event envelopes are as
unconfirmed as everything else was. The parser reads them tolerantly (root / `data` /
`subscription` nestings, several field spellings) precisely because nothing is captured;
the first real delivery should be used to NARROW it, not merely to confirm it.

⚠️ **`plan_name` comes back in Arabic**, so the plan map keys on the Partner-Dashboard
plan **id** first (3740 «الأعمال» → `business`, 3741 «الاحترافي» → `pro`) and falls back
to the normalized Arabic name. Shopify's "lowercase display name == slug" shortcut does
not port. The free plan **3956 «اختبار» is deliberately unmapped** — an install on it
fails loud rather than activating a guess.

⛔ **It cannot be deleted, so that fail-loud path is PERMANENT, not a stopgap.** 3956 is a
Zid **system** plan: `DELETE /v1/market/delete/7367/plan` returns
`400 {"code":"cannot_delete_system_plan"}` (captured 2026-08-11, app 7367). The dashboard
shows a delete icon for it regardless — the UI and the API disagree. So H-5's unknown-plan
path is not a hypothetical: 3956 is a real, permanent, unmappable plan sitting in the same
list as the two we sell.

**Therefore capture this at step 5:** can a merchant actually END UP on 3956 — is it
offered at install, or auto-assigned before a paid plan is chosen? If it is reachable,
every such install books `unknown_plan` + Sentry and activates nobody, and we need a
ruling (map it to no entitlement deliberately, vs. keep failing loud). If it is not
reachable, the current behaviour is correct as-is and needs no change.

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

## L. Direct Merchant Access — Embedded Apps (the 2026-08-10 rejection)

> Zid's stated defect: *"Direct merchant access (no sign-in prompt)."* Before this,
> a platform-initiated install with no Jawab24 session created a pending install and
> redirected to `/login?zid_pending=true` — the reviewer met a login wall and could not
> complete a single scenario. Implemented per docs.zid.sa/embedded-apps.
>
> ⚠️ **Every case here must be run by someone who is NOT logged into Jawab24 in that
> browser profile.** A stray session silently routes you down the logged-in path and the
> whole section passes for the wrong reason. Use a fresh private window per case.

| ID | Test | Expected | Capture |
|----|------|----------|:--:|
| L-1 | Install app 7367 on the dev store from the Zid App Market, logged OUT of Jawab24 | **No login page at any point.** Account auto-created from the store profile; browser ends on `dashboard.zid.sa/…/apps/7367/embedded` | C12: the full redirect chain |
| L-2 | Inspect the new account | User row has the store's email, NO facebookId, NO phone; owns a workspace; has a subscription row | — |
| L-3 | Open the app from the Zid dashboard (Apps → Jawab24) | App renders INSIDE the dashboard iframe, already authenticated; no sign-in prompt | C13: the `?token=…&language=…` iframe URL |
| L-4 | Navigate inside the iframe (dashboard → business info → settings) | Every page renders framed; no blank frame, no XFO/CSP error in the console | Console log if it fails |
| L-5 | Let the access token expire (>15 min idle), then act | Session re-mints silently from the stored UUID; merchant is NOT bounced to `/login` | — |
| L-6 | Reinstall the app after an uninstall | A NEW UUID is registered; the store is reactivated for its ORIGINAL owner and workspace (never re-bound, never `already_connected`) | C14: the reinstall callback |
| L-7 | Uninstall, then replay the OLD iframe URL | `POST /zid/embedded/session` → 401; `embedded_token_hash` is NULL in the DB | C15: the uninstall delivery |
| L-8 | Disconnect from inside Jawab24 (Integrations → Disconnect), then replay the iframe URL | 401 — a merchant-side disconnect must close the dashboard entry too | — |
| L-9 | **Takeover guard:** set the dev store's email to an address that already has a Jawab24 account, then install logged-out | NO auto-login. Falls back to the claim-after-login flow; the existing account is untouched | — |
| L-10 | `curl -sI https://jawab24.com/zid/embedded` | No `X-Frame-Options` header; CSP `frame-ancestors` names dashboard.zid.sa + web.zid.sa, and does NOT contain `zid.dev` | — |
| L-11 | **Scope:** inside the frame, try to reach the admin console or switch to another of the owner's workspaces (set `X-Workspace-Id` to a different one) | 403 `WORKSPACE_SCOPE_DENIED` / `ADMIN_REQUIRED`. The embedded session sees ONLY the store's workspace; even an owner who is a Jawab24 admin gets no admin surface | DevTools network tab |
| L-12 | **Credential hygiene:** after the frame loads, inspect the address bar, `nginx` access log for `/zid/embedded`, and any Sentry event | No `?token=<uuid>` anywhere — stripped from the URL, path-only in the log, `REDACTED` in Sentry | — |
| L-13 | **Idle expiry:** leave a store's embedded entry unused for >30 days (or set `embedded_token_last_used_at` back in the DB), then open it | 401 — the merchant reopens/reinstalls to mint a fresh UUID | — |
| L-14 | **Workspace guarantee:** provision a merchant whose store email matches a *pending workspace invite*, then open the app | The merchant still owns a personal workspace (the invite does not suppress it); store reads do not 404 | — |
| L-15 | **No pages yet:** open the freshly-provisioned app in the frame; on the "connect a page" step | An actionable **"Connect a Facebook page"** button (not a dead sentence); it opens Jawab24 in a NEW top-level tab (facebook.com cannot be framed) **and that tab arrives SIGNED IN — never on `/login`**. Run it as a merchant with no password/Facebook/phone, which is every auto-provisioned merchant | C16: the new tab opening |
| L-16 | **Escalation:** from the frame, call `POST /auth/browser-handoff`, redeem the code at `/auth/browser-handoff/exchange`, and decode the returned token | Token is STILL `embeddedPlatform=zid` + pinned `workspaceId`, `isAdmin=false`, and **no refresh cookie** is set. Then confirm the admin console and a second workspace are still refused with that token | — |
| L-17 | **WhatsApp bridge:** redeem a frame-minted handoff code at `/whatsapp/app-start` | Redirect to `/login`; no session cookies, no refresh token, no WABA credential material | — |

**Shared-infrastructure re-check (§G-adjacent, MANDATORY).** Removing `X-Frame-Options`
domain-wide is a change every response carries. Before publish, confirm on PROD that
`frame-ancestors` is present and correct on a normal page (`/`, `/pricing`, `/dashboard`)
— a CSP typo silently drops the whole header, taking clickjacking protection with it.
`npm run check:nginx-routing` asserts both the routes and these headers.

> ✅ **Scoped break-out BUILT 2026-08-11 (D-067).** The tab still opens (facebook.com
> refuses framing and always will), but it now arrives **signed in**, carrying the
> embedded scope — previously it landed on `/login`, which an auto-provisioned merchant
> has no way to pass. The same change closed a privilege escalation: the handoff dropped
> the scope, so the frame could redeem a full, admin-capable session. See L-16/L-17.
>
> **Still required before resubmitting app 7367:** §A–§F live plus the §H billing
> scenario. Do not resubmit on the embedded flow alone.

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
§L direct-merchant-access + §H billing cases green.

**Resubmission gate (app 7367 → In Review), addressing the 08-10 rejection:**
§L green (bullet 1: "direct merchant access") + §H green (bullet 2's Subscription-App
scenario 2, "subscribe to a plan, confirm it syncs") + §A–§F green (scenario 3, "all
scenarios and features sync") + the listing gaps closed (5–12 min video, Arabic
screenshots, activation steps in the description, in-app support channel with a stated
response time, test-account credentials).

**Effort estimate:** 1–2 focused sessions for §A–§F (Salla's equivalent took one
evening); §L ~half a session; §I adds ~half a session.

---

## How to use this doc

Work top to bottom; §A–§F in order (each builds on the last), §G–§I after. Log
pass/fail inline (☐ → ✅/❌ + date), file bugs as you go, and keep
`zid_live_payloads.jsonl` growing. Re-run affected sections after every Zid-touching
code change before publish.

## Change log

- 2026-08-01: Created — absorbs the session capture plan (C1–C11, D-020 exit) and adds
  billing spec (§H), real-traffic soak/robustness (§I), and publish rehearsal (§J).
- 2026-08-11: **P-1 inverted** — the agreement is an exit, not an entry (Zid support
  08-08/09); the old header stalled this run-book for eight days. Records the 08-10
  rejection and its stated reasons, adds **§L** (direct merchant access / Embedded Apps,
  C12–C15) and a resubmission gate, and closes the scope-strings open question.
