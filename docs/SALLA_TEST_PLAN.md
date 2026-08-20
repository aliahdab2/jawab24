# Salla — Test Plan & Closed-Loop Results

> The **test** surface for the Salla integration, from code change through go-live.
> Companion to `SALLA_SUBMISSION_RUNBOOK.md` (the *execution* checklist — what to flip, in
> what order). This file answers "what must be green, and how do I prove it".
>
> **Current state: APPROVED by Salla, NOT yet published.** Tier 3 is the gate standing
> between here and a public listing. Tier 0 must pass before Tier 3 means anything.
>
> Last full Tier-1/2 run: **2026-07-19**. Counts refreshed **2026-08-17** (PR #798).

## Scope — three rings

1. **Salla proper** — controller, service, integration adapter, routes, the Easy-Mode
   claim/pending-install flow (D-031).
2. **E-commerce machinery Salla rides on** — token crypto/health/refresh, catalog sync,
   webhook product path, order actions, the agent tool loop, RAG over the catalog,
   comment-processor hooks.
3. **Shared infra** — CSRF/auth middleware. Changes here are Critical-severity by the
   review rules: every request in the product flows through it.

---

## Tier 0 — Production preflight (NEW, run FIRST)

**Why this tier exists.** On 2026-08-17 a live check found production four commits behind
`main` and missing all three Easy-Mode env vars. Any Tier-3 result gathered in that state
would have described code and config that aren't what merchants would meet. **A live test
against the wrong build is worse than no test — it manufactures false confidence.**

Run every row. All must pass before a single Tier-3 step.

| # | Check | Command | Pass criteria |
|---|-------|---------|---------------|
| 0.1 | Prod runs the intended commit | `ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 'cd /var/www/jawab24 && git log --oneline -1'` | equals `origin/main` HEAD; in particular carries `4c6469a1` (List Shipments fix) |
| 0.2 | Easy-Mode switches set | `docker exec jawab24-backend-<colour> printenv \| grep '^SALLA_'` | `SALLA_EASY_MODE_CLAIM_ENABLED=true` and `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true` present. ⚠️ `SALLA_APP_STORE_URL` is **post-publish** — the URL does not exist until the listing is live, so it cannot be a pre-publish pass criterion |
| 0.3 | Prod app creds are the **production** app | same `printenv` | 🔴 **FAILING as of 2026-08-20.** `SALLA_CLIENT_ID` must MATCH app `665811310` (fingerprint `c18dcc…8f4d`) — ⛔ *not* merely differ from Jawab24-Dev `1565152053`. "Not the dev app" is what let a third, phantom app survive since 07-31. Check the webhook token in the same pass; `SALLA_HOST_NAME=jawab24.com` |
| 0.4 | `shipping.read` granted | Salla Partners portal → app → scopes | ticked. ⛔ Without it `track_shipment` returns status with no tracking (403 → degrade). Config alone does **not** grant it — Easy Mode never calls `buildAuthUrl` |
| 0.5 | Article-5 Stripe guard live (D-065) | `docker exec jawab24-backend-<colour> sh -c "ls /app/backend/dist/config/sallaBilling.js"` | file present |
| 0.6 | Container healthy after any recreate | `docker ps` + `scripts/health-check.sh` | all healthy; **`nginx -s reload` after `--force-recreate`** — recreate changes the container IP and nginx 502s until reloaded |
| 0.7 | ✅ **Is the production app in Easy Mode?** | Salla Partners portal → app → OAuth Mode | **Answered 2026-08-20: YES.** See the resolved note below. Portal state must be read by a human — Turnstile blocks chrome-devtools MCP; use the Claude-in-Chrome extension |

### ✅ 0.7 — RESOLVED 2026-08-20: Easy Mode confirmed, dead end confirmed, now guarded

Portal read (app `665811310`, founder's Claude-in-Chrome extension): **OAuth Mode = Easy Mode**,
selected. So the hypothesis below was correct — in Easy Mode Salla drops the registered redirect
URIs and `accounts.salla.sa/oauth2/auth` fails before any login screen (D-031, proven 2026-07-18),
while `connectStore` returned the App Store listing URL **only** when `SALLA_EASY_MODE_CLAIM_ENABLED`
**and** `SALLA_APP_STORE_URL` were both set — and neither is. The `/integrations` Salla card kept its
Connect button live under the "coming soon" badge, so the button led to a Salla error page.

**Blast radius, measured before acting** (7 days of nginx logs, the retained window):

| Path | Requests in 7d |
|---|---|
| `POST /api/salla/store/connect` | **0** |
| `/salla/auth` | **0** |
| `GET /api/salla/store` (page-load status poll) | many — the integrations page, not a connect attempt |

**Nobody had walked through the open door.** Recording the number matters more than the fix: the
same finding with a non-zero count would have been an incident with merchants to contact.

**Guard shipped** (same PR as the runbook correction): `POST /salla/store/connect` answers **409
`SALLA_CONNECT_UNAVAILABLE`** unless `SALLA_OAUTH_CONNECT_ENABLED=true` (Custom-Mode dev opt-in), and
the card renders no Connect button (`connectEnabled: false` in `integrations.tsx`). Pinned by
`backend/test/controllers/salla.test.ts` and `frontend/src/__tests__/pages/sallaConnectDisabled.test.ts`.

⛔ **Both are temporary.** When the listing is published: set `SALLA_APP_STORE_URL`, remove
`connectEnabled: false`, delete the frontend spec. Leaving the guard in place after publishing would
hide the connect action from the merchants the listing is meant to bring.

> Colour suffix alternates per deploy (`-blue` / `-green`). Read it from `docker ps`, don't assume.

---

## Tier 1 — Automated (must be green before any deploy)

Run from `backend/` unless noted. These are the same suites `scripts/pre-deploy-check.sh` runs.

| # | Suite | What it proves | Count |
|---|-------|----------------|-------|
| 1 | `test/services/salla.test.ts` | token exchange, store info, **order lookup + shipment tracking**, phone composition | 60 |
| 2 | `test/controllers/salla.test.ts` | authorize/callback, webhooks, pending-install staging, claim, order-event shaping | 74 |
| 3 | `test/controllers/auth.salla-claim.test.ts` | owner-email match binding (D-031) | 8 |
| 4 | `test/routes/salla.test.ts` | route wiring / flag-gated 404s | 1 |
| 5 | `test/integrations/salla.test.ts` | REST adapter field mapping | 17 |
| 6 | `test/services/ecommercePendingInstallTokens.test.ts` | pending-install token encrypt/stage/expire | 19 |
| | **Ring 1 subtotal** | | **179** |
| 7 | `ecommerce*` (12 suites: crypto, token health/refresh, actions, tool-loop, RAG, webhooks, analytics ×2, routes, comment-processor, shopify-refactor) | the machinery Salla rides on | 193 |
| 8 | `test/middleware/auth*.test.ts` | CSRF Bearer-skip / cookie-priority split (shared infra) | 30 |
| | **Ring 2+3 subtotal** | | **223** |
| 9 | Integration `test/integration/ecommerce-sync.test.ts` | **live DB**: token at rest, claim/double-claim/expired/cross-account, catalog sync, webhook upsert/delete, safety cap | 19 |
| 10 | Full backend unit | no collateral damage | 6826 |
| 11 | Full backend integration | | 486 |
| 12 | `tsc --noEmit`, `npm run lint`, `npm run check:duplication` | compiles, 0 errors + 0 warnings, no new duplication | — |
| 13 | Salla i18n en/ar parity | `npm run translation:validate` from `frontend/` | parity |

```bash
# Ring 1 (fast loop while working on Salla)
npx vitest run test/services/salla.test.ts test/controllers/salla.test.ts \
  test/controllers/auth.salla-claim.test.ts test/routes/salla.test.ts \
  test/integrations/salla.test.ts test/services/ecommercePendingInstallTokens.test.ts

# Rings 2+3
npx vitest run ecommerce commentProcessor.ecommerce middleware/auth

# Integration (per-checkout test DB; see AI_INSTRUCTIONS)
npm run test:integration:local
```

### ⚠️ Fixture rule — learned the hard way (2026-08-17, PR #798)

Order-detail fixtures **must not** contain a `shipments` key. Salla serves order detail in
**light** format to every app created after 15 Aug 2024 (ours: 2026-02-25); light omits
`shipments`, `items`, pickup branch and customer groups. The old fixtures inlined a
`shipments` array — a response we can never receive — so the suite passed while production
returned blank tracking for every merchant. **A fixture that cannot occur in production is
worse than no fixture: it certifies the bug.** When adding a Salla test, ask what the live
payload actually contains before writing the mock.

Mutation-check any new regression test (break the fix, watch that test and only that test
fail). PR #798 was mutation-checked ×5.

---

## Tier 2 — Live browser QA (both locales)

Driven in real Chrome via the chrome-devtools MCP (`/qa` loop): console + network watched
after every action, `/en` and `/ar` each.

| Page | Precondition | Checks |
|------|--------------|--------|
| `/salla/onboarding` | logged in; Salla store connected | store fetch → product sync → page-link steps render; no console errors; 2xx; RTL correct in `/ar`; no raw i18n keys |
| `/salla/connected?merchant=<id>` | logged in; claim flag ON | phase machine `missing` / `needLogin` / `checking` → `found`/`notFound`; claim binds; error states render |

Cold-load specifically — that is how Salla opens the Easy-Mode App URL, and it is the exact
condition that exposed the hydration race below.

---

## Tier 3 — On-approval live rehearsal ⛔ THE GATE BEFORE PUBLISHING

Requires a **real Salla store** and a **real order**. Nothing here is simulable; every row
has cost production defects before. Run in order — later rows depend on earlier state.

| # | Step | Pass criteria | On failure |
|---|------|---------------|------------|
| 3.1 | Install the app onto a real store from the listing | `app.store.authorize` webhook 200; pending install staged with encrypted token + `token_expires_at` ≈14 days | check webhook secret + `printenv`; do not publish |
| 3.2 | Claim it | sign in as the account whose email matches the store's registered email → binds; wrong account → 403 `email_mismatch` | `SALLA_EASY_MODE_CLAIM_ENABLED` off is the usual cause |
| 3.3 | Catalog sync | products land; count matches the store; `product_summary` populated | |
| 3.4 | Test reply quoting a real product | correct name **and price** from the live catalog | |
| 3.5 | `order.created` | **exactly one** customer SMS (dedup holds) | duplicate ⇒ stop; dedup key regression |
| 3.6 | `order.status.updated` → `shipped` | shipped SMS held for the grace window, then sent | |
| 3.7 | `order.shipment.created` | tracking upgraded **in place** — still exactly one SMS total, now carrying the tracking number | two SMS ⇒ `upgradePendingOnDuplicate` regression |
| 3.8 | **`track_shipment` on a real shipped order** — NEW, never yet run live | `GET /admin/v2/shipments?order_id=…` returns **200, not 403**; envelope is `{data:[…]}`; the reply carries tracking number + courier + link | 403 ⇒ Tier 0.4 (scope not ticked). 200 but empty/odd shape ⇒ the doc-derived assumption in PR #798 was wrong — fix before publishing |
| 3.9 | `app.uninstalled` | store row deactivates; no further webhook processing | |
| 3.10 | Sentry + health | quiet; `scripts/health-check.sh` green | |

**3.8 is the highest-value row in this document.** The tracking fix (PR #798) was built from
Salla's published documentation and has **never touched a live Salla API**. Response
envelope, exact scope spelling, and whether an approved app can add a scope without
re-review are all unconfirmed. It fails safe (degrades to status-only, i.e. the old
behaviour), so it cannot regress — but "cannot regress" is not "works". This row is what
turns it into "works".

> Ask Salla support whether adding `shipping.read` to an **approved** app requires
> re-review. Cheaper to ask than to discover after publishing.

---

## Tier 4 — Load & soak

### ⛔ Do NOT load-test Salla's API

Hammering a partner's production endpoints — especially days after approval — risks
throttling or being flagged at exactly the wrong moment, and measures *their*
infrastructure, not ours. There is nothing to learn that their published rate limits don't
already tell us. This is a standing rule, not a one-off caution.

### What to load-test instead — our own side

| Scenario | Method | Watch for |
|----------|--------|-----------|
| Large catalog sync | seed a store at `PRODUCT_SAFETY_CAP`; run `syncProducts` | pagination stops at the cap; memory flat; `MAX_PAGES_TO_FETCH` respected; no partial-write |
| Webhook burst | replay a batch of signed order webhooks at the endpoint | HMAC verified per request; queue drains; no dropped events; dedup holds under concurrency |
| Token refresh race | two workers, one store near expiry | distributed lock holds — refresh tokens are **single-use**, a race burns the store's token |
| Agent tool latency | `lookup_order` / `track_shipment` end to end | order detail + shipments run in `Promise.all`, not sequentially (§17.3); no added round trip |
| Many stores | N stores on the 6h refresh cadence | cadence doesn't stampede; Easy-Mode stores skipped when `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true` |

---

## Results — 2026-07-19 run (branch `feat/salla-easy-mode-claim-binding` @ `dc61723b`)

### Tier 1 — **ALL GREEN**

| Suite | Result |
|-------|--------|
| Salla unit (service, controller, auth-claim, routes, adapter, pending-install-tokens) | ✅ 170/170 *(now 179 — PR #798 added 9)* |
| E-commerce machinery | ✅ 148/148 *(now 193)* |
| Auth/CSRF middleware (shared infra) | ✅ 24/24 *(now 30)* |
| Integration `ecommerce-sync` (live DB) | ✅ 19/19 |
| Backend `tsc --noEmit` | ✅ 0 errors |
| Lint (salla + auth) | ✅ 0/0 |
| Salla i18n en/ar parity | ✅ 71/71 |
| Frontend page tests | ✅ 60/60 |

### Tier 2 — **PASS, 2 defects found & fixed**

- `/en/salla/onboarding` happy path — `GET /salla/store` 200 → `POST /salla/store/sync` 200 → "20 products synced". Clean.
- `/en/salla/connected` — `missing` and `error` states render correctly; no crash/blank.
- `/ar/salla/connected` — `dir=rtl`, real Arabic, no raw i18n keys.

**Defect 1 — auth hydration race (both Salla pages).** Pages decided auth off raw
`isAuthenticated`, `false` on first paint until the persisted store rehydrates. On a cold
load — exactly how Salla opens the Easy-Mode App URL — `/salla/onboarding` bounced a
logged-in merchant to `/login`→`/dashboard`. **Fixed** by gating on `_hasHydrated`
(AI_INSTRUCTIONS §12). Regression: `src/pages/salla/connected.test.tsx` (4 cases).

**Defect 2 — Arabic brand rendering.** `ar/salla.json` mixed Latin "Salla" (7×) with "سلة"
(15×); AR corpus convention is "سلة" (135 vs 9). **Fixed** → all "سلة".

### 2026-08-17 — PR #798 (tracking fix)

Tier 1 re-run on the change: backend unit **6826 passed / 6 skipped**, integration **486
passed / 6 skipped**, `tsc` clean, lint 0/0, `check:duplication` no new findings, 5
mutations each failing exactly their own test. Tier 0 preflight **FAILED** (prod four
commits behind, three env vars absent) — recorded above as the reason Tier 0 exists.

---

## Known non-blockers (logged, out of Salla scope)

- Dashboard `GET /analytics/ai-usage?days=30` → 500 (×3) and `GET /subscription/usage` → 404 on local dev.
- Local-dev `/sse/events` CORS errors from `:3001` — dev-env config.
- `abandoned.cart` event string still unconfirmed by a real delivery (`SALLA_LAUNCH_VALIDATION.md`).
  `order.shipment.created` is now exercised by Tier 3.7.
