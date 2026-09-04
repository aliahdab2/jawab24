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
its remaining owner decisions (sub-category, marketing sign-off — **countries decided
2026-08-20: SA · UAE · KW**; **support inbox settled 2026-09-03: `support@jawab24.com`**, with only
its auto-responder still owed), the reviewer account + demo store (Service Trial section), then the
Phase 3 rehearsal.

**What was actually approved on 2026-08-10 was the partner ID / payout verification, not an app
review.** Conflating the two is what put "APPROVED" in this file. Three consequences:

1. ⭐ **Scope changes are free right now.** Nothing is under review, so the old open question
   "ask Salla whether a scope change on an approved app needs re-review" is **MOOT**. Tick
   `shipping.read` today.
2. ⭐ **Drafting is safe — but not incremental.** The publish wizard has three distinct buttons —
   **Save Draft**, **Next**, **Submit for Review**. Only "Submit for Review" is irreversible (assume
   approval auto-publishes; no hold control was visible in the 06-12 recon, and that assumption has
   never been confirmed by Salla — ask support before submitting).
   ⚠️ **Correction, measured 2026-08-20:** *"the entire listing can be built and saved without
   submitting anything"* was too strong. **Save Draft validates the required fields** and refuses
   with *"Please fix the errors before submitting"* while any is empty. So the draft is safe to
   press, but it cannot hold half-finished work — plan one sitting with every asset in hand.
   Required fields found the hard way: App Logo, App Themes, App Pricing, and Educational Video
   (starred required, though enforcement is still under test). Details in
   `docs/store-listing/salla/PORTAL_FIELD_MAP.md`.
3. 🔴 **The wrong-app creds are the highest-severity item.** Prod is wired to a different app than
   the one being published, so the first real `app.store.authorize` push would arrive for an app
   whose secrets prod does not hold. Repoint Client ID **and** Client Secret **and** the webhook
   token together — fixing one and leaving another leaves the same failure.

### ✅ Update — 2026-08-23: first real token push against the production app — Tier 3.1 PASS, one portal defect found and fixed

Done in the founder's real Chrome via the `authenticated-browser` skill (`mcp__chrome-real__*`) —
the founder cleared Turnstile and signed in; the agent drove the session afterwards. That works
for the Partners portal *and* the `s.salla.sa` store admin; only the human check itself is manual.

- ✅ **Installed `665811310` onto `Jawab24 Dev Store 4`** (merchant `2108580704`) from the portal's
  *App Testing → Install App* link. The store admin flashes "You are not authorized for this
  request" on the redirect — **cosmetic**: the install lands (install id `e-118007999`, plan Free),
  and the portal Webhooks Log confirms `app.installed` + `app.store.authorize` fired.
- 🔴→✅ **Every delivery got 401 — a strategy mismatch, not a typo.** The portal's *Webhook
  Security Strategy* was **Token** (Salla sends `Authorization: <secret>` and **no**
  `X-Salla-Signature`), while `controllers/salla.ts` verifies the **Signature** strategy only
  (`x-salla-signature` HMAC-SHA256 of the raw body). The 08-20 transcription was byte-exact — the
  portal's secret hashes identically to prod's `SALLA_WEBHOOK_SECRET` (SHA-256 prefix `5622e42a`).
  **Fix = portal only**: strategy flipped to **Signature** (persists across reload; the secret is
  NOT regenerated), then *Reauthorize App* in the store admin → `200`/`200`, Webhooks Log 100%.
  ⛔ Nothing in this runbook had ever stated the strategy, which is how it was set wrong — it is
  now a Tier 0 row (0.8) and a Phase 1 precondition.
- ✅ **Tier 3.1 verified at the read path**: `pending_ecommerce_installs` row staged — platform
  `salla`, merchant `2108580704`, encrypted access + refresh tokens, `token_expires_at` = +14 days,
  scopes incl. `shipping.read`, `status = pending`, unclaimed.
- ✅ **Tier 3.2 (claim) was blocked by our own rule — resolved in code (D-093).** The claim binds
  the store's registered email to the signed-in user's email (D-031). Every portal demo store
  carries a synthetic `<slug>@email.partners` address, the demo store's admin settings pages 404
  (email cannot be changed), the portal's Demo/Ready Store forms take no email, Jawab24 has **no
  password login** (Facebook / phone-OTP / Demo Mode), and Facebook login **rewrites `users.email`
  on every sign-in** (`services/auth.ts`) — so a one-off DB edit of a reviewer user's email does
  not survive their first login. A real store is no way out either: **an app in Development
  status can only be installed on demo stores** (docs.salla.dev/421410m0). So before publication
  no claimable store could exist under D-031 as written. **Fix:** `verifyOwnership` now skips the
  email match when `store/info.type` is `demo` or `development` (allow-list; `live`, missing and
  unknown types keep the full proof) — same authoritative read, no new persistence. Consequence
  worth knowing: a Salla reviewer who installs onto *their own* test store now binds it to the
  review account instead of hitting `email_mismatch`.

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
| `SALLA_APP_STORE_URL` | Runtime — public listing URL (known at approval). With the claim flag on, `POST /salla/store/connect` redirects here instead of the OAuth authorize URL, which Salla 404s for Easy-Mode apps (no registered redirect_uri — 2026-07-18 dry-run, D-031). Also the merchant-facing "manage your plan" destination the marketplace-billing guard hands the UI | same file | backend container recreate |
| `SALLA_APP_ID` | **Runtime — a SUBMIT PREREQUISITE (D-104).** `665811310`. Unset = the billing rail is DORMANT: `SallaBillingReconcile` never schedules and every `syncSallaBilling` answers `no_store`, so a merchant who pays inside Salla activates NOTHING and the failure is silent. Deploying the code without it is safe; submitting the listing without it is not | same file | backend container recreate |
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
- [ ] **Assets RE-SHOT 2026-09-04, 1 of 3 gallery images shippable** (spec in
      `SALLA_LAUNCH_ACTIONS.md` §3): 3 App Gallery @ 1366×768, 3 Key Benefits @ 1600×1600,
      icon 512×512 — all at `docs/store-listing/salla/`, all real Arabic app UI. The re-shoot
      replaced the dev-fixture names («Test User», «Test Page», «متجر تجريبي») with one
      realistic Salla merchant per the owner's 2026-09-03 decision, and the shoot is now
      reproducible from `sources/capture.js` with the raws committed beside it.
      ⛔ **Two gallery images are NOT uploadable yet** — both found on review, both written up
      with their fixes in `docs/store-listing/salla/README.md` → «What still needs a re-shoot»:
      **gallery-1** shows `/integrations`, which is admin-only in production, so it advertises
      a screen no merchant can open (drop the gate, or re-shoot on `/salla/onboarding`);
      **gallery-3**'s crop landed two English conversations under an Arabic caption, against
      the approved shot-list's «comment in Arabic» (re-order the fixtures and re-run —
      `capture.js` now fails the shoot on this). gallery-2 and the three benefit images are
      fine. ⏭ Founder eyeball still owed on all of them.
      ⏭ Still open: the optional **YouTube link ≤2 min** (only if the wizard enforces the
      Educational Video field — test that first, see Phase 2 step 1).
- [x] **Support inbox live** — `support@jawab24.com`, settled and confirmed 2026-09-03 (owner).
      Verified against live DNS: Namecheap forwarding MX (`eforward{1..5}.registrar-servers.com`)
      + matching SPF; the alias forwards to a monitored inbox. ⚠️ The "MX absent" line in the
      deliverability audit is about `send.jawab24.com` (SES bounce feedback), not this.
- [ ] **Auto-responder still owed** — forwarding provides none, and a Gmail vacation reply would
      answer from the owner's personal address. Reviewer may test the address; an unanswered one
      is a rejection reason (`SALLA_LAUNCH_ACTIONS.md` §2; `jawab24.com/help` already live and
      linked). See `docs/store-listing/salla/PORTAL_FIELD_MAP.md` §5.
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
      - Webhook secret in the portal == prod `SALLA_WEBHOOK_SECRET` **and Webhook Security
        Strategy = Signature**. The handler verifies `X-Salla-Signature` only; on *Token* Salla
        sends an `Authorization` header and no signature, so **every** delivery answers 401
        (`Invalid HMAC`) — this is exactly what the first real install hit on 2026-08-23.
        ✅ Set to Signature 2026-08-23.
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

- [ ] Fill the 6 wizard sections and **Save Draft** — safe, reversible, submits nothing. ⚠️ It
      validates: every required field must be filled before the draft will save at all (see the
      correction in STATUS above), so go in with all assets ready.
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

- [x] Prod creds repointed at `665811310` (client id + secret + webhook token) and verified
      (2026-08-20; secret proven byte-exact 2026-08-23 by a 200 in the portal Webhooks Log)
- [x] Webhook Security Strategy = **Signature** in the portal (2026-08-23 — was Token ⇒ 401s)
- [x] `shipping.read` ticked in the portal (2026-08-20; present in the pushed scopes 2026-08-23)
- [ ] Listing draft complete in **both** languages, 3 screenshots uploaded
      (⛔ only `gallery-2.png` is uploadable as shot — gallery-1 and gallery-3 each need
      work first, see `docs/store-listing/salla/README.md` → «What still needs a re-shoot»)
- [ ] A real Salla store connected end-to-end — install + token push + claim ✅ 2026-08-23 (demo
      store, D-093) — **but the store row was later DELETED (discovered 2026-08-30) and the 08-23
      21:30 re-push expired unclaimed.** Rebuild: *Reauthorize App* in the demo-store admin →
      claim as the review account. Then link a **second** page to it — the account's only page
      serves the Zid demo (see `SALLA_TEST_PLAN.md` Tier 3 preamble, 2026-09-03)
- [ ] **Tier 3 green** — `track_shipment` ✅ 2026-08-24; remaining: 3.9 (uninstall + billing-mirror
      cancel, then re-install/re-claim), 3.10, 3.11.1 (fires at the claim)
- [x] `SALLA_APP_ID=665811310` set — **2026-08-30**, verified in-container (also 2026-09-03 after
      the next deploy). The D-104 rail is armed
- [ ] `SALLA_APP_STORE_URL` (only knowable post-publish — see the ordering note in Phase 2.5)
- [ ] Service Trial credentials decided (owner): Jawab24 has no password login, so the reviewer
      signs in with **Facebook** using the review account `ahdabeslov@gmail.com` — the same
      account already shared with Meta and Apple review. Instructions must name the
      **Salla-linked page** for the smart-reply test

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
- [x] **`SALLA_APP_ID=665811310` — DONE 2026-08-30** (owner; backend-blue recreated 20:44 UTC,
      nginx reloaded). Verified in-container as booleans, never by printing the env file. ⚠️ The
      first reconcile logged nothing — that was `scanned = 0` (the review store row had been
      deleted), NOT a dormant gate; see the test plan's 2026-08-30 results.
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
- [ ] `order.created` → **exactly one** customer notification row. ✅ 2026-08-25 (confirmed admin
      order `#279682567`; a Draft fires nothing — the Confirm dialog is what creates the order).
      ⚠️ **Proved on the SMS rail, which no longer exists — see the note below.**
- [ ] `order.status.updated`(shipped) → one row held for the 5-min grace, then sent.
      ✅ 2026-08-24 + 2026-08-25. ⚠️ Same rail caveat. The `order.shipment.created` half (tracking
      upgraded **in place**, PR #411 design note) is NOT verifiable on a demo store — the label flow
      never emits the event and Dev Company assigns no tracking (`SALLA_TEST_PLAN.md`
      2026-08-25 results); pinned by unit tests, live pass deferred to the first
      real-courier store.

> ⛔⭐ **Both order-notification rows above were proved against the Vonage SMS rail, retired
> 2026-09-03 by D-123 / PR #1042. Do not read their ✅ as a green delivery gate.**
> What still holds is the half those runs actually exercised on the Salla side and that #1042 did
> not touch: `buildSallaOrderEvent` (`backend/src/controllers/salla.ts`) — one event per order, the
> `salla:order_shipped:<order_id>` dedup key, the 5-minute `SHIPPED_NO_TRACKING_GRACE_MS` hold, and
> the in-place tracking upgrade. That logic is rail-agnostic and unchanged.
> What is **no longer proved** is delivery. WhatsApp is now the only customer channel:
> `customerNotifications.ts` throws `channel_unsupported` on any row not on `whatsapp`, and a
> WhatsApp send needs a linked number **and** a Meta-approved template on that workspace. The
> review workspace has neither, so an end-to-end order notification is **not demonstrable on the
> review store** before submitting.
> Consequence: this is **not** a listing blocker. The only brief bullet that would have promised
> order notifications — «تأكيد الطلبات وتذكير العملاء بالعربات المتروكة (قريباً)» — is already one
> of the two `PORTAL_FIELD_MAP.md` §3 deletes, so nothing in the pasted copy claims it, and the
> reviewer's Service Trial script never reaches this path. It IS a runbook honesty fix: re-run both
> rows on the WhatsApp rail against the first real merchant store, not before.
- [x] **`track_shipment` against a real shipped order** — ✅ PASSED 2026-08-24
      (see `SALLA_TEST_PLAN.md` 3.8): the shipments call returned 200
      with a parseable envelope; reply carried the courier (no tracking on the demo
      shipment — demo limitation, not a defect).
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
