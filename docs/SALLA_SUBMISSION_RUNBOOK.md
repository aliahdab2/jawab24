# Salla App Store Submission Runbook

> Executable, in-order checklist for taking the Salla integration from "code done, dark" to
> live on the Salla App Store. Companion to `.planning/SALLA_LAUNCH_ACTIONS.md` (specs, portal
> recon, auto-responder text), `.planning/SALLA_LISTING_BRIEF.md` (listing copy),
> `docs/SALLA_TEST_PLAN.md` (what must be green and how to prove it), and
> `DECISIONS.md` D-012 (Easy-Mode claim binding).
> Created 2026-07-10, while both Salla and WhatsApp were staged dark
> (WhatsApp awaiting Meta App Review; Salla awaiting Partners ID verification).

## ⛔ STATUS 2026-08-20 — NEVER SUBMITTED. The app is a draft in Development.

**Correcting this runbook's own previous claim.** It said "APPROVED 2026-08-17 … Phase 2 ✅ DONE".
That was wrong. A direct read of the Partners portal (app `665811310`, 2026-08-20, via the
founder's Claude-in-Chrome extension) found:

| | State |
|---|---|
| App status | ❌ **`Status: Development`** — publish wizard is an **unsubmitted draft**; "Start publishing your App" still present, **no Withdraw option** |
| OAuth Mode | ✅ **Easy Mode** confirmed selected (`callback-type=inhouse`; no callback-URL field is rendered in this mode) |
| Listing content | ❌ ~85% empty — only App Name + EN short description. 0 of 3 required screenshots |
| `shipping.read` in the portal | ❌ not ticked at the morning read → **✅ ticked later 2026-08-20** (see update below) |
| Prod `SALLA_CLIENT_ID` | 🔴 wrong app at the morning read → **✅ repointed later 2026-08-20** (see update below) |
| Prod commit | ✅ `abd77ac7` — includes the tracking fix `4c6469a1` (#798); → `c740cc7f` later 2026-08-20 |
| Article-5 Stripe guard (D-065 / #695) | ✅ live in the running image |
| `SALLA_EASY_MODE_CLAIM_ENABLED` / `SALLA_SKIP_PULL_REFRESH_EASY_MODE` / `SALLA_APP_STORE_URL` | ❌ absent at the morning read → **✅ first two set later 2026-08-20**; `SALLA_APP_STORE_URL` post-publish by design |

### ✅ Update — 2026-08-20, later the same day: Phase 2.5 CLOSED

Every actionable row above was fixed the same day, and Tier 0 of `SALLA_TEST_PLAN.md` passed in full:

- ✅ **Prod repointed at app `665811310`** — Client ID, Client Secret **and** webhook token replaced
  together in `env/backend.env` (backup kept beside it), backend recreated, nginx reloaded.
  Verified inside the container: `SALLA_CLIENT_ID` matches the `c18dcc…8f4d` fingerprint.
- ✅ **`shipping.read` ticked in the portal** — saved scope set is exactly six entries (Basic RO
  locked, Orders R+W, Products R+W, Webhooks R+W, Settings RO, Shipping RO), confirmed after reload.
- ✅ **Both runtime flags set** — `SALLA_EASY_MODE_CLAIM_ENABLED=true`,
  `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true`; `GET /salla/store/pending` now answers 401 (auth)
  instead of 404 (dormant), proving the flag at the read path.
- ✅ Prod commit `c740cc7f` (= `origin/main` HEAD, carries #849's connect guard and `4c6469a1`).
- ⏭ `SALLA_APP_STORE_URL` remains unset **by design** — post-publish step.

**Remaining distance to submit:** the listing build (see `docs/store-listing/salla/PORTAL_FIELD_MAP.md`),
its remaining owner decisions (sub-category, support inbox, marketing sign-off — **countries decided
2026-08-20: SA · UAE · KW**), the reviewer account + demo store (Service Trial section), then the
Phase 3 rehearsal.

**What was actually approved on 2026-08-10 was the partner ID / payout verification, not an app
review.** Conflating the two is what put "APPROVED" in this file. Three consequences:

1. ⭐ **Scope changes are free right now.** Nothing is under review, so the old open question
   "ask Salla whether a scope change on an approved app needs re-review" is **MOOT**. Tick
   `shipping.read` today.
2. ⭐ **Drafting is safe.** The publish wizard has three distinct buttons — **Save Draft**, **Next**,
   **Submit for Review**. The entire listing can be built and saved without submitting anything.
   Only "Submit for Review" is irreversible (assume approval auto-publishes; no hold control was
   visible in the 06-12 recon, and that assumption has never been confirmed by Salla — ask support
   before submitting).
3. 🔴 **The wrong-app creds are the highest-severity item.** Prod is wired to a different app than
   the one being published, so the first real `app.store.authorize` push would arrive for an app
   whose secrets prod does not hold. Repoint Client ID **and** Client Secret **and** the webhook
   token together — fixing one and leaving another leaves the same failure.

### The Connect dead end — confirmed, now guarded

Easy Mode is confirmed, so `connectStore` had no working destination: the OAuth authorize URL 404s
for an Easy-Mode app (D-031) and `SALLA_APP_STORE_URL` cannot be set because **no listing exists to
point at**. The `/integrations` Salla card kept its Connect button live under the "coming soon"
badge, and the card's *reconnect* action pointed at the same dead redirect.

**Who could actually reach it — narrower than first reported.** `/integrations` is **admin-only**
today (`isAuthenticated && !isAdmin → /dashboard`, "while we finish public roll-out"), so no
merchant could see the card at all. An earlier draft of this section said merchants were hitting a
Salla error page; that was wrong. The exposure was ours, and it would have become a merchant-facing
dead end the moment the page opened up.

**Blast radius, measured before acting: ZERO** `/salla/store/connect` and `/salla/auth` requests in
7 days of nginx logs (only `GET /api/salla/store` status polls from the page).

**Guarded** in the same PR as this correction. One predicate, `controllers/salla.ts:isConnectAvailable`,
answers for every entry point:

| Entry point | Behaviour while unavailable |
|---|---|
| `POST /salla/store/connect` | **404 `SALLA_CONNECT_UNAVAILABLE`** (404, not 409 — nothing conflicts with resource state, and it matches the sibling flag-gated claim routes) |
| `GET /salla/auth` (PUBLIC; the UI's *reconnect* target) | redirected to `/integrations?salla_error=connect_unavailable` instead of Salla's error page |
| `GET /salla/capabilities` | `{ connectAvailable: false }` — the integrations page renders its connect **and** reconnect actions from this, so the UI cannot offer what the API refuses |

⛔ **All of it reverts by configuration, not by code:** set `SALLA_APP_STORE_URL` and the predicate
answers true, the endpoints open, and the buttons come back. `SALLA_OAUTH_CONNECT_ENABLED=true` does
the same for a Custom-Mode dev app.

Work Phase 2.5 below, then Phase 3. Do not skip Tier 0 of the test plan.

## How the switches work (read once)

| Switch | Type | Where | Applied by |
|---|---|---|---|
| `SALLA_EASY_MODE_CLAIM_ENABLED` | **Runtime** — `false`/unset = claim endpoints (`GET /salla/store/pending`, `POST /salla/store/claim`) return 404 (dormant); `true` = Easy-Mode installs claimable | `/var/www/jawab24/env/backend.env` | backend container recreate (no rebuild) |
| `SALLA_SKIP_PULL_REFRESH_EASY_MODE` | Runtime — `true` = 6h pull-refresh skips Easy-Mode stores (Salla pushes refreshed tokens via re-fired `app.store.authorize`; pulling would race the push) | same file | backend container recreate |
| `SALLA_CLIENT_ID` / `SALLA_CLIENT_SECRET` / `SALLA_WEBHOOK_SECRET` | Runtime — must match the **production** Salla Partners app (NOT Jawab24-Dev `1565152053`) | same file | backend container recreate |
| `SALLA_APP_STORE_URL` | Runtime — public listing URL (known at approval). With the claim flag on, `POST /salla/store/connect` redirects here instead of the OAuth authorize URL, which Salla 404s for Easy-Mode apps (no registered redirect_uri — 2026-07-18 dry-run, D-031) | same file | backend container recreate |
| Portal **Easy Mode** toggle | Salla Partners portal, per app | portal | — (published apps MUST use Easy Mode) |

Two apps exist on the Partners portal: **Jawab24-Dev** (`1565152053`, Custom Mode, dev-store
testing, ngrok callbacks) and the **production app `665811310`**. The dry-run happens on Dev; the
submission happens on the production app.

> 🔴 **Prod is wired to NEITHER of them.** The 2026-07-10 note "creds already in place, client id ≠
> dev app" was true and useless — *not the dev app* is not *the production app*. The 07-31 recon
> found the prod client id belongs to an app reachable under no account, and a fingerprint check on
> **2026-08-20** confirms it is still that way: prod's `SALLA_CLIENT_ID` contains neither `c18dcc`
> nor `8f4d`, the first/last fragments of `665811310`'s id. **Verify a credential against the app you
> intend to publish, never against the one you don't.**

## Phase 0 — Prerequisites (before submission day)

- [x] **Partners ID verification complete — ✅ APPROVED 2026-08-10** (5th request; the
      defect was the payout form's account number, not any certificate — Individual /
      non-Saudi path). ⛔ Never re-order a bank certificate or revisit Individual-vs-Company.
      Transferable lesson: when a rejection reason repeats byte-identically, **ask support
      which field fails** before ordering documents (support answered in ~29 min; each blind
      cycle cost ~1 week).
- [x] **Publish-timing strategy SETTLED (owner, 2026-07-18): no support email — accept
      auto-publish on approval.** Target is approval-in-hand without a *marketing* launch:
      submission = willingness to be listed; an unpromoted listing gets near-zero traffic
      (soft launch), and the public push stays a separate, later decision. Remember pulling
      a live app back is NOT self-serve (booked Salla meeting once merchants subscribe).
      The Phase 1 preconditions (WhatsApp canary, env flips incl. the claim flag ON) bind
      to **submission/review time**, not to the marketing push — reviewers see the
      listing's claims, and installs must be claimable the moment it's visible.
      (The §1 email draft in `SALLA_LAUNCH_ACTIONS.md` stays available if ever needed.)
- [x] **Easy-Mode dry-run on Jawab24-Dev DONE 2026-07-18** (founder via browser extension +
      local ngrok harness). Outcomes (recorded in **D-031**):
      1. **Authorize redirect is DEAD in Easy Mode** — Salla drops the registered redirect
         URIs (no callback field in the portal); `accounts.salla.sa/oauth2/auth` fails with
         `invalid_request … redirect_uri` before any login screen → D-012 = NO branch
         (owner-email match). Implication: the merchant-initiated OAuth connect flow is
         equally dead for the published app (see the `SALLA_APP_STORE_URL` switch above).
      2. **Token re-push works** — "Reauthorize App" in the store admin re-fires
         `app.store.authorize` with fresh tokens; ingestion verified live (pending install
         staged, expiry ~14 days). Automatic near-expiry cadence not observable in a 30-min
         session (docs say Salla re-fires on refresh) → still set
         `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true` on submission day.
      3. Webhook URL is retained portal-level in Easy Mode; the callback URL field is gone.
- [x] **Easy-Mode claim binding implemented (2026-07-18)** — owner-email match per D-031:
      claim finalizes only when the store's registered email (fetched live with the pushed
      token) equals the logged-in user's email; 403 `email_mismatch` / `no_email`,
      502 `store_info_unavailable` (remedy: Reauthorize App). Shipped dormant behind
      `SALLA_EASY_MODE_CLAIM_ENABLED`.
- [ ] **Marketing sign-off** on listing copy §1–2 (`.planning/SALLA_LISTING_BRIEF.md` — honesty
      pass done 2026-07-05; sales-rep frame per D-014, no transact verbs, no "AI agent").
- [ ] **Designer assets produced** (spec in `SALLA_LAUNCH_ACTIONS.md` §3):
      exactly **3 App Gallery images @ 1366×768**, exactly **3 Key Benefits images @ 1600×1600**
      (each with title + description), **icon 512×512** PNG/JPEG ≤1MB (symbol-only, margin),
      optional **YouTube link ≤2 min**. Include a WhatsApp screenshot — the copy claims it.
      **Usable drafts EXIST at `docs/store-listing/salla/`** (real AR app UI, verified specs,
      AR/EN benefit copy in `benefits.md`) — founder review pending; a designer pass is
      optional polish, not a blocker.
- [ ] **Support inbox live** + auto-responder pasted (`SALLA_LAUNCH_ACTIONS.md` §2;
      `jawab24.com/help` already live and linked).
- [ ] **CI green / deploys unblocked**: repo secrets `STRIPE_TEST_PUBLISHABLE_KEY` +
      `STRIPE_TEST_SECRET_KEY` restored (`gh secret set …`) so the pipeline + auto-deploy work
      on launch day (manual `scripts/deploy-production.sh` bypasses GitHub if needed).

## Phase 1 — Submission-day preconditions ⚠️ NEVER APPLIED — carried into Phase 2.5

> These were meant to be done *before* clicking submit. Submission happened without them, so
> they are now **pre-publish** preconditions instead. The env flips and the portal
> cross-check below are restated as executable steps in **Phase 2.5** — do them there, once,
> and use this section as the reference for *why* each one matters.

- [ ] **Confirm the WhatsApp canary is actually open** — the listing copy claims WhatsApp as
      shipped, so it must be genuinely available at review time (`docs/WHATSAPP_LAUNCH_RUNBOOK.md`
      Phase 5: clear `WHATSAPP_ALLOWLIST`, remove `NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY`, keep
      `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`, rebuild). WhatsApp went GA 2026-07-26, so this is expected
      to be done — but ⚠️ **`NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY` still exists in the code**
      (`frontend/src/lib/featureFlags.ts`) and a `NEXT_PUBLIC_*` value cannot be read from the
      server env — it is baked at build time. **Verify at the read path**: open the dashboard as a
      NON-admin account in production and confirm the WhatsApp entry point is visible. Do not mark
      this done from the GA date alone.
- [ ] **Re-save the v2 short description** in the production app's portal listing
      (adds واتساب; brief §2, within the 200-char limit):
      - AR: مندوب مبيعات بالذكاء الاصطناعي يقرأ منتجات متجرك في سلة وأسعارها، فيجيب عملاءك على واتساب وفيسبوك وإنستغرام طوال اليوم.
      - EN: An AI sales rep that reads your Salla products and prices and answers your customers on WhatsApp, Facebook and Instagram, all day.
- [ ] **Production app portal config cross-check**:
      - Callback URL `https://jawab24.com/salla/auth/callback`; webhook URL `https://jawab24.com/salla/webhooks`.
      - Scopes match `config.salla.scopes` (`backend/src/config/index.ts`):
        `offline_access products.read_write settings.read webhooks.read_write orders.read_write shipping.read`.
        ⚠️ **`shipping.read` must be ticked in the portal** — without it the `track_shipment`
        tool answers with order status but no tracking number (order payloads never carry
        tracking; see `docs/integrations/salla.md`). Any store connected before the scope was
        added must **reconnect** to pick up the new grant.
      - Webhook secret in the portal == prod `SALLA_WEBHOOK_SECRET`.
      - Switch the production app to **Easy Mode** (mandatory for published apps).
        ✅ **Confirmed already selected** — portal read 2026-08-20.
- [ ] **Prod env flips** → **executed in Phase 2.5** (backend.env, then container recreate —
      NOT plain `docker restart`; use `up -d --force-recreate` per deploy convention):
      - `SALLA_EASY_MODE_CLAIM_ENABLED=true` (binding merged 2026-07-18 — verify deployed)
      - `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true` (re-push confirmed in the 2026-07-18 dry-run)
      - `SALLA_APP_STORE_URL=<listing URL>` (was Phase 3; the URL is known at approval)
      **Verified absent from prod on 2026-08-17** — none of the three is set. See Phase 2.5:
      the first two are settable now, `SALLA_APP_STORE_URL` is a post-publish step.
- [ ] **Live smoke** → superseded by `docs/SALLA_TEST_PLAN.md` **Tier 3**, which covers this
      plus the order/shipment/tracking gates: store row created with refresh token +
      `token_expires_at`; products sync; webhook delivery 200s in nginx/backend logs;
      test-reply returns real prices.

## Phase 2 — Submit — ❌ NOT DONE (this section previously claimed otherwise)

- [ ] Fill the 6 wizard sections and **Save Draft** — safe, reversible, submits nothing.
      Portal state 2026-08-20: Basic Info **partial** (App Name + EN short description only);
      App Configuration **full**; Features & Media **empty** (0 of 3 screenshots minimum);
      App Pricing **untouched defaults** (`One-Time`, price 0 — ⚠️ almost certainly the wrong
      type for a free launch, since **Salla-managed billing is mandatory for paid apps** and
      launch is free-tier-only per the 2026-05-30 decision); Contact Info **empty**; Service
      Trial **empty** (Salla's reviewer needs working test credentials).
      Field-by-field paste map: `docs/store-listing/salla/PORTAL_FIELD_MAP.md`.
      ⚠️ `Sub Category = "Cross-sell / Upsell"` looks wrong for a customer-service assistant.
- [ ] **Ask Salla support whether approval auto-publishes**, or whether we control go-live.
      This has never been confirmed — it was inferred from the absence of a hold control in the
      06-12 UI recon. Support answered a comparable question in ~29 minutes.
- [ ] **"Start publishing your App"** — this IS submit-for-review, and approval is assumed to
      auto-publish. Press it only when every line of the readiness gate below is ticked.

### Readiness gate — every line must be ticked before Submit

- [ ] Prod creds repointed at `665811310` (client id + secret + webhook token) and verified
- [ ] `shipping.read` ticked in the portal
- [ ] Listing draft complete in **both** languages, 3 screenshots uploaded
- [ ] A real Salla store connected end-to-end (partner demo store)
- [ ] **Tier 3 green — including `track_shipment`, which has never once been run**
- [ ] The three Easy-Mode env vars set, incl. `SALLA_APP_STORE_URL` (only knowable post-publish
      — see the ordering note in Phase 2.5)

## Phase 2.5 — Preconditions, in dependency order ⛔ DO THIS FIRST

Phase 1 was never applied. Close it before anything else — in this order, because each step
depends on the previous.

- [x] **Deploy `main` to production.** Done: prod runs `c740cc7f` (2026-08-20), which contains the
      tracking fix `4c6469a1` (#798) and the #849 connect guard. ⚠️ Do not run two pre-deploy
      passes concurrently — false red.
- [x] 🔴 **Repoint prod at app `665811310` — DONE 2026-08-20.** Copy Client ID, Client
      Secret **and** the webhook token from the portal into `/var/www/jawab24/env/backend.env`,
      then `docker compose up -d --force-recreate --no-deps <backend>` **and `nginx -s reload`**
      (recreate changes the container IP; nginx 502s until reloaded).
      ⚠️ The backend reads `env/backend.env`, **not** the root `.env`.
      Verify without printing secrets — presence and shape only:
      `grep -c '^SALLA_CLIENT_ID=' <file>` and `grep -c 'c18dcc' <file>` (expect `1` and `1`).
      ⛔ Fixing the client id while leaving the webhook token behind reproduces the same failure
      on the first real install — the push authenticates on the token.
- [x] **Tick `shipping.read`** on `665811310` — DONE 2026-08-20 (saved set = six scopes, confirmed
      after reload). Config alone does not grant it: Easy Mode never
      calls `buildAuthUrl`, so `config.salla.scopes` has zero effect and the portal is the whole
      grant. ⭐ No re-review question — the app is not under review (see STATUS).
- [x] **Set the two runtime flags** — DONE 2026-08-20 (verified via `printenv` in the container;
      `GET /salla/store/pending` answers 401, not 404) in `/var/www/jawab24/env/backend.env`,
      then recreate + reload:
      - `SALLA_EASY_MODE_CLAIM_ENABLED=true`
      - `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true`
      Verify with `docker exec … printenv | grep '^SALLA_'` — never assume the file was picked up.
- [ ] **`SALLA_APP_STORE_URL` — CANNOT be set yet, and that is not an oversight.** The URL only
      exists once the listing is published, so this is a **post-publish** step, not a
      pre-publish one. Until then `POST /salla/store/connect` answers 404
      `SALLA_CONNECT_UNAVAILABLE`, `GET /salla/auth` bounces back to `/integrations`, and the card
      shows no Connect or Reconnect button. ⭐ Setting this URL is the **whole** of go-live for the
      UI — the buttons return by configuration, with no code change to remember.
- [x] **Run Tier 0** of `docs/SALLA_TEST_PLAN.md` — ALL ROWS PASS 2026-08-20 (0.1 `c740cc7f` =
      `origin/main`; 0.2/0.3 verified in-container incl. `SALLA_HOST_NAME=jawab24.com`; 0.4 portal
      read; 0.5 `sallaBilling.js` present; 0.6 all containers healthy after recreate + reload;
      0.7 resolved).

## Phase 3 — Go-live verification (the rehearsal, before publishing)

Full step table with pass criteria and failure handling: **`docs/SALLA_TEST_PLAN.md` Tier 3**.
Summary of the gates:

- [ ] Install onto a real store → token push → pending install → claim binds by owner-email
      match → products sync.
- [ ] Test reply quotes a real product name **and price** from the live catalog.
- [ ] `order.created` → **exactly one** customer SMS.
- [ ] `order.status.updated`(shipped) then `order.shipment.created` → still exactly one SMS,
      tracking upgraded **in place** (PR #411 design note).
- [ ] **`track_shipment` against a real shipped order** — the shipments call returns 200 (not
      403), and the reply carries tracking number + courier + link. **This is the one gate
      that has never been run: PR #798 was built from documentation, not from a live call.**
- [ ] `app.uninstalled` → store deactivates.
- [ ] Sentry quiet; `scripts/health-check.sh` green.
- [ ] Docs same-commit rule: `SYSTEM_ANALYSIS.md` platform table → "Live in App Store";
      `.planning/codebase/INTEGRATIONS.md` updated.

## Kill switch / rollback

- `SALLA_EASY_MODE_CLAIM_ENABLED=false` + backend recreate → claim endpoints 404 (new installs
  stage but can't bind; existing stores unaffected).
- `SALLA_OAUTH_CONNECT_ENABLED` — leave unset in production. It exists only so a **Custom-Mode dev**
  app can still use the OAuth connect flow; setting it on prod re-opens the dead authorize URL the
  availability guard was added to close.
- Webhook ingestion can't be "turned off" per store from our side — deactivate a misbehaving
  store row via the admin tooling instead.
- **Unpublishing a live app is NOT self-serve**: Salla requires a booked meeting
  (support@salla.dev) once merchants subscribe — another reason for submit-when-ready.

## Open items tracked elsewhere

- `abandoned.cart` / `order.shipment.created` event strings still unconfirmed by a real delivery
  (power features; not launch-blocking — `SALLA_LAUNCH_VALIDATION.md`).
- Zid: broken/rebuild-pending (D-020), sequenced after Salla.
