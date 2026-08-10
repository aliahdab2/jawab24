# Zid Integration — 🔧 Rebuilt against the verified contract (pending live validation)

> **Status: rebuilt, NOT yet user-facing.** The integration was rebuilt (2026-08-01)
> against the API contract verified from docs.zid.sa, replacing the original
> implementation that was built on an assumed contract and never round-tripped a real
> store (D-020's bug list is preserved at the bottom of this file for history).
> It ships dark: `ZID_CLIENT_ID` stays unset in production and the integrations page
> keeps Zid's `coming_soon` badge (`frontend/src/pages/integrations.tsx`) until a real
> dev-store round-trip passes — that gate is D-020's and it still stands.
> Rebuild ruling: [`DECISIONS.md` D-053](../../DECISIONS.md).
>
> **Exception, deliberate:** as of 2026-08-07 four *public* surfaces already describe Zid
> as a live integration (llms.txt, llms-full.txt, the `SoftwareApplication` schema, and the
> `about` namespace). Owner decision, taken because the Partner application is submitted
> and approval is expected imminently. See the ⚠️ note in the live-validation checklist
> below before changing anything on either side of that disagreement.

## Verified API contract (docs.zid.sa, fetched 2026-08-01)

### OAuth
- Authorize: `https://oauth.zid.sa/oauth/authorize` · Token: `https://oauth.zid.sa/oauth/token`
- Grants: `authorization_code`, `refresh_token`. Token bodies are form-urlencoded (RFC 6749).
- **The token response carries TWO credentials**, both ~1-year lifetime:
  - `access_token` → sent as the **`X-Manager-Token`** header
  - `Authorization` → sent as the **`Authorization: Bearer`** header
  - plus `refresh_token`, `expires_in`.
- `exchangeCodeForToken` throws if the `Authorization` field is missing (fail fast — without
  it every API call 401s with no obvious cause).

### Dual-credential storage
The second credential is AES-256-GCM encrypted into new nullable columns
`authorization_token` / `authorization_token_iv` on **both** `ecommerce_stores` and
`pending_ecommerce_installs` (migration `0146`). It flows through the whole pipeline:
code exchange → `createStore`/`createPendingInstall` → claim (`finalizeClaim` decrypts and
passes it in the webhook callback ctx) → refresh (`ecommerceTokenRefresh.ts` parses a
rotated `Authorization` field if the refresh response carries one; the stored pair is only
overwritten when supplied). `resolveStoreCredentialPair` returns both decrypted tokens.

### Endpoints (base `https://api.zid.sa`)
| Purpose | Endpoint | Notes |
|---|---|---|
| Store profile | `GET /v1/managers/account/profile` | `storeDomain` = hostname of the store `url` (fallback: store id); `merchantId` = `String(store.id)` |
| Orders | `GET /v1/managers/store/orders?page=&per_page=&payload_type=default` | `per_page` ≤ 100; `payload_type=default` includes items; envelope `{orders: [...]}` |
| Products | `GET /v1/products/?page_size=&page=` | NOT under `/managers`, but requires the dual headers **plus `Role: Manager`** |
| Webhook subscribe | `POST /v1/managers/webhooks` | body `{event, target_url, original_id, username?, password?}` |

- `customer.mobile` in orders is a **full international number WITHOUT `+`**
  (e.g. `"966591555966"`) — `normalizeZidPhone` (exported from `services/zid.ts`) prepends
  `+`. This differs from Salla's split `mobile` + `mobile_code`, so the helper stays
  Zid-local (see `composeSallaPhone` docs in `services/salla.ts`).
- Order status codes: `new`, `preparing`, `ready`, `indelivery`, `delivered`, `canceled`
  (webhook conditions docs also show `inDelivery`/`cancelled` — mapping is case-insensitive
  and tolerates both spellings). `indelivery` → shipped, `delivered` → delivered.

### Webhooks
- Registered per-store via `POST /v1/managers/webhooks` with `original_id` = the Partner
  **Application ID** (`ZID_APP_ID` env — distinct from the OAuth client id).
- **Deliveries are authenticated with HTTP Basic auth** — the `username`/`password` set at
  subscription time come back as `Authorization: Basic base64(user:pass)` on every
  delivery. There is **no HMAC signature header** (the old `x-zid-signature` never
  existed). We register with username `jawab24` (code constant `ZID_WEBHOOK_BASIC_USER`)
  and password `ZID_WEBHOOK_SECRET`; verification is timing-safe
  (`utils/basicAuthVerify.ts`).
- Registered events (`ZID_WEBHOOK_EVENTS`, mirrored in `integrations/zid.ts`
  `ZID_WEBHOOK_TOPICS`, drift-tested): `product.create`, `product.update`,
  `product.publish`, `product.delete`, `order.create`, `order.status.update`.
  Deliberately excluded: `order.payment_status.update` (no consumer),
  `abandoned_cart.created/.completed` (phase-2), `customer.*`/`category.*`.
- **App lifecycle** (`app.market.application.install` / `app.market.application.uninstall`)
  is configured in the Zid **Partner Dashboard**, not via the API — the handler treats
  `app.market.application.uninstall` as the uninstall signal (→ `deactivateStore`). Zid
  invalidates our tokens at uninstall.
- Because the delivery envelope is not yet capture-confirmed, each subscription's
  `target_url` embeds routing hints: `https://<host>/zid/webhooks?e=<event>&sid=<storeId>`.
  The handler resolves store/event from the query string first, then falls back to body
  fields (`store_id`/`store_uuid`/`data.store_id` via `resolveStoreByDomainOrMerchant`).

## Where the code is

| Layer | File |
|-------|------|
| Integration adapter | `backend/src/integrations/zid.ts` |
| Service (OAuth, Merchant API, sync, webhooks) | `backend/src/services/zid.ts` |
| Controller (webhook handler, `buildZidOrderEvent`) | `backend/src/controllers/zid.ts` |
| Routes (shared factory) | `backend/src/routes/zid.ts` |
| Basic-auth verification | `backend/src/utils/basicAuthVerify.ts` |
| Config | `backend/src/config/index.ts` (`config.zid`; enabled when `ZID_CLIENT_ID` set) |
| Migration (dual-token columns) | `backend/migrations/0146_left_prodigy.sql` |
| **Edge routing** | `nginx/nginx.conf` — `location /zid/` → backend, `location = /zid/onboarding` → frontend |
| Tests | `backend/test/{services,controllers,routes,integrations}/zid.test.ts`, `backend/test/utils/basicAuthVerify.test.ts` |
| Routing gate | `scripts/check-nginx-routing.sh` (`npm run check:nginx-routing`, pre-deploy step 0.98) |

### ⚠️ The backend routes are not reachable without the nginx block

The Zid Partner app is configured with **un-prefixed** URLs (`https://jawab24.com/zid/auth`,
`/zid/auth/callback`, `/zid/webhooks`) — not `/api/...`. In production nginx is what maps
those to the backend; the `/api/` prefix exists only because nginx adds it. `services/zid.ts`
also builds its own `redirect_uri` as `https://<ZID_HOST_NAME>/zid/auth/callback`, so the
OAuth round-trip depends on the same block.

**Incident 2026-08-10:** `nginx/nginx.conf` had **no `/zid/` block at all** — the string
"zid" did not appear in the file. Every Zid-configured URL fell through to the frontend
catch-all and returned 404, so the first real install (a test store, while app 7367 was In
Review) dead-ended before reaching the backend. `ZID_CLIENT_ID` was correctly set; the
credentials were never the problem. Two properties made it invisible:

- `nginx -t` passes on the broken config — it is syntactically perfect.
- `/zid/onboarding` returned 200 *by accident* of the catch-all, so the prefix looked wired.

Ordering matters: exact-match blocks (`location = /zid/onboarding`) must sit **above** the
prefix block (`location /zid/`), or the prefix swallows the Next.js page. The same defect
was live for Salla's `/salla/connected` (its Easy-Mode App URL) and is fixed in the same
change. `npm run check:nginx-routing` now asserts every platform URL's upstream.

Env vars: `ZID_CLIENT_ID`, `ZID_CLIENT_SECRET`, `ZID_APP_ID` (webhook `original_id`;
prod-required with the client id), `ZID_HOST_NAME`, `ZID_WEBHOOK_SECRET` (Basic-auth
password, min 16 chars; prod-required with the client id). The old `ZID_SCOPES` /
`SALLA_SCOPES` env vars were dead (declared, never read) and have been removed — scope
strings are hardcoded in `config/index.ts` and the Zid ones are provisional until the
Partner app is created.

## `[provisional]` parsers — finalize from live captures

Everything below compiles, is unit-tested against plausible fixtures, and is written
shape-tolerantly — but the exact field shapes are **unconfirmed** until a real dev store
exists. Tests covering them carry `[provisional — pending Zid live captures]` in their
describe titles (grep for it).

- Webhook delivery envelope (does it carry `event`? a store id? Basic-auth header on
  Partner-Dashboard lifecycle events?) — mitigated by the `target_url` query hints.
- Products list envelope (`results` vs `store_products` — both tolerated) + multilingual
  `name`/`description` objects (`{ar, en}` — Arabic preferred).
- Profile envelope nesting (`user.store` vs `store` — both tolerated).
- Orders search: **no confirmed search/filter param** — `lookupOrder`/`getShipmentTracking`
  scan up to 3 × 100 recent orders client-side behind the single `findOrderByCode` seam;
  swap in the real filter once confirmed. Same for `checkInventory`'s product search
  (first page + client-side match). Open question folded in from
  `.planning/ECOMMERCE_POWER_FEATURES_PLAN.md`: does the orders search index the customer
  phone? (gates order auto-resolve).
- Tracking fields on orders (`tracking_number` / `shipping.*`) — read tolerantly,
  `undefined` when absent.
- Whether the refresh-token grant response rotates the `Authorization` token (handled
  either way: parsed when present, stored pair kept when absent).
- Zid's duplicate-webhook status code (409 and 422 both treated as already-registered).
- The exact casing of the `Basic` scheme on deliveries: verification compares the full
  header string (fails closed on `basic …`) — confirm Zid's casing from a real capture.

## Live-validation checklist (the D-020 gate — follow-up PR)

> **Execution run-book: `docs/testing/ZID_TEST_PLAN.md`** (created 2026-08-01,
> authoritative — captures C1–C11, billing spec, real-traffic soak, publish rehearsal).
> The checklist below is the condensed summary.

Prereq — ✅ DONE 2026-08-01 (application submitted, agreement "In Review"): Partner
account exists (partner.zid.sa, founder), dev store **3195980 "Jawab24 Dev"**
(https://h47p59.zid.store/ — take out of maintenance mode before captures). Still
needed: Zid's agreement approval + ngrok (the Salla Phase-4.2 capture method).

1. ✅ Partner app CREATED 2026-08-01: app id **7367** "Jawab24" (Draft), **Client ID
   7192** (secret in dashboard → General Settings). Redirection URL
   `https://jawab24.com/zid/auth`, Callback URL `https://jawab24.com/zid/auth/callback`.
   Dashboard scope groups selected: Account R, Account Identity R, Store Core Details R,
   Orders R, Products R, Webhooks RW. Lifecycle webhook configured:
   `app.market.application.uninstall` → `https://jawab24.com/zid/webhooks?e=app.market.application.uninstall`.
   ⚠️ Still needed: the OAuth **scope strings** for the authorize URL (fix
   `config.zid.scopes` — dashboard shows groups, not strings), whether `ZID_APP_ID`
   (webhook `original_id`) is the app id 7367 or the Client ID 7192, and what auth the
   `app.market.*` lifecycle deliveries carry.

   🔴 **The scope strings are the one unknown that CANNOT be resolved by capture, and
   they gate everything else.** Every other `[provisional]` item is answered by issuing a
   request and reading the response — but the authorize URL is the first request, and it
   needs correct scopes to succeed at all. A wrong guess fails OAuth with an opaque error
   and blocks steps 2–5 entirely. `config.zid.scopes` is currently
   `'offline_access products.read orders.read webhooks.manage'`, explicitly marked
   provisional in `backend/src/config/index.ts`.

   **Get them before approval, not after.** The config comment says they come from the
   Partner app-creation screen — and app 7367 already exists, so the real list should be
   visible in the Partner dashboard now (app 7367 → scopes), without waiting on the
   agreement. Doing this pre-approval removes the highest-risk unknown from the critical
   path. Two other prereqs are also doable now: take dev store 3195980 out of maintenance
   mode, and pre-stage ngrok.
2. Capture raw responses: token exchange (form-urlencoded accepted? `Authorization` field
   on both grants?), profile, products (+ multilingual name shape), orders, and full
   webhook deliveries (headers + envelope + order payload).
3. Resolve the orders search/filter params (incl. the phone-indexing question) and swap
   the `findOrderByCode` / `checkInventory` scans for real filters.
4. Finalize every `[provisional]` parser + fixture from the captures; run the unit suite
   and `ADMIN_TOKEN=… npm run test:ecommerce:zid` (live smoke).
5. Full round-trip: connect → product sync → KB enrichment → place order →
   `order.create` SMS → status `indelivery` → shipped SMS → `delivered` → delivered SMS →
   uninstall → store deactivated.
6. Only then: remove the `coming_soon` badge (`frontend/src/pages/integrations.tsx`),
   flip the status tables in `INTEGRATIONS.md` / `SYSTEM_ANALYSIS.md`, and append the
   D-NNN closing D-020's gate.

   ⚠️ **Several public surfaces were already flipped ahead of this gate, deliberately,
   on 2026-08-07 (PR #663).** Owner decision: the Zid Partner application was submitted
   2026-08-01 and approval could land at any time, so reverting and re-adding the copy
   was judged churn. These now describe Zid as a live integration **while the badge still
   says `coming_soon`** — that disagreement is known and intended, not a bug to "fix":

   - `frontend/public/llms.txt` — listed under "E-commerce integrations"
   - `frontend/public/llms-full.txt` — its own "### Zid" section under E-Commerce Integration
   - `frontend/src/pages/_document.tsx` — `SoftwareApplication` `featureList` entry,
     `description` ("Shopify, Salla, and Zid"), and `keywords`
   - `frontend/src/i18n/{en,ar}/about.json` — `platforms.zid` + Zid named in `intro.text`,
     rendered by `frontend/src/pages/what-is-jawab24.tsx`

   So at step 6 there is **nothing to add** on those four surfaces — only the badge and
   the status tables remain. Conversely, if the D-020 gate ever fails and Zid is parked
   again, these four MUST be reverted: they are public, and `llms.txt` in particular is
   read verbatim by AI assistants (AI_INSTRUCTIONS §15 — never claim a feature exists
   when it does not).

## Shared infrastructure Zid reuses (unchanged)

The unified `ecommerce_*` schema, `services/ecommerce.ts` (store CRUD,
`replaceProductsAndRebuildSummary`, KB enrichment, GDPR purge), the shared 5 AI tools
(`packages/shared/src/ecommerce-tools.ts`), `registerWebhooksWithPersist` + the retry
worker, the shared token refresher (`ecommerceTokenRefresh.ts`), and the
order-notification scheduler/dedup (`orderNotificationScheduler.ts` +
`customerNotifications.ts`). The product-page cap now derives from the shared
`PRODUCT_SAFETY_CAP` (5000) like Salla — the old silent 300-product truncation is gone.

---

## Historical: the original defects (D-020, fixed by this rebuild)

Kept for context — these are what the 2026-07-07 audit found in the first implementation:

1. **Missing `Authorization: Bearer`** — only `X-MANAGER-TOKEN` was sent, and the
   `Authorization` token was discarded at code exchange, so every API call 401'd and no
   merchant could ever connect.
2. **Invented webhook event names** — `product.created/updated/deleted`,
   `app.uninstalled`, `order.created/updated/shipped/delivered` (none exist in Zid);
   registration failed and `buildZidOrderEvent` was dead code, "covered" by a test that
   asserted `order.created` was *ignored*.
3. **Wrong endpoints** — `/v1/store/info`, `/v1/orders`, `/v1/webhooks` instead of the
   `/v1/managers/...` paths; JSON token exchange instead of form-urlencoded; a
   nonexistent `x-zid-signature` HMAC scheme.
