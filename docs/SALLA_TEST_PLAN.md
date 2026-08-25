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
| 0.3 | Prod app creds are the **production** app | same `printenv` | ✅ **PASSING since 2026-08-20** — Client ID, Client Secret and webhook token repointed together; in-container `SALLA_CLIENT_ID` matches `c18dcc…8f4d`, `SALLA_HOST_NAME=jawab24.com`. Rule stands for future checks: the id must MATCH app `665811310` — ⛔ *not* merely differ from Jawab24-Dev `1565152053`. "Not the dev app" is what let a third, phantom app survive 07-31→08-20 |
| 0.4 | `shipping.read` granted | Salla Partners portal → app → scopes | ticked. ⛔ Without it `track_shipment` returns status with no tracking (403 → degrade). Config alone does **not** grant it — Easy Mode never calls `buildAuthUrl` |
| 0.5 | Article-5 Stripe guard live (D-065) | `docker exec jawab24-backend-<colour> sh -c "ls /app/backend/dist/config/sallaBilling.js"` | file present |
| 0.6 | Container healthy after any recreate | `docker ps` + `scripts/health-check.sh` | all healthy; **`nginx -s reload` after `--force-recreate`** — recreate changes the container IP and nginx 502s until reloaded |
| 0.8 | **Webhook Security Strategy = Signature** | Salla Partners portal → app → Webhooks/Notifications | radio **Signature** selected. ⛔ *Token* makes Salla send `Authorization: <secret>` with **no** `X-Salla-Signature`, and `controllers/salla.ts` verifies the signature only ⇒ **every delivery 401s** regardless of the secret. This is what the first real install hit on 2026-08-23; the secret itself was correct. ✅ Set 2026-08-23 (flip persists across reload; the secret is not regenerated) |
| 0.9 | **API-registered subscriptions are SIGNED** | `GET https://api.salla.dev/admin/v2/webhooks` with the store token (or from the merchant dashboard's own session) | every row for `https://jawab24.com/salla/webhooks` shows `security.strategy = "signature"` and a non-null secret. ⛔ `strategy: ""` / `secret: null` ⇒ Salla delivers WITHOUT `X-Salla-Signature` and every order/product event 401s — the state all ten demo-store subscriptions were in on 2026-08-23 (registered by the pre-fix `registerWebhooks`, which sent `{name, event, url}` only). Fix = the store's *Re-register* button or `node dist/scripts/reregister-webhooks.js salla` in the backend container on a build that carries the signed upsert; a plain re-subscribe 422s and changes nothing. ⚠️ The first live run of that repair (2026-08-23, 17:47Z) failed 10/10 with `422 «حقل event غير صالح»`: the live `PUT /webhooks/{id}` REQUIRES `event` in the body even though docs.salla.dev's Update Webhook page omits it (measured on the demo store — the same body with `event` → 200). Fixed in `registerWebhooks`; re-run the repair on a build that carries it |
| 0.7 | ✅ **Is the production app in Easy Mode?** | Salla Partners portal → app → OAuth Mode | **Answered 2026-08-20: YES.** See the resolved note below. Portal state must be read by a human — Turnstile blocks chrome-devtools MCP; use the Claude-in-Chrome extension |
| 0.10 | **Portal Store Events list contains the 4 order events** | Salla Partners portal → app → Webhooks/Notifications → Store Events | «Added Events» = 4, matching the list in `services/salla.ts` (`order.created`, `order.updated`, `order.status.updated`, `order.shipment.created`). ⛔ An EMPTY portal list makes `POST /admin/v2/webhooks` answer `422 {"event":["The event type is disabled"]}` for exactly those events — Salla began enforcing this mid-day 2026-08-23 (registrations at 07:12Z that morning still worked), and the 422 reads like a platform refusal when the cause is our portal config. Delivery for these events then comes via the app-level channel, NOT the API-registered per-store subscription — see the 2026-08-24 results for the consequence (`webhookStatus.failed` + noisy `[WebhookRetry]`) |

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

⚠️ **Correction to an earlier draft of this section:** it said merchants clicking "Connect Salla"
were landing on a Salla error page. They were not — `/integrations` is **admin-only** today
(`isAuthenticated && !isAdmin → /dashboard`), so only we could reach the card. The dead end was real
but ours, and it would have become merchant-facing the moment the page opened up.

**Guard shipped** (same PR as the runbook correction). One predicate,
`controllers/salla.ts:isConnectAvailable`, answers for every entry point — `POST /store/connect`
(**404**, matching the sibling flag-gated claim routes rather than a 409 that implies a state
conflict), the PUBLIC `GET /salla/auth` redirect that the UI's *reconnect* action targets, and
`GET /salla/capabilities`, which is what the page renders its buttons from. Pinned by
`backend/test/controllers/salla.test.ts`, `backend/test/routes/ecommerceRoutes.test.ts` and
`frontend/src/__tests__/pages/connectAvailability.test.ts`.

⛔ **The guard lifts by CONFIGURATION, not by a code change.** Publish the listing, set
`SALLA_APP_STORE_URL`, and the predicate answers true — endpoints open, buttons return. Nothing to
revert, nothing to forget.

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

> ### ⭐ You do not need a NEW purchase to reach 3.6–3.8 — an EXISTING order is enough
>
> Proven on Zid 2026-08-23 (ZID_TEST_PLAN.md §E-2/E-3): **`order.status.updated` is a
> subscribed webhook in its own right**, so changing an existing order's status in the
> store admin fires a real delivery through the whole ingestion path — signature check,
> envelope parse, phone normalize, template render, `customer_notifications_log` row.
> Nothing is faked; the only thing skipped is the act of buying.
>
> This matters because a storefront checkout is the step most likely to block you: on Zid
> it died on a Cloudflare managed challenge, and the standing advice is never to drive or
> disguise such a challenge. If the demo store already carries orders (Zid's shipped with
> five seeded ones), you can start here instead of waiting on someone to place one.
>
> | Row | Reachable from an existing order? |
> |---|---|
> | 3.5 `order.created` | ✅ **Yes — from a CONFIRMED admin order** (corrected 2026-08-25). The wizard's full recipe + the *Confirm new order* dialog fires it; an unconfirmed Draft fires nothing (that was the whole 08-24 "counter-observation"). A storefront checkout also works but is not required. |
> | 3.6 `order.status.updated` → shipped | ✅ Flip the order to *shipped* in the admin. |
> | 3.7 `order.shipment.created` | ❌ **Not on a demo store** (measured 2026-08-25). The label flow auto-creates the shipment WITH the order and only flips its status afterwards — the portal Webhooks Log shows ZERO `order.shipment.created` deliveries ever for this store. And Dev Company assigns no tracking number. See the 2026-08-25 results. |
> | 3.8 `track_shipment` live | ✅ Once a shipped order carries a shipment (the label flow's auto-created one is enough — 3.8 passed against it). |
>
> ⚠️ Run 3.6 → 3.7 in that order on the SAME order — 3.7's whole point is that it upgrades
> 3.6's still-pending row in place rather than sending a second SMS, so flipping the status
> after creating the shipment tests nothing. Note the window is real: the grace is 5 minutes
> from the 3.6 flip, and the dedup key gives each order exactly ONE `order_shipped` row ever —
> once the row leaves `pending`, that order is burned for 3.7 (measured live 2026-08-25).
>
> **Verify at the read path**, not at the webhook: `GET /api/notification-log/<storeId>`
> and `…/stats` with the merchant's own session. Record the row in the captures file the
> same way Zid's §E rows are recorded.
>
> ⚠️ **SMS delivery is a separate question from ingestion.** On Zid both rows landed
> correctly and then failed to send with `Vonage delivery error: Quota Exceeded - rejected`
> (an account problem, not an integration one). A `failed` row still proves 3.6/3.7's
> webhook and dedup behaviour; only the "SMS arrives" half of the pass criteria is blocked.

>  ⚠️ **On the Salla DEMO store, measured 2026-08-23: the admin paths DO fire — and were all refused by us.**
> First reading was wrong on two counts, both corrected the same day. (1) The storefront
> refuses checkout («لا يمكنك انهاء الطلب من متجر المعاينة»), but the admin *New order* works
> once the draft is completed: set **Shipping & delivery** with a full National Address (a
> courier — *Dev Company* — then appears), then **Payment → Fully paid → Cash on delivery**
> with a non-zero fee, then *Create order* → a **"Confirm new order"** dialog; only that dialog
> turns the Draft into a real order. The earlier «Draft / nothing fired» and «status flip did
> not apply» readings were incomplete forms and a sidebar filter click, not platform limits.
> (2) The resulting `order.created` (and the 13:26 `order.status.updated`) DID reach
> `POST /salla/webhooks` — and got **401**, because the API-registered subscriptions were
> unsigned (Tier 0.9). The portal Webhooks Log shows the same events for the old
> `Jawab24-Dev` app too (dead ngrok URL → 404); that app still holds subscriptions on the
> demo store and should be uninstalled from it.
>
> ~~⚠️ 2026-08-24 counter-observation: not every admin New-order path fires.~~
> **RESOLVED 2026-08-25 — the counter-observation was a misread: order `#279682567` was
> still a DRAFT.** The 08-24 wizard run (Store pickup, Unpaid/COD) never went through the
> *Confirm new order* dialog, so no real order existed and nothing could fire — the orders
> list plainly labelled it «Draft». Completing that same draft on 08-25 (Shipping &
> delivery + National Address + Dev Company + COD fee > 0 → *Create order* → **Confirm**)
> fired `order.created` within seconds (200 in the portal Webhooks Log). So the rule is
> NOT "store pickup doesn't fire" — it is **"a Draft fires nothing; the Confirm dialog is
> what creates the order"** (already stated in the 08-23 note above, forgotten in the
> 08-24 run). A storefront checkout is no longer needed to close 3.5.


| # | Step | Pass criteria | On failure |
|---|------|---------------|------------|
| 3.1 | Install the app onto a real store from the listing | `app.store.authorize` webhook 200; pending install staged with encrypted token + `token_expires_at` ≈14 days | **401 on every delivery ⇒ Tier 0.8 first** (strategy ≠ Signature — the 2026-08-23 failure), then *Reauthorize App* in the store admin re-fires the push; only then suspect the secret + `printenv`; do not publish |
| 3.2 | Claim it | **live store:** sign in as the account whose email matches the store's registered email → binds; wrong account → 403 `email_mismatch`. **demo/development store (D-093):** binds for any signed-in account that has an email — its `@email.partners` address can never match | `SALLA_EASY_MODE_CLAIM_ENABLED` off is the usual cause; 403 on a demo store ⇒ prod predates D-093 |
| 3.3 | Catalog sync | products land; count matches the store; `product_summary` populated | |
| 3.4 | Test reply quoting a real product | correct name **and price** from the live catalog | |
| 3.5 | `order.created` — ✅ PASSED live 2026-08-25 (confirmed admin order; see results) | **exactly one** customer SMS (dedup holds) | duplicate ⇒ stop; dedup key regression. Zero rows ⇒ check the order is not still a **Draft** (the Confirm dialog creates it) before suspecting anything else |
| 3.6 | `order.status.updated` → `shipped` — ✅ PASSED live 2026-08-24 and again 2026-08-25 (grace window observed end-to-end) | shipped SMS held for the grace window, then sent | |
| 3.7 | `order.shipment.created` — ⚠️ NOT closable live on the demo store (see 2026-08-25 results): the event is never emitted for label-flow shipments and Dev Company assigns no tracking number. Upgrade-in-place with tracking is pinned by `test/integration/customerNotificationsDedup.test.ts` ("a tracking-bearing shipment upgrades an earlier tracking-less shipped row in place") and the shipment-shaped payload parse by `test/controllers/salla.test.ts`; the live full pass needs a real store with a real courier, post-launch | tracking upgraded **in place** — still exactly one SMS total, now carrying the tracking number | two SMS ⇒ `upgradePendingOnDuplicate` regression |
| 3.8 | **`track_shipment` on a real shipped order** — ✅ PASSED live 2026-08-24 (see results) | `GET /admin/v2/shipments?order_id=…` returns **200, not 403**; envelope is `{data:[…]}`; the reply carries tracking number + courier + link. **Prove the shipments call was actually made** before reading anything into a silent Sentry: after the 2026-08-23 fix the verify step reads the shipment live whenever the model's Phase-1 tool was `lookup_order`, so `metrics:ecom:verify:sibling` or `…:live` > 0 in prod Redis is the evidence the endpoint was hit. Then read the OUTCOME off the pair that follows: `…:requested_empty` = the call returned 200 with no shipment (the order is not shipped yet — pick a shipped order and re-run), `…:requested_live_failed` = it threw, which is where a 403 lands. ⛔ Do not read one for the other; they were one counter in the first draft of D-096 and that conflation would have answered 3.8 "platform failure" on a perfectly healthy 200 | 403 ⇒ Tier 0.4 (scope not ticked). 200 but empty/odd shape ⇒ the doc-derived assumption in PR #798 was wrong — fix before publishing. ⛔ 2026-08-23: "no `Salla shipments lookup failed` in Sentry" was misread as 200 when the model had never called `track_shipment` (0 calls) — silence is not a result |
| 3.9 | `app.uninstalled` | store row deactivates; no further webhook processing | |
| 3.10 | Sentry + health | quiet; `scripts/health-check.sh` green | |

**3.8 is the highest-value row in this document — closed 2026-08-24.** The tracking fix
(PR #798) was built from Salla's published documentation without ever touching a live
Salla API; the live run confirmed the response envelope and that `shipping.read` returns
200 (see the 2026-08-24 results). Still unconfirmed: whether an approved app can add a
scope without re-review.

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

## Results — 2026-08-25 (production app `665811310`, demo store `2108580704`, prod `57b32665`)

All on order `#279682567` (internal id `1234088610`) — the 08-24 "counter-observation"
order, which turned out to still be a **Draft**. Completed and confirmed it live via
chrome-real; every timestamp below is UTC and was verified at the read path
(`customer_notifications_log`) plus the portal Webhooks Log.

- **3.5 ✅ PASS — and the 08-24 counter-observation is retracted.** The draft was
  completed with the full recipe (Shipping & delivery + National Address `TAAD2235` +
  Dev Company + COD fee 5 > 0) → *Create order* → **Confirm new order** dialog at
  04:43Z → `order.created` delivered (200 in the portal Webhooks Log, 07:43:56 local)
  → **exactly one** `order_confirmed` row at 04:43:56 (dedup holds; lifecycle
  `pending → failed «Vonage Quota Exceeded»` — the known #3002710 provider issue, not
  ingestion). Conclusion: the admin wizard DOES fire `order.created`; a **Draft fires
  nothing**. A storefront checkout is not required for 3.5.
- **3.6 ✅ PASS (second full-chain run), grace window observed live end-to-end.** Flip
  to «تم الشحن» at 04:45Z → `order.status.updated` 200 → exactly one `order_shipped`
  row, `pending`, `created_at 04:45:19`, `scheduled_at 04:50:19` — the 5-minute
  `SHIPPED_NO_TRACKING_GRACE_MS` to the second. No shipment event arrived during the
  grace, so after it the row went to send (→ `failed`, Vonage only). Still exactly one
  row afterwards. This is the designed no-tracking fallback proven live for the first
  time.
- **3.7 ⚠️ NOT closable live on a demo store — structural, measured, documented:**
  1. **`order.shipment.created` has NEVER been delivered for this store** — the portal
     Webhooks Log (all 22 events since install) contains zero such entries, across both
     the 08-23 storefront-style order and today's. The label flow auto-creates the
     shipment WITH the order (`Shipment status: Pending` visible before any label
     action) and «Create shipping label» merely flips it to `Shipped` — a status change,
     not a creation, so no create event exists to deliver.
  2. **Dev Company assigns no tracking number** (same as #279531515, re-verified), and
     per Salla's docs `tracking_number` is courier-assigned at create; a merchant can
     only SET it afterwards via `PUT /admin/v2/shipments/{id}` — which would fire a
     shipment **update** event we do not subscribe to.
  3. The earlier plan "add a tracking number to #279531515's shipment" was therefore
     doubly impossible: that order's notification row is long past `pending` (the
     upgrade only touches pending rows, and the dedup key allows one row per order
     ever), and no subscribed event would fire anyway.
  What 3.7 exists to verify (one SMS total, upgraded in place with tracking) stays
  pinned by `test/integration/customerNotificationsDedup.test.ts` and
  `test/controllers/salla.test.ts`; the live pass is deferred to the first real store
  with a real courier. The row is NOT waived — it moves to post-launch.
- **Wizard traps found this run** (add to the 08-23/08-24 recipe): «New order» RESUMES
  an existing draft rather than starting fresh (adding a product bumped the draft's
  quantity); the address form cascade **Region → City → Neighborhood resets its
  children** when a parent changes — re-pick City and Neighborhood after setting
  Region; the **National Address search box requires CLICKING the suggestion** — typed
  text alone fails Save with «الكود الجغرافي للشحن مطلوب», and picking the suggestion
  overwrites street/postal with the code's registered address (TAAD2235 resolves to
  Taif, not Riyadh — Dev Company appeared regardless).

## Results — 2026-08-24 (production app `665811310`, demo store `2108580704`, prod `e53e89f5`)

- **The order-events 422 was OURS, not Salla's.** `POST /admin/v2/webhooks` answering
  `422 {"event":["The event type is disabled"]}` for all four `order.*` events (and the
  events catalog listing 61 events with zero `order.*`) was caused by the app's portal
  **Webhooks/Notifications → Store Events** list being EMPTY. Fix: portal → app
  `665811310` → Store Events → tick exactly the 4 events the code registers → Save
  («Added Events 4»). Now Tier 0.10. A support email blaming Salla's 08-23 incident was
  drafted and **discarded after checking the docs first** — the falsifying check before
  the outbound message.
- **3.6 ✅ FULL-CHAIN PASS.** With the portal events added, status flips on order
  `#279531515` fired webhooks within seconds. Flip to «تم الشحن» → exactly one
  `customer_notifications_log` row (`order_shipped / 279531515`, `+971555555555`,
  «abc def»), lifecycle `pending` (5-min tracking grace) → `failed «Vonage delivery
  error: Quota Exceeded - rejected»`. Ingestion, signature check, dedup, template render
  and the grace window all correct — only the SMS provider fails (known Vonage account
  verification issue, ticket #3002710; not Salla, not code).
- ⭐ Each event arrived **TWICE**: once signed (`x-salla-signature` → 200, processed) and
  once as an unsigned duplicate (→ 401, dropped — harmless, dedup never even reached).
  **Attributed (2026-08-24, follow-up fix)**: the duplicates come from the store's
  pre-enforcement per-store `order.*` subscriptions — unsigned, and unrepairable because
  the PUT answers the same 422. The `webhookStatus.failed:4` on the store row proved
  they exist: only the update path (an existing row) records that failure; a plain
  subscribe-422 is tolerated.
- ✅ **RESOLVED (same-day fix PR): `order.*` are now PORTAL-managed in code.**
  `registerWebhooks` upserts only `SALLA_API_WEBHOOK_EVENTS` (products,
  `app.uninstalled`, `abandoned.cart`) and DELETES our leftover per-store `order.*`
  subscriptions — ending both the noisy `[WebhookRetry]` exhaustion loop (with its
  permanent merchant-facing "Re-register webhooks" CTA) and the unsigned 401
  duplicates. After the deploy, press *Re-register* on the store once (or run
  `reregister-webhooks.js salla`) so the cleanup pass runs and `webhookStatus`
  self-heals to `ok`.
- **3.8 ✅ PASS — the highest-value row, closed.** Two-turn playground conversation
  (same production pipeline, page `eb06462a…`) against shipped order `#279531515`:
  turn 1 «وين وصل طلبي رقم 279531515؟» → model called `lookup_order`, asked the identity
  question; turn 2 phone answer → `verify_and_get_shipment` → **success**, reply
  «طلبك رقم 279531515 تم شحنه بالفعل مع شركة Dev Company» in 3.3 s. Prod Redis proof,
  read as the 3.8 row demands: `metrics:ecom:verify:sibling` 1→2 (Phase-2 verified
  against the parked order blob, then read the shipment LIVE), `verify_and_get_shipment:success`
  5→6, and **neither** `requested_empty` **nor** `requested_live_failed` appeared — by
  the code's own branching that is proof `GET /admin/v2/shipments?order_id=…` returned
  **200** with a parseable `{data:[…]}` envelope containing a shipment. The
  200-vs-403 question on `shipping.read` is answered: 200. `verification_expired`
  stayed at 4 — the D-096 fix holds live. The reply carries the courier but **no
  tracking number/link because the demo shipment has none** (verified in the Salla
  admin order view: shipping details show only «Dev Company», no tracking field) —
  the adapter's tracking-number preference had nothing to prefer. PR #798's
  doc-derived envelope assumption is confirmed against the live API.
- ~~**3.5 still open** — needs one real storefront checkout~~ **SUPERSEDED 2026-08-25:
  3.5 passed from the admin wizard once the Draft was actually confirmed** — the
  "store-pickup wizard path fires nothing" reading was wrong; the order had never left
  Draft. See the 2026-08-25 results.
- **Stale app `Jawab24-Dev` (1565152053) defused.** Its webhook URL is a bare 64-hex
  string (not a URL) yet it had 10 Store Events subscribed → every delivery 404'd →
  portal Webhooks Log health read **Failure 47.4%**, visible to a reviewer. All 10
  events removed 04:10Z (verified after full reload; no new 404s). Historical rows
  clear only as the log window rolls; full app DELETE is the only purge — irreversible,
  owner's call, recommended, not done. ⛔ Never press «Retry» on its old log rows.
- **Public→Private conversion: NOT possible in the portal** (checked 2026-08-24 for the
  private-app distribution route). App details shows `Type: Public` as static text;
  «Edit App» exposes only name/website/support-email/description. The type is fixed at
  creation ⇒ the private route means a **new app** + repointing creds
  (client id/secret/webhook secret in `env/backend.env`, `--force-recreate`, nginx
  reload — same procedure as the 08-20 repoint) + re-adding the Store Events list
  (Tier 0.10) on the new app.

## Results — 2026-08-23 (production app `665811310`, demo store `2108580704`)

- **Tier 0**: 0.1–0.7 carried from 2026-08-20; **0.8 FAILED then FIXED** (Token → Signature).
- **3.1 ✅ PASS** after the fix — install from the portal's *App Testing* link; `app.installed`
  + `app.store.authorize` both `200` (portal Webhooks Log 100%); `pending_ecommerce_installs`
  row staged with encrypted access + refresh tokens, `token_expires_at` = +14 d, scopes incl.
  `shipping.read`. Before the fix: 4 × `401` (two events, one retry each); a demo-store "You are
  not authorized for this request" flash on the install redirect is cosmetic.
- **3.2 — blocked by D-031 on a demo store, then unblocked by D-093** (same day): no Jawab24
  account can carry the demo store's synthetic `@email.partners` address (no password login;
  Facebook login rewrites `users.email` each sign-in; demo-store settings 404), and a Development
  app installs on demo stores only, so the email proof now applies to `store/info.type = live`
  stores only. ⏭ Re-run 3.2 after the deploy that carries D-093; the pass criterion for a demo
  store is "binds for any signed-in account with an email"; the `email_mismatch` branch is still
  the expectation for a `live` store.
- **3.2 ✅ PASS** after the D-093 deploy (08:18 UTC) — the review account bound the demo store;
  **3.3 ✅** 20 products, 11 webhooks registered, `failed: []`; **3.4 ✅** the reply quoted the
  in-stock «تنورة» range 79–114 SAR and excluded the sold-out 124 SAR row, 2.1 s.
- **Templates were ALL OFF** on the store (the schema default) — switched `order_confirmed` +
  `order_shipped` ON at 10:14 UTC via the merchant API, verified in the DB. Without that step
  every later row would have produced zero log rows and read as a dedup pass.
- **3.5–3.7 🔴 reached Salla's side and were refused by OURS.** Admin order #279531515
  (`order_id 1622777182`, COD, Dev Company) created at 11:46 UTC → Salla delivered
  `order.created` to `/salla/webhooks` → **401**: the subscription was unsigned (Tier 0.9 —
  every API-registered subscription was `strategy: ""`, secret null, since the integration
  was built). Fix = signed list-then-upsert in `registerWebhooks`; after deploy, press
  *Re-register* on the store and re-fire by flipping #279531515 to «تم الشحن» and creating
  its shipment. The replay harness is now the fallback, not the path.
- **3.8 🔴 defect found instead of a result.** `test-reply` on the review page against
  #264861210: the model called `lookup_order` every time (`track_shipment` 0 calls) and then
  `verify_and_get_shipment` → `verification_expired` **4 of 4** — a customer who answers the
  identity question correctly was told «انتهت صلاحية التحقق». Root cause and fix: **D-096**
  (Phase 2 verifies against any family's blob or a live read). The 200-vs-403 question on
  `/admin/v2/shipments` is **still open**: the endpoint was never reached, so the silent
  Sentry proved nothing. ⏭ Re-run 3.8 after the D-096 deploy and read
  `metrics:ecom:verify:*` first.
- 3.9–3.10 not reached.

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
  `order.shipment.created` is likewise unconfirmed by a real delivery — the demo store's
  label flow never emits it (2026-08-25 results); first real-courier store will confirm both.
