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
> (`ZID_CLIENT_ID`=7192 verified live); **`ZID_CLIENT_SECRET` is proven** — the 2026-08-22
> install completed a token exchange and an authenticated profile call with it, so §A-1 has
> nothing left to prove on that point.
>
> 🔴 **Current status: app 7367 is `Draft`** — withdrawn deliberately on 2026-08-22
> (rollback icon on the app row; one click, no confirmation). Earlier the same day it was
> `In review`, flipped there on 08-09; Zid's reviewer install on 08-11 hit an error on our
> side, fixed and deployed the same day. Because it is Draft, **nobody is reviewing it and
> the next move is entirely ours** — the wizard is editable, so listing fixes can land
> before resubmitting. Resubmit via the wizard's **Request to Publish** → "Send for review".
>
> ✅ **`EC3` is SOLVED and the dev store is installed** (2026-08-22). The cause was never
> the review state: `oauth/authorize` returns `EC3` until the store has **subscribed** to
> the app in the App Market. Subscribe first (free «اختبار» plan → «تفعيل التطبيق»), and a
> `Draft` app installs fine — 7367 did, creating store `e3deb6f2-…`. **This run-book is
> therefore unblocked end to end**; §A–§F run against prod today. Full capture in
> `docs/integrations/zid.md` → "EC3 — ACTUALLY SOLVED".
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
  response to **`docs/testing/zid_live_payloads.jsonl`** (created 2026-08-22; same
  convention as `memory/salla_phase42_real_payloads.jsonl`). The ngrok inspector
  (`http://127.0.0.1:4040`) records deliveries with headers — copy verbatim.
  ⚠️ **What is in that file today is mostly DERIVED state** (resulting DB rows, job
  results, counters), not raw envelopes — each line says so in `evidence_kind`. Derived
  state proves the outcome; it does not pin the shape, which is what the `[provisional]`
  parsers need. **The §E order captures must be saved verbatim**, headers and body.
- Every capture ID below (**C1–C11**) must end up in that file. The fixture-finalization
  step (§K) consumes them one-to-one.
- A test that "passes" without its capture saved is NOT passed.

---

## Pre-flight: environment

| # | Item | How to verify | Status |
|---|------|---------------|:--:|
| P-1 | ⛔ **INVERTED 2026-08-11 — the agreement is NOT a precondition.** It is countersigned only AFTER Zid's technical review passes (Zid support, 08-08/09), so this run-book runs FIRST. Nothing here waits on partner.zid.sa. | Agreement state is an EXIT check in §K, not an entry one | n/a |
| P-1b | App **7367 is `Draft`** (withdrawn 2026-08-22). ⚠️ **A Draft app is not queued and nobody is reviewing it**, and nothing notifies you — it can look like "waiting on Zid" for days. ⛔ But do NOT treat `Draft` as a blocker for dev-store installs either: a subscribed store installs a Draft app fine (EC3 is about subscription state, not review state). Re-read the status in the portal whenever the wait feels long. | partner.zid.sa → My Apps → row 7367 | ☑ verified 2026-08-22 |
| P-2 | Dev store **3195980 "Jawab24 Dev"** accessible and **OUT of maintenance mode** (maintenance blocked Salla's cart captures). ⛔ **Store email `qwhfqfihvm@zam-partner.email` NOW HOLDS a Jawab24 account** — the 2026-08-22 install auto-provisioned it (user + workspace `5b1c323e-…`). The "no existing account" precondition this row used to assert is **spent**, and the consequence is precise: a *repeat* install of THIS store never reaches the provisioning path at all — `getStoreByDomain` (`ecommerce.ts:323`, no `is_active` filter) finds the existing row, and `reinstallPolicy:'reactivate-for-owner'` (`ecommerceControllers.ts:239`) reactivates it for its owner before `provisionMerchant` is ever consulted. So a re-run here exercises **L-6** (reinstall), not L-1. A fresh L-1 needs a **second dev store** whose email has no account. The guard itself (L-9) needs a second store whose email *does* have one — this email now serves as that. | `https://h47p59.zid.store/` renders the storefront publicly | ☑ 200, verified 2026-08-22 · ⚠️ email now claimed |
| P-3 | ✅ **UNBLOCKED 2026-08-22 — the production route works.** App 7367 → `https://jawab24.com/zid/auth/callback` is the route a reviewer walks and the route we now use. `EC3` was never about the app's review state: `oauth/authorize` rejects a store that has not **subscribed** to the app. Enter from the App Market (old dashboard → app page → الأسعار والخطط → free «اختبار» plan → «تفعيل التطبيق»), and the consent screen renders normally. ⚠️ Consequence for our own entry point: `/zid/auth` is only valid as a **re-entry** for an already-subscribed store — never as a first install. The dedicated-DEV-app + ngrok route (P-4/P-5/P-6/P-10) is now only needed for cases that require intercepting deliveries locally (F-1, and any capture the prod path cannot show). | App-Market install completed; store `e3deb6f2-…` created | ✅ |
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
> ⚠️ **Whenever 7367 is back `In review`, prefer the production route and change NOTHING
> in the portal.** Editing the app to point at a tunnel risks two things at once: it drops
> 7367 back to `Draft` (leaving the review queue silently — see P-1b), and if Zid's
> reviewer installs during your tunnel window they reach your laptop or a dead URL, costing
> a second review round. The ngrok route (P-3/P-6/P-10) is for when the app is NOT under
> review. ⛔ **This is not a reason to withdraw the app in order to test** — that was tried
> on 2026-08-22 and `EC3` was unaffected. What *did* unblock it was subscribing the store to
> the app first; the withdrawal bought nothing and cost the queue position.
>
> ⚠️ **If a production-route install fails halfway, it leaves an orphan account that will
> block the reviewer's install** (same failure mode as 08-11 — see R-4 in
> `docs/integrations/zid.md`). Re-check R-4 immediately after any failed attempt and clean
> up before walking away. Note the two 2026-08-22 EC3 bounces left **nothing** — Zid
> rejects before reaching our code, so R-4 came back clean both times.
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
`docs/integrations/zid.md`):

- ✅ **RESOLVED 2026-08-22 — `ZID_APP_ID` is the app id `7367`, not the Client ID `7192`.**
  Prod runs `ZID_APP_ID=7367` (`ZID_CLIENT_ID=7192`), `registerWebhooks` sends it as
  `original_id` (`zid.ts:227`), and the live store's `platform_data->>'webhookStatus'` reads
  **6 registered / 0 failed** (`lastAttempt` 2026-08-22T09:23:52Z). Zid accepted 7367.
  ⚠️ Scope of the proof: this settles the **webhook** half only. The same value is also read
  as `app_id` on the billing subscription (§H) — unproven until a subscription envelope lands.
- ✅ **2026-08-30 — NONE.** `app.market.*` lifecycle deliveries carry **no `Authorization`
  header** (F-2 / C11, captured live on the dev-store Deactivate: UA `GuzzleHttp/7`, 497-byte
  JSON body, headers host/x-request-id/traceparent only). The handler had been answering 401.
  Resolved by D-114 (verify via Zid's API, `services/zidLifecycle.ts`); the body SHAPE is still
  uncaptured — the handler now logs it.

---

## A. OAuth Connect Loop (captures C1–C3)

### A-1. Logged-in connect (integrations page) — 🟡 the App-Market equivalent is PROVEN LIVE
> ✅ **Proven 2026-08-22 via the App-Market install** (the route a real merchant and a
> reviewer take), not via the logged-in integrations card: store `e3deb6f2-…` was created
> with both credentials encrypted, `platform_data->>'merchantId' = 3195980`,
> `store_domain = h47p59.zid.store`, **webhookStatus 6 registered / 0 failed**, and the
> product sync ran (`product_count = 4`). `ZID_CLIENT_SECRET` is proven by the same run.
> ☐ **Still owed:** the raw C1/C2/C3 bodies (this row's evidence is the resulting DB state,
> not the envelopes), and the logged-in-from-our-side variant, which is a different entry
> point (`POST /zid/store/connect`) and is what a *merchant already using Jawab24* walks.

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

### B-1. Full sync — ✅ PROVEN LIVE 2026-08-22
> ✅ A full sync of dev store 3195980 returned `{"synced":4,"capped":false}` and all four
> published products landed in `ecommerce_products` — **Zid product sync had never once
> worked, for any store, before this** (the cause was a missing `Store-Id` header, #865).
> The hidden fifth product was correctly absent (F2) and «نظارة شمسية» landed at its
> `250 SAR` sale price, not the 400 SAR list price (F4). The same sync reproduced **F1**
> (`Sony A7S III → total_inventory 0` for an unlimited item), fixed and re-proven the same
> day. Re-confirmed 2026-08-22 19:25 UTC by a fresh `full_sync` (4 products, 4 chunks).
> ☐ **Still owed:** the >100-product pagination case from B-0, and the raw C4 envelope.

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

### B-3. Incremental webhook (`product.update`) — ✅ PROVEN LIVE 2026-08-22 (×3)
**Steps:** Edit a product's price in the Zid admin.

**Expected:** Delivery hits `/zid/webhooks` (Basic-auth verified) → product sync
enqueued → row reflects the change. Save the delivery (headers + body) — it doubles as
the product-event envelope capture.

> ✅ Proven by the F7 image uploads instead of a price edit: each dashboard image upload
> saves instantly and fires `product.update`; three separate deliveries were consumed
> end-to-end (Basic-auth verified → sync → all four `ecommerce_products` rows carried
> `media.zid.store` image URLs, progressive `updated_at` 12:40:13 → 12:42:39 UTC).
> The auth negatives ran the same day: wrong Basic → 401, no auth → 401, no writes.

---

## C. Page Linking + Live DM (shared infrastructure)

Mirrors `SHOPIFY_TEST_PLAN.md` §C (link/unlink/multi-page/cross-workspace-rejection) —
same shared routes, so run the happy path plus the security case:

- **C-1.** ✅ **PROVEN LIVE 2026-08-22.** FB page "Jawab24 Test" (`d88d7c02-…`) carries
  `ecommerce_store_id = e3deb6f2-…`; its RAG index holds the store's product chunks.
- **C-2.** ☐ Cross-workspace link attempt via forged workspace header → 403/404.
- **C-3.** ✅ **PROVEN LIVE 2026-08-22** — real Messenger DMs to the linked page:
  Sony AR+EN → «متوفرة» (F1 answered correctly in a real DM) · «اديش سعرها» → 10000
  (dialect + context carried) · نظارة → 250 + «نفدت» · a hidden product → «ما عندي معلومة»
  (no fabrication) · purchase turn → correct product link + lead ask.
  ⚠️ The first DM got **no reply**: the auto-provisioned workspace is seeded
  `messagesAutoReply:false` on purpose (**D-025**), which every Zid/Salla/Shopify
  auto-provisioned account inherits. Check that first when a new store's page is silent —
  it is not a bug. Enabling it from inside the Zid iframe also exercised §L-3/§L-4.

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

### E-1. `order.create` → order_confirmed SMS — ✅ **PASSED 2026-08-23** (webhook half)

⭐⭐ **You do NOT need the storefront checkout — or a phone — to fire `order.create`.**
The Zid admin's **manual-order wizard** creates a genuine order that fires the event:
الطلبات → «إنشاء» (this drops a draft into الطلبات اليدوية) → open the draft → 4 steps:
products → customer (pick `Zid Customer`; it needs a delivery **address**, add one) →
shipping «التوصيل إلى عنوان العميل» + a payment method → «تأكيد». The summary step
states it outright: «سيتم حفظ كطلب جديد، وسيتم إشعار العميل عبر رسالة نصية (SMS)».
This retires the eight-day block on §E: the storefront checkout is Cloudflare-challenged
for a debugger-attached browser, and the owner's phone was believed to be the only route.
⚠️ The store's 5 seeded orders all pre-date the webhook subscription (created 2026-08-01),
so flipping THEIR status can never produce `order_confirmed` — only a new order can.

**Result:** Order **73285179** created 14:28:20Z (Sony A7, 10,015 SAR, Riyadh address,
bank transfer, status «جديد», source «لوحة التحكم»). `order.create` reached prod
~97s later and wrote `customer_notifications_log` row `zid:order_confirmed:73285179`
at 14:29:57Z — **the first `order.create` ever to fire in this integration**. Basic-auth
verified, envelope parsed, phone normalized to `+966500000009`, message
«Zid Customer، تم تأكيد طلبك #73285179 بنجاح ✅ شكراً لتسوقك». `order_number` is the
**invoice number**, not the slug — #911 confirmed live at the read path (the 09:50Z row
still reads `mdXMlMYYBt`; every row after it reads the real number).

E-2 and E-3 were then re-run on this same order, giving the **complete lifecycle on one
order for the first time**: confirmed 14:29:57Z → shipped 14:32:55Z (~48s) → delivered
14:34:24Z (~42s), all three quoting 73285179.

**Capture — C5 — PARTIALLY RESOLVED (from the effect, not the envelope).** The controller
does not log raw bodies, so header casing and the `data`/`order`/root envelope shape are
still unobserved. What the written row proves: Basic-auth verification passed, the phone
parsed from `customer.mobile` full-intl-without-`+` → `+966500000009` as designed, and
`invoice_number` resolved. **Still open on E-1:** SMS *arrival* (blocked on Vonage
ticket #3002710, not on Zid — all 6 rows read `Vonage delivery error: Quota Exceeded`).

### E-2. Status → in-delivery → order_shipped SMS — ✅ **PASSED 2026-08-23** (webhook half)
**Steps:** Flip the order to in-delivery in the Zid admin. No carrier config needed —
the dev store's «مندوب المتجر» (`method.code` `custom`) self-delivery option is enough
to move the status, it just carries no tracking data.

**Result:** Order 72524870 flipped new → «جاري التوصيل» at 09:25:33Z. Zid delivered
`order.status.update` to prod within ~90s; Basic-auth verified, envelope parsed, phone
normalized, and `customer_notifications_log` row `9a0dec7c…` written
(`order_shipped`, `zid:order_shipped:72524870`). **This is the first Zid order webhook
ever to round-trip**, and it closes the ingestion half of Zid rejection bullet 2 for
order events. SMS delivery itself failed — `Vonage delivery error: Quota Exceeded -
rejected`, the unverified-account spending limit of Vonage ticket #3002710, unrelated
to Zid.

**Capture — C6 — RESOLVED** (`zid_live_payloads.jsonl`):
- **Status spelling is `indelivery`** — lowercase, one word. Zid's admin select offers
  exactly `new` / `preparing` / `ready` / `indelivery` / `delivered` / `cancelled`. The
  `inDelivery` camelCase in the webhook-conditions doc did not appear; the mapper's
  lowercased compare covers both.
- **Tracking lives at `shipping.method.tracking.{number,status,url}`**, with
  `shipping.method.waybill_tracking_id` and `shipping.method.courier` alongside. The
  previously-assumed `tracking_number` and `shipping.tracking_number` **do not exist**
  — the mapper read neither real field and was fixed on
  `fix/zid-order-number-from-id`. All are `null` for `custom` (self-delivery) shipping.
- ⚠️ Zid exposes a customer-facing **tracking URL** (`shipping.method.tracking.url`)
  that we do not use. Putting it in an SMS is an owner decision: KSA requires every URL
  in an SMS body to be pre-registered with the sender ID, and a carrier tracking domain
  is a third party's.

**Two defects found by this one test** (both fixed on `fix/zid-order-number-from-id`):
1. The SMS quoted `code` — «طلبك #mdXMlMYYBt» — which is the invoice **URL slug**
   (`order_url` `https://<store>.zid.store/o/<code>/inv`), not an order number. The
   number the merchant and the customer both see is `id` = `invoice_number` = 72524870.
2. The tracking field paths above were invented and never matched Zid.

**Still open on E-2:** an end-to-end SMS *arrival* (blocked on Vonage, not on Zid), and
a carrier-backed order that actually carries a tracking number.

### E-3. Status → delivered → order_delivered SMS — ✅ **PASSED 2026-08-23** (webhook half)
**Result:** Order 72524870 flipped `indelivery` → «مُكتمل» (`delivered`) straight after
E-2. A second `order.status.update` arrived and wrote a second
`customer_notifications_log` row (`order_delivered`, `zid:order_delivered:72524870`).
SMS again blocked by the same Vonage quota rejection.

**Capture — C7 — RESOLVED**: `delivered` is the status code (admin label «مُكتمل», which
does NOT mean the code is `completed`). ✅ The `review_request` companion correctly did
**not** fire — it is disabled on this store, so `also` was skipped rather than scheduled.
Two rows, two distinct dedupe keys, no cross-talk between the shipped and delivered paths.

**Still open on E-3:** SMS arrival (Vonage), and a `review_request` run with the template
enabled.

### E-4. Payment field — ✅ **RESOLVED 2026-08-23**
**Capture — C8**: `payment_status` **does exist** on Zid orders — value `pending` on
order 72524870 (unpaid bank transfer). The `'unknown'` mapping can be narrowed to
Zid's real vocabulary.

### E-5. Dedupe on redelivery
**Steps:** Redeliver the same `order.create` (Zid dashboard redelivery if available;
otherwise replay the captured delivery verbatim with curl).

**Expected:** No duplicate `customer_notifications_log` row (deduped by
`(store, type, platform_event_id)`); no second SMS.

### E-6. Auth negatives
- Delivery with wrong Basic password → **401** AND the scheme-only `warn` log fires
  (never log the password).
- Delivery with no auth header at all → 401.

### E-7. `abandoned_cart.created` → recovery-nudge log row (added 2026-08-25, code shipped, NOT live-run)
**Precondition:** webhooks re-registered on the dev store AFTER the 2026-08-25 deploy
(the pre-existing subscription carries only the 6 old events), and the `abandoned_cart`
template enabled on store `e3deb6f2-…`.

**Steps:** In a REAL browser (chrome-real; the human taps any Cloudflare challenge):
storefront `h47p59.zid.store` → sign in as a customer with a phone → add «سونى A7» to
the cart → abandon. Zid marks the cart abandoned after ~10 min of inactivity.

**Expected:** `abandoned_cart.created` delivery (Basic-auth) → `abandoned_cart` log row
`pending` with `platform_event_id = zid:abandoned_cart:<cart id>` and a `cart_total`;
after the 60-min template delay the send fires (lands `failed` on Vonage today — the row
is the proof). Verify at `GET /api/notification-log/<storeId>`.

**Capture — C12**: the raw payload → `zid_live_payloads.jsonl`. The parser is
[provisional] (docs promise id/customer/totals/continue-checkout URL) — if the live
shape differs, fix `ZidAbandonedCartPayload` in `controllers/zid.ts` and pin the real
payload in `test/controllers/zid.test.ts`. Also record whether the continue-checkout
URL field exists (gates the follow-up `{cart_url}` template variable).

### E-8. `abandoned_cart.completed` → pending nudge cancelled (added 2026-08-25, code shipped, NOT live-run)
**Steps:** Complete the same cart's checkout within the 60-min delay window.

**Expected:** `abandoned_cart.completed` delivery → the pending `abandoned_cart` row
flips to `cancelled` BEFORE the send; the customer gets the `order_confirmed` SMS only.
Analytics: the cancelled row is excluded from "revenue recovered" (pinned by
`test/integration/abandonedCartRecovery.test.ts`).

**Capture — C13**: the raw `.completed` payload → `zid_live_payloads.jsonl`.

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

✅ **DECIDED 2026-08-30 from the capture (D-114): NO Basic auth.** Neither pre-built option
was taken: same route, same store resolution, but the uninstall is **verified against Zid**
(`probeZidToken` on `/v1/managers/account/profile` — 401 ⇒ token dead ⇒ uninstall real)
before any write, and an unconfirmed delivery leaves an `uninstallSignalAt` marker for the
15-min `ZidUninstallSweep`. Re-run of F-2 owed after deploy: expect the log line `Zid
lifecycle webhook received` followed by `finalizeZidUninstall` effects (store inactive, hash
NULL, mirror cancelled) — and record the body keys the handler now logs.

### F-3. Reinstall
**Steps:** Reinstall + reconnect.

**Expected:** Same store row reactivates with a FRESH credential pair; no duplicates;
webhooks re-registered 6/6.

---

## G. Multi-Tenant Security

- **G-1.** Cross-workspace store access: workspace B hits `GET /zid/store/products`
  scoped to workspace A's store → 403 or correctly-scoped empty result.
- **G-2.** Webhook spoofing: valid-shaped body, wrong Basic credentials → 401, no writes.
- **G-2b.** (D-114) Lifecycle spoofing: `POST /zid/webhooks?e=app.market.application.uninstall`
  with a real store id and NO auth, while the store's token is live → **200, store stays
  active**, `platformData.uninstallSignalAt` written, nothing else changes; a second POST
  within 60 s is throttled (no probe). `?e=app.market.subscription.active` with a fake
  `plan_name` → one `syncZidBilling` (reads Zid, ignores the body), no plan change.
- **G-3.** Workspace B's AI replies never surface workspace A's Zid catalog (DM test).
- **G-4.** ✅ **pinned 2026-08-23** — Cross-workspace `:storeId` routes: workspace B hits
  `/notification-templates/<A's store>` (GET/PUT/reset), `/notification-log/<A's store>`
  (+`/stats`) and `/ecommerce-analytics/<A's store>` → **403**, rows untouched. Found live on
  THIS dev store (`e3deb6f2…`) from the owner's account: the five notification routes trusted
  the URL's `storeId` and returned full template bodies. Closed by the shared
  `requireOwnedStore` preHandler (`backend/src/middleware/storeOwnership.ts`); HTTP regression
  in `backend/test/integration/storeOwnershipRoutes.test.ts`. Any new `:storeId` route must
  mount that guard — see SHOPIFY_TEST_PLAN L-4 for the full row.

---

## H. Billing — Zid App Market subscriptions (rail SHIPPED; live validation blocked on PAID CHECKOUT)

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
> ⛔ **Still not captured against a live store — but NOT because of `EC3`, which is solved
> (see the header).** The install works and the store is subscribed to the FREE «اختبار»
> plan. What refuses is **paid checkout while the app is `Draft`**: Zid answers
> «تعذر بدء عملية الشراء — هذا التطبيق غير متاح للشراء حاليًا». So the blocker is narrow and
> named: *a Draft app cannot sell a paid plan*. Consequences to plan around:
> - The **first live paid-subscription envelope will most likely be produced by Zid's own
>   reviewer**, i.e. after resubmission — precisely when a parse failure is most expensive.
>   D-070 is what makes that survivable: nothing is read out of the envelope, the API is the
>   authority, so an unrecognised delivery costs at most a six-hour reconcile delay.
> - Watch Sentry `zid-billing-unreadable-response` and `unknown_status` the day after any
>   resubmission — that is the window in which this section finally gets its capture.
> - The free-plan subscribe DID work, so the install/subscribe half of H-1 is exercised;
>   only the paid half is blocked.
>
> H-1…H-9 below are covered at the UNIT level by
> `backend/test/services/zidBilling.test.ts` (40 cases) and
> `backend/test/controllers/zid.test.ts` (webhook wiring) against an envelope inferred
> from Zid's docs. **Unit-green is NOT the live validation this section asks for** — the
> rows below stay open until they are run against a real dev store.

Plans as configured (D-095, website parity, set 2026-08-23):
Business/الأعمال id 3740 = 146 SAR · Pro/الاحترافي id 3741 = 296 SAR (ex-VAT) · Recurring,
1 month, 14-day trial. Editable until publish.

| ID | Test | Expected |
|----|------|----------|
| H-1 | Subscribe on the dev store (trial) — ⛔ **BLOCKED while the app is in `Draft`** (captured 2026-08-22: «ترقية الخطة» → consent → checkout answers «تعذر بدء عملية الشراء … غير متاح للشراء حاليًا»; the free «اختبار» subscribe worked the same morning, so the gate is on PAID checkout specifically). First live capture will likely come from Zid's reviewer. | `app.market.subscription.active` (or install-time equivalent — CAPTURE the real first event) → local mirror row `payment_method='zid'`, status `trialing`, subject = workspace OWNER |
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
3. Pricing is settled (D-095: 146/296 SAR ex-VAT, website parity). Re-read the two plan
   rows in the Partner Dashboard right before publish — editable until then, NOT after.
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

### Status — 13 of 17 covered (6 live, 7 pinned) · 2026-08-22

Bullet 1 of the rejection is the one §L answers, so it is worth being precise about what
"done" means per case. Three states, and they are **not** interchangeable:

| State | Meaning |
|---|---|
| ✅ **live** | executed against the real dev store / prod surface, with the capture saved |
| 🧪 **pinned** | the logic is exercised deterministically by a test, so a refactor cannot silently remove it — but the live capture is still owed |
| ☐ **owed** | neither; needs the live app |

| Case | State | Evidence |
|---|---|---|
| L-1 | ✅ live | The 2026-08-22 App-Market install auto-provisioned user `4cfe23d4-…` from the store profile and landed on `dashboard.zid.sa/…/apps/7367/embedded` with **no login page**. ⭐ The logged-out precondition is proven by the code, not by memory: `provisionMerchant` is reachable **only** from the `else` branch of `if (userId)` (`ecommerceControllers.ts:219`, `:263`), so an auto-provisioned user could not exist had a session been present. ☐ C12 (the raw redirect chain) still owed |
| L-2 | ✅ live | Prod rows, read 2026-08-22: user `4cfe23d4-…` email = the store email, `facebook_id` NULL, `phone` NULL, created 09:23:52.217; owns workspace `5b1c323e-…` "Jawab24 Dev"; subscription row created 09:23:52.230 — 13 ms later, same provisioning path. (It now reads `manual`/`active` to 2026-09-22 because the owner set it so afterwards; `zid_store_id` is empty, consistent with §H never having run) |
| L-3, L-4 | ✅ live | Rendered + navigated inside the Zid dashboard iframe, authenticated, no sign-in prompt (2026-08-22) |
| L-5 | ✅ live | `POST /api/zid/embedded/session` → **200** five times at ~15-min idle in the nginx log; never a `/login` redirect |
| L-10 | ✅ live | `curl -sI`: no `X-Frame-Options`; `frame-ancestors 'self' https://dashboard.zid.sa https://web.zid.sa`; no `zid.dev`. Re-checked on `/`, `/pricing`, `/dashboard` (the header is global — a CSP typo would drop clickjacking protection fleet-wide) |
| L-12 | ✅ live | 96h of nginx logs: `/zid/embedded` appears **path-only**, never with `?token=`. The 33 `token=` hits in that window are all Meta's `hub.verify_token` on `/webhook`, not ours |
| L-7, L-8, L-13 | 🧪 pinned | `backend/test/integration/embeddedTokenLookup.test.ts` — all three are one predicate each in `getStoreByEmbeddedTokenHash`; every other test **mocks** that function, so until #883 none had ever executed. Real Postgres; mutation-checked (drop `is_active` → only L-8 fails; drop the idle window → only L-13 fails) |
| L-11 | 🧪 pinned | `test/middleware/workspace.test.ts` (pins to the token workspace, rejects a different `X-Workspace-Id`, refuses rather than fall back when membership is lost) + `test/middleware/authRequireAdmin.test.ts` — *"rejects an embedded session outright, before the isAdmin check"*, so admin denial does not depend on `isAdmin` being right |
| L-16 | 🧪 pinned | `test/controllers/auth.browser-handoff.test.ts` — the code carries the caller scope, the exchanged token is *still* scoped, **no refresh cookie is issued**, and a pre-existing one is **cleared** (not issuing is not enough) |
| L-17 | 🧪 pinned | `test/controllers/whatsapp-redirect.test.ts` — *"REFUSES a code minted by a restricted embedded session — no full session, no WhatsApp credentials"* |
| L-18 | 🧪 pinned | `frontend/src/__tests__/pages/pages.test.tsx` «Facebook connect inside a platform frame» — 5 cases, mutation-checked ×3. Found live 2026-08-30 on the dev store: «ربط قناة» / «إعادة الاتصال» on `/pages` navigated the *iframe* to facebook.com → «www.facebook.com refused to connect». ✅ **live 2026-08-30 04:18** on build `e2fe307` (C17): dialog carries the new-tab hint → new top-level tab → `/auth/browser-handoff` → `/auth/browser-handoff/exchange` → `/auth/me` → `/workspaces` → facebook.com consent («Continue as …») → `/auth/callback`. ⛔ The FINAL `POST /auth/facebook/link` then failed **both** times (owner 04:16, replay 04:18) with `duplicate key value violates unique constraint "users_facebook_id_key"` → 500 «Facebook link failed» → the tab lands on `/dashboard` with **no error shown**, page stays `token_revoked`. Cause: the founder's Facebook account is already linked to `aliahdab@gmail.com`'s user; the auto-provisioned merchant user cannot take it. Test-data collision, but the silent 500 is a defect → follow-up: 409 + merchant-facing message. ⚠️ Finish the Facebook step within **15 min** — the scoped session's cookie expires then (pre-existing seam, see `docs/integrations/zid.md`) |
| L-6, L-9, L-14, L-15 | ☐ owed | L-6 needs an uninstall→reinstall (F-2/F-3 produces it). L-9 (takeover guard) needs a **second** store whose email already has an account — `qwhfqfihvm@zam-partner.email` now is such an email, but it cannot be tested on *this* store: a repeat install of a known domain reactivates it for its owner (`reinstallPolicy`) and never reaches the guard. L-14 (pending-invite) and L-15 (no-pages break-out) need a freshly provisioned merchant |

⚠️ **A pinned case is not a passed case for submission purposes.** The tests prove the logic
cannot regress; they do not prove Zid's reviewer walks the flow successfully.

**§L is now green for the rejection bullet it answers**: L-1 and L-2 — the exact scenario Zid
rejected us on — ran live on 2026-08-22, alongside L-3/L-4/L-5/L-10/L-12. The four owed cases
are hardening (reinstall, takeover, invite, no-pages), not the rejection itself. ⚠️ What §L
being green does NOT do is make the app resubmittable: §F is still at zero and the listing
assets are still Salla's. Do not read this heading as "ready".

| ID | Test | Expected | Capture |
|----|------|----------|:--:|
| L-1 | Install app 7367 on the dev store from the Zid App Market, logged OUT of Jawab24 | **No login page at any point.** Account auto-created from the store profile; browser ends on `dashboard.zid.sa/…/apps/7367/embedded` | C12: the full redirect chain |
| L-2 | Inspect the new account | User row has the store's email, NO facebookId, NO phone; owns a workspace; has a subscription row | — |
| L-3 | Open the app from the Zid dashboard (Apps → Jawab24) | App renders INSIDE the dashboard iframe, already authenticated; no sign-in prompt | C13: the `?token=…&language=…` iframe URL |
| L-4 | Navigate inside the iframe (dashboard → business info → settings) | Every page renders framed; no blank frame, no XFO/CSP error in the console | Console log if it fails |
| L-5 | Let the access token expire (>15 min idle), then act | Session re-mints silently from the stored UUID; merchant is NOT bounced to `/login` | — |
| L-6 | Reinstall the app after an uninstall | A NEW UUID is registered; the store is reactivated for its ORIGINAL owner and workspace (never re-bound, never `already_connected`) | C14: the reinstall callback |
| L-7 | Uninstall, then replay the OLD iframe URL | `POST /zid/embedded/session` → 401; `embedded_token_hash` is NULL in the DB. ⚠️ 2026-08-30: the delivery ARRIVED (C15 headers captured) but was **401'd by our Basic gate** — the hash survived until the account was deleted by hand. Fixed by D-114; re-run after deploy | C15: headers ✅ 2026-08-30 (no auth, UA GuzzleHttp/7); body shape still owed |
| L-8 | Disconnect from inside Jawab24 (Integrations → Disconnect), then replay the iframe URL | 401 — a merchant-side disconnect must close the dashboard entry too | — |
| L-9 | **Takeover guard:** set the dev store's email to an address that already has a Jawab24 account, then install logged-out | NO auto-login. Falls back to the claim-after-login flow; the existing account is untouched | — |
| L-10 | `curl -sI https://jawab24.com/zid/embedded` | No `X-Frame-Options` header; CSP `frame-ancestors` names dashboard.zid.sa + web.zid.sa, and does NOT contain `zid.dev` | — |
| L-11 | **Scope:** inside the frame, try to reach the admin console or switch to another of the owner's workspaces (set `X-Workspace-Id` to a different one) | 403 `WORKSPACE_SCOPE_DENIED` / `ADMIN_REQUIRED`. The embedded session sees ONLY the store's workspace; even an owner who is a Jawab24 admin gets no admin surface | DevTools network tab |
| L-12 | **Credential hygiene:** after the frame loads, inspect the address bar, `nginx` access log for `/zid/embedded`, and any Sentry event | No `?token=<uuid>` anywhere — stripped from the URL, path-only in the log, `REDACTED` in Sentry | — |
| L-19 | **(D-A) Logout inside the frame:** open the app from the Zid dashboard, look for Logout in the sidebar and the mobile «More» sheet | **No Logout control** in either. Let the session expire (or clear the credential): the frame lands on `/zid/embedded?expired=1` («تعذّر فتح التطبيق» + reopen from Zid) — never `/login`. 2026-08-30 baseline: the login page rendered inside the dashboard | screenshot of the frame |
| L-20 | **Pricing inside the frame:** open «باقات الاشتراك» from the frame on the dev store | Only الأعمال + الاحترافي cards; no monthly/yearly toggle; the banner carries **«إدارة الباقة في زد»**; clicking it navigates the TOP window (not a new tab) to `dashboard.zid.sa/ar-sa/stores/3195980/apps/7367/plans`. 2026-08-30 baseline: four USD plans, no link | the plans page URL |
| L-21 | **Wizard after the break-out:** from step 2 press «اربط صفحة فيسبوك», connect in the tab, return to the frame | The new tab opened on `/ar/...` and went straight to the Facebook dialog (no second "Facebook page" choice); back in the frame the page is listed WITHOUT pressing رجوع; reload the frame mid-wizard → it resumes at the derived step | — |
| L-22 | **Truthful auto-reply row:** finish the wizard with a page whose channel trial is spent (the dev store's page), press «تفعيل الآن» | The row says the page is still off and links to Channels; it never says «مفعّلة» while `pages.auto_reply_enabled=false` | DB read of the page flags |
| L-23 | **Adopt at install (Z-16):** reinstall on a store whose Zid subscription is a real plan | Within seconds of the callback the local subscription mirrors Zid's plan and its trial end (`payment_method='zid'`); the frame's usage strip shows Zid's plan, not «المبتدئ · 14 يوم». On the dev store (system «اختبار» plan) nothing changes — expected | `subscriptions` row |
| L-24 | **(D-117) WhatsApp switched off for Zid:** open the app from the Zid dashboard on the dev store (which has an active Zid store), and walk Channels / dashboard / the channel picker / the notifications card / pricing | **No WhatsApp anywhere** it can be connected: no WhatsApp connect button or row on Channels, no dashboard launch nudge, the «ربط قناة» picker collapses to the Facebook dialog (no WhatsApp option), the order-notifications card shows no WhatsApp channel and no "connect WhatsApp" nudge, the pricing cards read «فيسبوك وإنستغرام» (no WhatsApp). **Server proof:** `curl -X POST …/pages/connect-whatsapp` with the embedded Bearer → 403 `WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE`; `/pages?connectWhatsApp=true` opens nothing. Already-connected numbers (none on the dev store) would still render. Flip check: with `WHATSAPP_ZID_BLOCK=false` the surfaces return (do NOT ship that flip while the category is closed) | the 403 body; screenshots of Channels + pricing |
| L-13 | **Idle expiry:** leave a store's embedded entry unused for >30 days (or set `embedded_token_last_used_at` back in the DB), then open it | 401 — the merchant reopens/reinstalls to mint a fresh UUID | — |
| L-14 | **Workspace guarantee:** provision a merchant whose store email matches a *pending workspace invite*, then open the app | The merchant still owns a personal workspace (the invite does not suppress it); store reads do not 404 | — |
| L-15 | **No pages yet:** open the freshly-provisioned app in the frame; on the "connect a page" step | An actionable **"Connect a Facebook page"** button (not a dead sentence); it opens Jawab24 in a NEW top-level tab (facebook.com cannot be framed) **and that tab arrives SIGNED IN — never on `/login`**. Run it as a merchant with no password/Facebook/phone, which is every auto-provisioned merchant | C16: the new tab opening |
| L-16 | **Escalation:** from the frame, call `POST /auth/browser-handoff`, redeem the code at `/auth/browser-handoff/exchange`, and decode the returned token | Token is STILL `embeddedPlatform=zid` + pinned `workspaceId`, `isAdmin=false`, and **no refresh cookie** is set. Then confirm the admin console and a second workspace are still refused with that token | — |
| L-17 | **WhatsApp bridge:** redeem a frame-minted handoff code at `/whatsapp/app-start` | Redirect to `/login`; no session cookies, no refresh token, no WABA credential material | — |
| L-18 | **Connect / reconnect Facebook from `/pages` INSIDE the frame** (Apps → Jawab24 → قنوات التواصل → «ربط قناة» or the «إعادة الاتصال» banner → «المتابعة إلى فيسبوك») | The dialog says a new tab opens; confirming opens a NEW top-level tab that arrives SIGNED IN on `/pages` and continues straight to Facebook's OAuth dialog — the frame itself never shows «refused to connect». After granting, the page syncs into the store's workspace and the frame shows it connected on reload. ⚠️ WhatsApp Embedded Signup (popup) and Instagram-direct inside the frame are NOT covered — separate cases when those channels are offered to marketplace merchants | C17: the break-out tab's URL chain (`/auth/sync` → `/pages?connectFacebook=true` → facebook.com) |

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
> scenario. Do not resubmit on the embedded flow alone. ✅ §L itself is green as of
> 2026-08-22 (L-1/L-2 ran live) — that closes bullet 1 and *only* bullet 1.

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

**Where that gate actually stands (2026-08-23, evening):**

| Gate term | State | What is left |
|---|---|---|
| §L — bullet 1 | ✅ **green** | L-1/L-2 (the rejected scenario) + L-3/L-4/L-5/L-10/L-12 live; 7 pinned. L-6/L-9/L-14/L-15 are hardening |
| §A–§F — bullet 3 | 🟢 **§E 4/6 (E-1…E-4, C5–C8), §F 0/3** | The **full order lifecycle round-tripped on one order** (73285179) on 2026-08-23: `order.create` → confirmed → shipped → delivered, all quoting the real invoice number. The ingestion half of bullet 2 is proven end-to-end. Still owed: E-5 dedupe, E-6, SMS *arrival* (Vonage, not Zid), and F-2/F-3 uninstall/reinstall (deliberately NOT run on 08-23 — it disconnects the store and can recreate the R-4 orphan days before resubmit) |
| §H — bullet 2 | 🔴 **0/11 live** | Paid checkout refuses while the app is `Draft`. Expect the reviewer to produce the first paid envelope |
| Listing | 🔴 **all five open** | Gallery is still the **Salla** screenshots; no video, no reviewer credentials, no activation steps, no support SLA. The video is the longest-lead item and also clears Salla's blocker |

⛔ **Read this honestly: one owner action — placing a single real order — is worth more to
this gate than any amount of further code work.** Nothing in §A–§F can be closed by a test.

> ✅ 2026-08-23 evening: that order was placed — from the Zid admin's manual-order wizard,
> no phone and no storefront needed (recipe in E-1). The line above is kept as history.

**Two defects found by the 2026-08-23 stress run — one closed, one still open:**

1. **✅ JSON envelope leaked to the customer on the order-lookup path (D-097) — FIXED and
   verified live.** #916 reached production at 14:55Z (`94a6ca4`). Replayed at ~17:00Z from
   the embedded merchant session against the same page: turn 1 (the message below) → a plain
   Arabic identity challenge; turn 2 (name «Zid Customer» + phone, with `conversationHistory`)
   → «طلبك رقم 73285179 تم توصيله في الرياض.» No envelope on either turn. ⚠️ Stored replies
   cannot prove this either way — `messages` + `comments` hold 0 JSON-shaped outbound rows
   over 7 days, because the leak only ever surfaced through `test-reply`, which is not
   persisted; the replay is the evidence. Original finding, kept as history: asking
   «ابي اتابع طلبي، رقمه 73285179 وجوالي 966500000009» through `POST /pages/:id/test-reply`
   returned TWO raw `{"reply":…,"intent":"QUESTION",…}` envelopes back-to-back and **no human
   text at all**. Not Zid-specific — Salla and Zid share `ecommerceToolHandler`. The proper
   fix is **PR #916** (one shared `parseReplyContent` for all four call sites; the exact
   doubled-envelope shape is pinned by `ai-worker/test/parseReplyContent.test.ts`); prod was
   `6ee8126` (#914) at test time, which is why the leak was still visible then.
2. **🟠 Onboarding never self-skips.** Every open of app 7367 from the Zid dashboard —
   store connected, 4 products synced, a page linked — lands on «مرحباً بك في Jawab24 /
   لنربط متجر زد الخاص بك». Verified at the read path (reload → same screen) and at the
   source: `frontend/src/pages/zid/onboarding.tsx` hard-inits `step = useState(0)` with no
   connection-aware skip anywhere, while the comment in `zid/embedded.tsx` claims
   «onboarding self-skips once a page is linked» — **that mechanism does not exist**. Not a
   rejection bullet, but a reviewer reads "connect your store" on a connected store on every
   open. Fix: route a connected-and-linked merchant straight into the app and correct the
   comment.


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
- 2026-08-22 (a): §L coverage map added — the three states (live / pinned / owed), so
  "11 of 17" could not be misread as "11 passed".
- 2026-08-22 (b): **`EC3` solved and the header un-blocked.** The cause is subscription
  state, never review state: subscribe the store to the app first and a `Draft` app
  installs. P-3 flips 🔴 → ✅, the §H blocker is renamed to what it really is (paid
  checkout refuses for a Draft app), and the `ZID_CLIENT_SECRET`-unverified claim is
  retired. **L-1 and L-2 marked live** — with the logged-out precondition proven from
  `ecommerceControllers.ts:219/:263` rather than from recollection — taking §L to 13 of 17
  (6 live, 7 pinned) and closing rejection bullet 1. A-1/B-1/C-1/C-3 marked with the live
  evidence they already had. **`ZID_APP_ID` resolved to 7367** by a 6/6 live webhook
  registration. P-2's "this email has no Jawab24 account" precondition marked **spent** —
  the install claimed it, and a repeat install of this store reactivates it for its owner
  (`reinstallPolicy`) rather than re-running L-1 — so L-1 and L-9 both need a second store. Exit gates now carry a per-term state table whose
  honest reading is that one owner action — a single real order — outweighs further code.
- 2026-08-23 (evening): **§E closed on the webhook half — `order.create` fired for the first
  time ever.** The eight-day block ("needs a storefront order, which Cloudflare refuses and only
  the owner's phone can place") fell to the Zid admin's **manual-order wizard**, which creates a
  genuine order and fires the event — recipe in E-1. Order 73285179 then ran the complete
  lifecycle on one order (confirmed → shipped → delivered, 97s/48s/42s), all quoting the real
  invoice number, which is #911 verified at the read path. L-3/L-10/L-11/L-12 and the #900
  IDOR guard re-verified live from the embedded merchant session. Exit-gate row for bullet 3
  flips 🟠 → 🟢. Two defects recorded under the gate table: the **D-097 JSON-envelope leak on
  the order-lookup path** (fix #916 — deployed 14:55Z and verified clean at ~17:00Z), and **onboarding
  that never self-skips** (the `embedded.tsx` comment describes a mechanism that does not
  exist). F-2/F-3 and L-7/L-8 deliberately not run — destructive days before resubmit.
