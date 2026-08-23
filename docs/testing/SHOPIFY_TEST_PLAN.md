# Shopify Integration — Pre-Submission Test Plan

> **Purpose:** Verify every Shopify-facing feature works end-to-end on a real dev store before we submit to the Shopify App Store. Reviewers will try to break each one of these. This doc is a tickable checklist — execute it in order, log pass/fail, fix bugs as you find them.
>
> **When to run:** Before app store submission. Re-run after every Shopify-touching code change before re-submission.
>
> **Companion plans:** `ZID_TEST_PLAN.md` (live-validation run-book, created 2026-08-01) and `SALLA_TEST_PLAN.md` (to be created — most cases mirror this doc).
>
> **Evidence discipline:** log evidence per test (screenshot, log line, DB query). Save any webhook delivery or API response that SURPRISES you (headers + body, verbatim) to `shopify_live_payloads.jsonl` — the Salla/Zid capture convention. §O-0's GraphiQL result and §Q's captures are mandatory evidence, not optional.

---

## Pre-flight: environment

Confirm before you start. If any item is ❌, fix that first; the rest of the plan can't run.

| # | Item | How to verify | Status |
|---|------|---------------|:--:|
| P-1 | Shopify dev store exists | `demo-electronics.myshopify.com` admin loads | ☐ |
| P-2 | Shopify Partners app `Jawab24-Dev` configured with current ngrok URL | Check Partners → App setup → URLs | ☐ |
| P-3 | Backend running locally with dev `.env` — ⚠️ on this machine the backend runs on **3100** (3000 is frequently taken by an unrelated dev server; `lsof -iTCP:3000 -sTCP:LISTEN` to check, never kill what you find; the `/shopify-dev` skill handles ports) | `curl http://localhost:3100/health` returns OK | ☐ |
| P-4 | ngrok tunnel active to backend | `https://<ngrok>.ngrok-free.dev/health` returns OK | ☐ |
| P-5 | Frontend running on `localhost:3001` | Browser opens dashboard, can log in | ☐ |
| P-6 | At least one Facebook test page connected with valid token | Pages page lists at least one entry | ☐ |
| P-7 | Test phone number with SMS receive capability | Required for cart-recovery / order-confirmation tests | ☐ |
| P-8 | Test Shopify store has ≥ 5 products with images | Shopify admin → Products | ☐ |
| P-9 | A `.env` `SHOPIFY_API_KEY` matches `Jawab24-Dev` (not prod) | Check value vs Partners app | ☐ |

---

## A. OAuth Install Flow

### A-1. Logged-in user install (settings flow)
**Preconditions:** Logged in to dashboard, no Shopify store connected to this workspace.

**Steps:**
1. Open `/en/integrations`
2. Click "Connect" on the Shopify card
3. Enter `demo-electronics` as shop domain
4. Get redirected to Shopify OAuth consent
5. Click "Install app"

**Expected:**
- Redirect lands on `/en/shopify/onboarding` showing the 3-step wizard
- A row appears in `ecommerce_stores` with `platform='shopify'`, `is_active=true`, encrypted `accessToken`
- A background sync job is queued in BullMQ
- After ~30s, `/en/integrations` shows the connected card with product count > 0

### A-2. Shopify-first install (App Store flow)
**Preconditions:** Logged out of dashboard.

**Steps:**
1. From Shopify Partners → app → "Test on development store" → click `demo-electronics`
2. Click "Install app" on Shopify consent screen
3. Get redirected to Jawab24 login page with `pendingInstallId` in query
4. Log in (or sign up)

**Expected:**
- After login, the `pendingInstallId` is claimed
- Store row created (same shape as A-1)
- Redirect to `/en/shopify/onboarding`

### A-3. Re-install on already-connected shop
**Preconditions:** A-1 or A-2 already passed; store currently active.

**Steps:**
1. Repeat A-1 with the same shop domain.

**Expected:**
- No duplicate row in `ecommerce_stores`
- Existing row's `accessToken` is rotated (new value)
- Webhooks re-registered (check `platformData.webhookStatus.lastAttempt`)

### A-4. Reinstall after disconnect
**Preconditions:** A-1 passed; then disconnected via UI; store row has `is_active=false`.

**Steps:**
1. Repeat A-1 with the same shop domain.

**Expected:**
- Same `ecommerce_stores.id` row reactivates (`is_active=true`)
- Token rotated
- No duplicate sync queued; only one sync runs

### A-5. OAuth state mismatch (CSRF)
**Steps:**
1. Start install flow, capture the OAuth `state` param
2. Manually change the `state` in the callback URL before submitting

**Expected:**
- Backend rejects with 400 (state mismatch)
- No store row created
- No token saved

### A-6. Pending install expiry
**Preconditions:** Shopify-first install kicked off but never completed (i.e., row in `pending_ecommerce_installs` aged > 30 min).

**Steps:**
1. Query `pending_ecommerce_installs` for the row, force-update its `createdAt` to 31+ min ago
2. Try to claim it via login

**Expected:**
- Claim is rejected with a "pending install expired" error
- Cleanup job (`cleanupExpiredInstalls`) eventually purges the row

---

## B. Product Sync

### B-1. Full sync — small catalog
**Preconditions:** A-1 passed on a 5-product store.

**Steps:** Wait for the post-install sync to finish (≤30s).

**Expected:**
- `ecommerce_products` has 5 rows for this `ecommerceStoreId`
- Each row has `title`, `priceRange`, `imageUrl` populated
- `ecommerce_stores.product_count = 5`, `last_sync_at` updated

### B-2. Manual re-sync
**Steps:** Click "Sync Now" on the connected store card.

**Expected:**
- Toast shows "Sync successful"
- `last_sync_at` updates
- No duplicate product rows; an already-synced product retains its `id`

### B-3. Incremental update (webhook)
**Steps:**
1. In Shopify admin, edit a product's title or price
2. Wait ~5s

**Expected:**
- Backend logs receipt of `products/update` webhook with valid HMAC
- The `ecommerce_products` row reflects the new title/price
- No full re-sync triggered

### B-4. Product delete (webhook)
**Steps:** Delete a product in Shopify admin.

**Expected:**
- `products/delete` webhook received
- Corresponding row removed from `ecommerce_products` (or marked inactive — verify per current behavior)

### B-5. Empty store
**Preconditions:** Connect a store with 0 products.

**Expected:**
- Sync completes without error
- `product_count = 0`
- AI replies still work (KB enrichment uses store policies, not products)

### B-6. Large catalog (pagination)
**Preconditions:** Connect a store with 100+ products (use Shopify CLI to seed if needed).

**Expected:**
- Sync completes without error or timeout
- All products land in `ecommerce_products`
- Backend memory usage stays bounded (pagination working)

### B-7. Image-less products
**Preconditions:** A few products in the test store have no main image.

**Expected:**
- Sync stores `imageUrl = null` for those rows
- Rich product cards (Section H) skip these products gracefully

---

## C. Page Linking

### C-1. Link a Facebook page
**Preconditions:** B-1 passed; at least one FB page connected to the workspace.

**Steps:** Click the FB page chip in the Shopify card.

**Expected:**
- Toast: "Page linked"
- `pages.ecommerceStoreId` updated to the store's id
- Chip now shows `CheckCircle2` icon

### C-2. Unlink a page
**Steps:** Click an already-linked page chip again.

**Expected:**
- Toast: "Page unlinked"
- `pages.ecommerceStoreId` set to `null`

### C-3. Link multiple pages to same store
**Steps:** Link two different FB pages to the same Shopify store.

**Expected:**
- Both pages have `ecommerceStoreId` set to the same store
- Both can use the AI agent tools against the same store

### C-4. Cross-workspace page rejection (security)
**Preconditions:** Workspace A has store; workspace B has a page.

**Steps:** Try to link workspace B's page to workspace A's store via direct API call (requires manual `X-Workspace-Id` swap).

**Expected:** Backend returns 403 / 404; no link created.

---

## D. AI Agent Tools (live DM)

For each test, send the listed message as a real DM to the linked FB test page and observe the reply.

| # | Customer DM | Tool exercised | Expected reply behavior |
|---|---|---|---|
| D-1 | "Where is my order #1001?" | `lookup_order` → `verify_and_get_order` | Asks for name/phone first; after correct answer, returns order status |
| D-2 | Wrong verification answer | `verify_and_get_order` (fail path) | "I couldn't verify…" — does NOT leak order data |
| D-3 | "Track my order #1001" | `track_shipment` → `verify_and_get_shipment` | Verification challenge → tracking info on success |
| D-4 | "Do you have the [product name]?" (synced product, has image) | `check_inventory` | Text reply + **product card carousel** (Step 1 — Section H) |
| D-5 | "Do you have the [product name]?" (synced product, NO image) | `check_inventory` | Text reply only, no card |
| D-6 | "Do you have the [unknown product]?" | `check_inventory` (not found) | Polite "couldn't find it" message |
| D-7 | DM in Arabic about a product | All tools | Reply is in Arabic; product data still resolved correctly |

---

## E. Order Webhooks → SMS Notifications

> Requires P-7 (test phone number with SMS receive). All these check that `customer_notifications_log` rows are created with status `sent` (the enum is pending/sent/failed/cancelled — there is no `delivered` status) and an actual SMS lands.

> ### ⭐ E-2/E-3 do not depend on E-1 — any EXISTING order will do
>
> Proven on Zid 2026-08-23 (ZID_TEST_PLAN.md §E-2/E-3): a status/fulfilment change made in
> the store admin fires a real webhook through the whole ingestion path, so **if the dev
> store already carries an order you can run the shipped/delivered rows without placing a
> new one**. Nothing is faked — the only step skipped is the purchase itself. Useful
> because the storefront checkout is the most blockable step (on Zid it hit a Cloudflare
> managed challenge, which must never be driven or disguised).
>
> Shopify's lever is fulfilment rather than a status dropdown, because its order-level
> `fulfillment_status` enum is only `null|partial|fulfilled|restocked` — it has no
> `delivered` value:
>
> | Row | Reachable from an existing order? | Lever |
> |---|---|---|
> | E-1 `orders/create` | ❌ **No.** Only a real purchase fires it. | the checkout |
> | E-2 `orders/fulfilled` | ✅ Yes | fulfil the order in admin, with a tracking number |
> | E-3 delivered | ✅ Yes | `fulfillments/update` carrying `shipment_status` — see E-3 |
>
> **Verify at the read path**: `GET /api/notification-log/<storeId>` and `…/stats` with the
> merchant's own session, not by watching for the webhook.
>
> ⚠️ **Ingestion and SMS delivery fail independently.** On Zid the rows landed correctly and
> then failed to send with `Vonage delivery error: Quota Exceeded - rejected` — an account
> problem, not an integration one. A `failed` row still proves the webhook, mapping and
> dedup behaviour; only the "SMS arrives" clause is blocked.

### E-1. New order → order_confirmed SMS
**Steps:** Place a test order on the dev store with the test phone number.

**Expected:**
- `orders/create` webhook received
- A row in `customer_notifications_log` with `notificationType='order_confirmed'`, `status='sent'`
- SMS arrives within 30s

### E-2. Order fulfilled → order_shipped SMS
**Steps:** Mark the order as fulfilled in Shopify admin (add fake tracking number).

**Expected:**
- `orders/fulfilled` webhook received
- `order_shipped` notification logged + SMS arrives

### E-3. Order delivered → order_delivered SMS
**Steps:** Move the fulfilment to delivered (varies by Shopify shipping app). ⚠️ Delivery
is **not** an `orders/*` event — the order-level `fulfillment_status` enum is only
`null|partial|fulfilled|restocked` and never `delivered`. The signal arrives on
**`fulfillments/update`** via `fulfillment.shipment_status`, handled by
`webhookFulfillments` (fields used: `order_id`, `shipment_status`,
`destination.{first_name,phone}`).

⚠️ **Only `shipment_status === 'delivered'` dispatches.** The same topic fires repeatedly
for `in_transit`, `out_for_delivery`, `attempted_delivery`, `failure` and friends, and all
of those are 200'd and ignored by design — so "the webhook arrived but no SMS" is the
expected result until the carrier reports delivered, not a bug. If nothing fires at all,
confirm the topic is subscribed before suspecting the mapping.

**Expected:** `order_delivered` notification + SMS.

### E-4. Order cancelled → no notification (or specific cancel template)
**Steps:** Cancel the test order.

**Expected:** Verify expected behavior — current code may not send SMS for `orders/cancelled`. Document actual behavior.

### E-5. Notification dedup
**Steps:** Re-fire the same `orders/create` webhook (Shopify Partners → "Send test notification").

**Expected:**
- No duplicate `customer_notifications_log` row (deduped by `platformEventId`)
- No second SMS to customer

### E-6. Webhook with invalid HMAC
**Steps:** Send a `POST /shopify/webhooks/orders` with a wrong `X-Shopify-Hmac-Sha256` header.

**Expected:** Backend returns 401, no DB writes.

---

## F. Cart Abandonment

> NOTE: Shopify doesn't have a native abandoned-cart webhook; the project uses Shopify Flow OR polling. Verify which is wired before testing.

### F-1. Abandoned cart → SMS
**Steps:** Add items to a test cart, navigate away, wait 60+ minutes.

**Expected:**
- `abandoned_cart` notification queued in BullMQ with delay
- After delay expires, SMS sent
- `customer_notifications_log` row with `cartTotal`, `customerPhone`

### F-2. Cart recovered before SMS fires (cancellation)
**Steps:** Trigger F-1, then place an order with same phone before the 60-min delay completes.

**Expected:**
- The pending `abandoned_cart` notification gets `status='cancelled'`
- No SMS sent
- `order_confirmed` SMS still fires for the new order

---

## G. Rich Product Cards (Step 1)

### G-1. Card sent on inventory hit with image
**Steps:** D-4 from above.

**Expected payload to Meta:**
- `template_type: 'generic'` attachment with 1 element
- `image_url` matches `ecommerce_products.imageUrl`
- `default_action.url` = product URL on the store
- Buttons array has one `web_url` button with title "View product"

**How to verify:** Backend logs the `sendProductCards` call (Sentry breadcrumb), AND the customer sees the card in Messenger.

### G-2. Card NOT sent when image missing
**Steps:** D-5 from above.

**Expected:** Backend reaches `productCardBuilder.buildProductCardsFromToolResults`, returns `[]`, text-only reply sent. No `/me/messages` call with `attachment`.

### G-3. Card send failure does not invalidate text reply
**Preconditions:** Force a failure (e.g., temporarily corrupt the page access token between text-send and card-send).

**Expected:**
- Text reply already delivered to the customer
- Pipeline result is `success: true`
- Card-send error is logged via `captureError` (Sentry) but doesn't bubble up

---

## H. Analytics Dashboard (Step 2)

### H-1. Dashboard renders for connected store
**Preconditions:** Store connected, ≥ 5 notifications in `customer_notifications_log` over last 30 days.

**Steps:** Open `/en/ecommerce-analytics`.

**Expected:**
- 4 KPI tiles: Revenue Recovered (with currency), Carts Recovered, AI Replies, Total Replies
- Notification funnel section showing delivered/failed/pending bars
- By-type breakdown (sorted desc by count)
- Reply-method breakdown

### H-2. Range toggle 30d ↔ 90d
**Steps:** Click "Last 90 days".

**Expected:**
- New `GET /api/ecommerce-analytics/:storeId?range=90d` request fires
- Numbers update accordingly

### H-3. No store connected
**Steps:** Open `/en/ecommerce-analytics` with no store on the workspace.

**Expected:** "Connect a store to see analytics" empty state with link to `/integrations`.

### H-4. Cross-workspace store access (security)
**Steps:** Hit `GET /api/ecommerce-analytics/<storeId-from-other-workspace>` with current workspace cookie.

**Expected:** 403 response.

### H-5. Summary widget on integrations page
**Steps:** Open `/en/integrations` after H-1's preconditions are met.

**Expected:** Inside the connected Shopify card, a row shows "X carts recovered · Y SAR" plus AI reply count, plus a "View details" link routing to `/ecommerce-analytics`.

### H-6. Summary widget hides on empty store
**Preconditions:** New connection, no notifications yet.

**Expected:** Widget renders nothing (no broken empty card).

### H-7. Arabic locale RTL
**Steps:** Switch dashboard to Arabic, open `/ar/ecommerce-analytics`.

**Expected:**
- `<html dir="rtl">` set
- All labels translated
- Charts mirror correctly
- Currency formatting reads right-to-left

---

## I. GDPR Webhooks

> Reviewers WILL test these. Each must respond 200 within ~5s and (where applicable) actually delete data.

### I-1. customers/data_request
**Steps:** Send a `POST /shopify/gdpr/customers/data_request` with a valid HMAC and a JSON body referencing `customer.id` from the dev store.

**Expected:** 200 response. A row should be logged (or an audit log line) showing the request was received.

### I-2. customers/redact
**Steps:** Same shape, but `/customers/redact`. Reference a customer who has notifications in `customer_notifications_log`.

**Expected:**
- 200 response
- Customer's notification log rows are deleted OR `customerPhone`/`customerName` are nulled
- No order data leaks remain

### I-3. shop/redact
**Steps:** `POST /shopify/gdpr/shop/redact` with valid HMAC for the connected store.

**Expected:**
- 200 response
- All `ecommerce_products` rows for this store deleted
- All `customer_notifications_log` rows for this store deleted
- The `ecommerce_stores` row is deleted (or hard-anonymized — verify which)
- Linked pages have `ecommerceStoreId` nulled

### I-4. GDPR webhook with invalid HMAC
**Steps:** Same as above with corrupted HMAC.

**Expected:** 401, no data deletion.

---

## J. Disconnect & Uninstall

### J-1. Disconnect via UI
**Steps:** Click "Disconnect" on the Shopify connected card.

**Expected:**
- `ecommerce_stores.is_active = false`
- Token NOT deleted yet (allows reconnect without re-OAuth in some flows — verify current behavior)
- Linked pages have `ecommerceStoreId` nulled
- Reconnect card replaces the connected card

### J-2. Uninstall from Shopify admin
**Steps:** From Shopify admin → Apps → Jawab24-Dev → Uninstall.

**Expected:**
- `app/uninstalled` webhook received with valid HMAC
- `ecommerce_stores.is_active = false`
- `accessToken` purged
- Pages unlinked

### J-3. Reinstall after Shopify-side uninstall
**Steps:** After J-2, repeat A-1 install.

**Expected:** A-4 behavior — same row reactivates, no duplicates.

---

## K. Token Expiry / Revocation

### K-1. Externally-revoked token
**Steps:** From Shopify admin, revoke API access for the app (or wait for a token to expire if Shopify forces rotation — Shopify tokens generally don't expire, but the flow should still handle 401s).

**Steps:** After revocation, click "Sync Now" in the Jawab24 dashboard.

**Expected:**
- Sync fails gracefully
- Error toast or error message shown
- Status of store in DB reflects the failure (e.g., a flag on `platformData`)
- AI agent tools that hit Shopify also fail gracefully without crashing the reply pipeline

---

## L. Multi-Tenant Security

### L-1. Cross-workspace product leakage
**Steps:** Workspace A has Shopify store synced. Workspace B sends a DM mentioning product names.

**Expected:** Workspace B's AI replies use ONLY workspace B's KB / store. No data from workspace A surfaces.

### L-2. Cross-workspace endpoint access
**Steps:** Authenticate as user in workspace B, hit `GET /shopify/store/products?storeId=<workspaceA-store-id>`.

**Expected:** 403 (if `storeId` is even accepted as a param) or correctly-scoped result returning workspace B's data only.

### L-3. Webhook spoofing
**Steps:** Send a webhook with a valid HMAC computed with a different shop's secret.

**Expected:** Backend uses the global Shopify webhook secret; HMAC verification rejects mismatched payloads. (If we have per-store secrets — verify the matching logic).

### L-4. Cross-workspace notification endpoints — ✅ pinned 2026-08-23
**Steps:** Authenticate as a user in workspace B, hit every `:storeId` route with workspace A's
store id: `GET /notification-templates/:storeId`, `PUT …/:storeId/:type`, `POST …/:storeId/reset`,
`GET /notification-log/:storeId`, `GET /notification-log/:storeId/stats`.

**Expected:** 403 on all five; A's template rows untouched after the PUT and the reset; an unknown
id is 404. (H-4 covers the analytics route; this row exists because until 2026-08-23 these five
trusted the URL's `storeId` outright — proven live against the Zid dev store from a second account,
full template bodies returned. The notification log carries customer phone numbers, so this was a
cross-merchant data leak waiting for the first real store.)

**Pinned by:** `backend/test/integration/storeOwnershipRoutes.test.ts` (HTTP, two real workspaces,
mutation-checked: removing the guard fails 6/7) and `backend/test/middleware/storeOwnership.test.ts`.
The guard is the shared `requireOwnedStore` preHandler in `backend/src/middleware/storeOwnership.ts` —
any new route that takes a `:storeId` must mount it.

---

## M. Edge Cases & Error Paths

### M-1. Concurrent OAuth callbacks
**Steps:** Trigger two OAuth flows for the same shop within seconds (open two browser tabs).

**Expected:** Only one row created. The second callback either succeeds (idempotent) or rejects cleanly.

### M-2. Shopify API outage during sync
**Steps:** Block outbound to `shopify.com` (e.g., via `/etc/hosts`), trigger a sync.

**Expected:** Sync job retries (BullMQ); after max retries, fails gracefully; store remains `isActive=true`; UI shows "sync failed" but doesn't break.

### M-3. Sync runs while another sync is in-flight
**Steps:** Click "Sync Now" twice in quick succession.

**Expected:** Lock or dedup prevents two concurrent syncs for same store; UI handles the second click as no-op or "already syncing".

### M-4. Webhook arrives during sync
**Steps:** While B-1 is running, simultaneously fire a `products/update` webhook.

**Expected:** Both succeed; final state is consistent.

### M-5. Malformed product (no title, no price)
**Steps:** In Shopify admin, create a draft product with empty title.

**Expected:** Sync handles it (skip or ingest with placeholder); doesn't crash the worker.

### M-6. Very long product description / title
**Steps:** Product with 5000-char description.

**Expected:** Stored truncated per schema limits without error; AI replies still coherent.

### M-7. Payload size — orders webhook with 50+ line items
**Steps:** Place a test order with many items.

**Expected:** Webhook processed; no payload-size errors.

---

## N. Reviewer Rehearsal

After everything else passes:

1. **Read the Shopify App Store listing copy** (`docs/shopify-app-listing.md` Sections 2-4) out loud
2. For every claimed feature, find which test ID above proves it
3. If a claim has no proving test, either remove the claim or add a test
4. Do a clean install on a brand-new dev store as if you've never used Jawab24
5. Time the onboarding from "click install" to "first AI reply working" — should be < 10 min for a competent merchant. If longer, note what slowed you down.

---

## O. Billing — Shopify App Pricing (D-054)

Prereqs: App Pricing plans configured with **handles = plan slugs** (starter/business/pro),
a private **$0 test plan**, redirection URL `https://<host>/shopify/billing/return`,
`SHOPIFY_APP_HANDLE` set. Dev-store charges are free within the same Partner org.

> ⚠️ The $0 test plan's **display name must lowercase to a billable slug** (e.g. name
> it `Starter`, handle `starter-test`) — activation resolves the AppSubscription's
> NAME through `mapShopifyPlanToSlug` (`syncShopifyBilling` reads `appSub.name`, not
> the handle), so a plan named "Test $0" can never activate a mirror (fail-loud by
> design) and O-1 would fail before it starts. O-8 covers the unknown-name path
> deliberately.

**O-0 (V3 gate, run FIRST).** After selecting the $0 plan, query
`currentAppInstallation { activeSubscriptions { id name status } }` with the store token
(GraphiQL). If App Pricing enrollments do NOT appear here, STOP — swap
`fetchShopifyActiveSubscription` internals to the Partner API before running O-1…O-7.

| ID | Test | Expected |
|----|------|----------|
| O-1 | Select the $0 test plan in Shopify → approve → land back on jawab24.com | `GET /shopify/billing/return` hit; local row: `payment_method='shopify'`, GID in `external_subscription_id`, `shopify_shop_domain` set, status `active` (or `trialing` if the plan has trial days), usage window initialized, subject = workspace OWNER |
| O-2 | Upgrade to a higher plan inside Shopify admin | Next sync (return hit or ≤6h reconcile) moves `plan_id` to the new slug; period advances contiguously; NO duplicate row |
| O-3 | Cancel the subscription inside Shopify admin (app stays installed) | Reconciler pauses the local mirror (`status='paused'`); replies blocked; re-selecting a plan reactivates through the same sync |
| O-4 | Uninstall the app while the subscription is live | `webhookUninstall` cancels the local mirror (`status='canceled'`, `cancel_reason='shopify_app_uninstalled'`) AND deactivates the store — no paid local sub outlives the app |
| O-5 | Reinstall + re-select a plan on the same workspace | Same row re-adopted (update, not insert); no unique-index collision |
| O-6 | Select a plan, then KILL the browser before the return redirect | Row still adopted by the reconciler within 6h (or run `reconcileShopifyBilling` manually) — the return endpoint must not be a single point of failure |
| O-7 | While shopify-billed: open /pricing, /checkout, top-up CTA | Pricing shows the "managed in Shopify" banner + deep link; plan clicks route to Shopify admin; `/checkout` bounces (`SHOPIFY_BILLED`); top-up CTA hidden; `POST /payment/create-subscription-intent` returns 400 `SHOPIFY_BILLED` |
| O-8 | Plan with an unknown handle (create a `qa-temp` plan) | NO activation; Sentry `unknown plan` event; merchant stays on previous state (fail-loud, never guess) |
| O-9 | Stripe-paying user installs the app on the same workspace and picks a plan | Adoption REFUSED (D-H); Sentry collision warning; Stripe row untouched — a human resolves |

---

## Q. Real-Traffic Soak & Robustness

> Named §Q (not §P) to avoid colliding with the Pre-flight P-* IDs. Run AFTER A–L are
> green. The unit suites prove the logic; this section proves the integration under the
> traffic shapes production actually sees — sustained live AI replies, webhook bursts,
> API throttling, delivery outages, and reconciler failures. Mirrors
> `ZID_TEST_PLAN.md` §I so both platforms carry the same robustness bar.

### Q-1. Live DM soak (real AI traffic)
**Steps:** Over ~1 hour, send ≥30 real DMs to the linked FB test page mixing: Arabic
dialects + فصحى + English, product questions (in and out of catalog), order lookups with
verification, follow-ups, and rapid-fire consecutive messages.

**Expected:**
- Every reply grounded: prices only from the synced catalog, "let me check" on unknowns
  (the two-tier price guard never lets an unverified number through)
- Consolidation merges rapid-fire messages — no double replies
- Phase 6.5 counters coherent for the window (`scripts/phase6_5_breakdown.ts`):
  `attempts == returns`, `returns − logged` explained only by cache hits / refusals;
  **zero** `failed_before_log:*:AiWorkerUnreachable`
- Latency read from the pipeline stage laps, not eyeballed (Rule 17: they log at
  `debug` — run the soak with `LOG_LEVEL=debug` locally or the timings are dark):
  cache hits in ms, misses inside the 2–4s OpenAI band

### Q-2. Webhook burst / dedupe under fire
**Steps:** Re-deliver the same `orders/create` webhook 10× within ~5s (Partners "Send
test notification" or curl-replay with a valid HMAC), interleaved with 2 distinct real
orders.

**Expected:** Exactly 1 `customer_notifications_log` row + 1 SMS per DISTINCT order
(dedupe key `(store, type, platform_event_id)`); replays all 200; zero duplicate SMS.

### Q-3. Product-update storm → live THROTTLED path
**Steps:** Bulk-edit ~50 products in the Shopify admin (bulk editor) so per-product
webhooks + syncs land together; watch backend logs for cost-based `THROTTLED`
(HTTP 200 + `errors[].extensions.code`).

**Expected:**
- The throttle-retry path runs FOR REAL (backoff derived from
  `extensions.cost.throttleStatus`) — until now it has only ever run against mocks
- Sync converges: final `ecommerce_products` state matches the admin exactly
  (spot-check 5), no rows lost to truncation, no crash-looping worker

### Q-4. Delivery-outage window (Shopify's retry policy, observed)
**Steps:** Stop the backend (ngrok up → 502s) for ~10 minutes; during the window place
1 real order and edit 2 products; restart; wait.

**Expected/Capture:**
- Shopify redelivers on its documented retry schedule — record the actual gaps seen in
  the ngrok inspector (evidence for how long an outage is survivable)
- After restart, every missed event eventually lands and processes exactly once
- `webhookHealth` never degrades to the point of Shopify cancelling subscriptions
  during a short outage; if it does, the reregister endpoint + retry worker heal it
  (this is the first live exercise of that code path — flagged in Open follow-ups)

### Q-5. Billing reconciler failure injection (needs §O prereqs)
**Steps:** With ≥2 shopify-billed stores in the dev DB (the $0-plan mirror + a
synthetic second row), revoke/corrupt ONE store's token, then run
`reconcileShopifyBilling` manually.

**Expected:**
- The failing store produces ONE aggregated sweep-error Sentry event (fingerprinted,
  not a spam storm) — and the OTHER store is still processed (a bad store must not
  abort the sweep)
- Delete the synthetic store row (keep its mirror) and re-run: the orphaned live
  mirror is Sentry-flagged, not silently skipped
- Restore state afterwards (delete synthetic rows; note it in the run log)

### Q-6. Sustained-connection sanity after the soak
**Steps:** After Q-1–Q-4, run the §B-2 manual sync and one §D DM case again.

**Expected:** Everything still green — the soak left no poisoned state (stuck BullMQ
jobs, stale locks, half-written product rows).

---

## How to use this doc

1. Open in a markdown editor that supports task lists, OR copy each section into a Notion/Linear ticket
2. Run sections **in order** — many depend on prior sections
3. For each test ID: pass / fail / blocked — log evidence (screenshot, log line, DB query)
4. **For every failure, open a bug ticket and link the test ID** so resubmission can prove the regression is fixed
5. Don't proceed to App Store submission until **A through L plus O are all green**. M and N can be partial if non-blocking. **§Q must be green before the listing goes live to real merchants** (submission can proceed in parallel with fixing non-blocking §Q findings — reviewers generate little traffic; launch marketing generates a lot).

---

## Change log

| Date | Change |
|------|--------|
| 2026-04-25 | Initial test plan covering Steps 1 + 2 + existing Shopify integration (OAuth, sync, page linking, agent tools, order webhooks, GDPR, security). |
| 2026-04-25 | Dogfood session executed Sections A + B; surfaced 5 install/sync bugs. A-1.3 + A-1.4 closed in commit `723872b9`. A-1.5, A-1.9, B-3.1 closed in commit `b5ff88d2`. Backend now exposes `webhookHealth` field + `POST /shopify/store/webhooks/reregister`. Frontend banner + Try-again CTA shipped in `ff2d6324`; controller decrypt-in-trycatch hardening in `1c3eef8e`. |
| 2026-08-01 | Added §O (App Pricing billing, D-054) with the V3 gate O-0; submission gate widened to A–L + O. |
| 2026-08-01 | Added §Q (real-traffic soak & robustness: live DM soak with Phase 6.5 counter coherence, webhook burst/dedupe, live THROTTLED exercise, delivery-outage window, reconciler failure injection); evidence-discipline note (`shopify_live_payloads.jsonl`); P-3 port drift fixed (3100, not 3000); launch gate = §Q green. Companion `ZID_TEST_PLAN.md` created. |

## Resolved bugs

Issues from the 2026-04-25 dogfood session, all CLOSED. Regression tests in `backend/test/regression/shopify-install-bugs.test.ts` keep them closed.

| ID | Severity | Description | Closed in | Notes |
|----|----------|-------------|-----------|-------|
| A-1.3 | High | `getStoreByWorkspaceAny` had no `ORDER BY` → workspaces with multiple Shopify rows could return the wrong one | `723872b9` | `ORDER BY isActive DESC, updatedAt DESC LIMIT 1` |
| A-1.4 | High | `replaceProductsAndRebuildSummary` was not transactional → concurrent syncs raced the unique index to 500 | `723872b9` | Wrapped delete+insert in `db.transaction` |
| A-1.5 | Low | `POST /shopify/store/sync` rejected empty JSON body with 400 "Unexpected end of JSON input" | `b5ff88d2` | Custom content-type parser treats empty body as `{}` globally |
| A-1.9 | Medium | `claimPendingInstall` fired `registerWebhooks` fire-and-forget → CLI/short-lived processes lost registrations silently | `b5ff88d2` | `await` inline + persist `webhookStatus` + BullMQ retry queue (3 attempts, 30s/2min/8min backoff) |
| B-3.1 | Low (dormant footgun) | Single-product webhook triggered full re-sync → every product's internal `id` rotated on every edit | `b5ff88d2` | Per-row `INSERT ... ON CONFLICT DO UPDATE` for full sync; new `upsertSingleProduct` / `deleteSingleProduct` for webhooks |
| (new) | Medium | Manual webhook re-registration had `decrypt()` outside `try/catch` → corrupt/missing tokens surfaced as raw 500 instead of friendly 502 | `1c3eef8e` | Caught during live UI testing of the "Try again" button |

## Open follow-ups

Surfaced during this session, not blockers for Shopify App Store submission but tracked here so they don't get lost:

- **Salla + Zid have the same install/observability gaps** — fire-and-forget webhook registration, no retry, no observability tags. Bringing them up to parity is ~1.5 hr; tracked separately.
- **Live exercise of the new failure-recovery code paths** — the retry worker, persist-on-throw, and `/store/webhooks/reregister` endpoint have only been tested with mocks. Section 4 of `.planning/SHOPIFY_LAUNCH_VALIDATION.md` covers the exercise plan.
- **Demo seed writes `platform_data` as a JSONB string instead of an object** — caused "cannot set path in scalar" during DB-level state injection. Likely CLOSED by PR #596 (jsonbColumn.ts + migration 0148 re-encode all drizzle jsonb columns as real objects) — verify on the next demo-seed run, then strike this.
- **No Playwright test for the connected-store card webhook-health states** — backend regression covers the field, frontend is uncovered.
