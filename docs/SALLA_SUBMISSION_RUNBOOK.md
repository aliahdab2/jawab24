# Salla App Store Submission Runbook

> Executable, in-order checklist for taking the Salla integration from "code done, dark" to
> live on the Salla App Store. Companion to `.planning/SALLA_LAUNCH_ACTIONS.md` (specs, portal
> recon, auto-responder text), `.planning/SALLA_LISTING_BRIEF.md` (listing copy),
> `docs/SALLA_TEST_PLAN.md` (what must be green and how to prove it), and
> `DECISIONS.md` D-012 (Easy-Mode claim binding).
> Created 2026-07-10, while both Salla and WhatsApp were staged dark
> (WhatsApp awaiting Meta App Review; Salla awaiting Partners ID verification).

## ⛔ STATUS 2026-08-17 — APPROVED, NOT PUBLISHED, AND NOT SAFE TO PUBLISH YET

Salla approval is in hand. **Phase 2 completed while Phase 1 was never applied**, so the
preconditions that were supposed to bind at submission time are still open. A live check on
2026-08-17 found:

| | State |
|---|---|
| Article-5 Stripe guard (D-065 / #695) | ✅ live in the running image |
| Prod commit | ❌ `c6afb8e2` — **four commits behind `main`**, missing the tracking fix `4c6469a1` (#798) |
| `SALLA_EASY_MODE_CLAIM_ENABLED` | ❌ absent |
| `SALLA_APP_STORE_URL` | ❌ absent |
| `SALLA_SKIP_PULL_REFRESH_EASY_MODE` | ❌ absent |
| `shipping.read` in the portal | ❓ unticked as far as we know |

**Publishing in this state strands every install.** A merchant installs → `app.store.authorize`
stages a pending install → the claim endpoints 404 because the flag is off → `connectStore`
falls back to the OAuth authorize URL, which Salla 404s for Easy-Mode apps (D-031). The
merchant has installed the app with no route to their account, and unpublishing is **not
self-serve**.

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
testing, ngrok callbacks) and the **production app** (creds live in prod `backend.env` — verified
2026-07-10: `SALLA_CLIENT_ID/SECRET/WEBHOOK_SECRET` present, `SALLA_HOST_NAME=jawab24.com`,
client id ≠ dev app). The dry-run happens on Dev; the submission happens on the production app.

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

- [ ] **Open the WhatsApp canary first** — the listing copy claims WhatsApp as shipped, so it
      must be genuinely available at review time (`docs/WHATSAPP_LAUNCH_RUNBOOK.md` Phase 5:
      clear `WHATSAPP_ALLOWLIST`, remove `NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY`, keep
      `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`, rebuild). If Meta approval hasn't landed yet, HOLD the
      Salla submission — do not submit a listing that over-claims.
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
- [ ] **Prod env flips** → **executed in Phase 2.5** (backend.env, then container recreate —
      NOT plain `docker restart`; use `up -d --force-recreate` per deploy convention):
      - `SALLA_EASY_MODE_CLAIM_ENABLED=true` (binding merged 2026-07-18 — verify deployed)
      - `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true` (re-push confirmed in the 2026-07-18 dry-run)
      - `SALLA_APP_STORE_URL=<listing URL>` (was Phase 3; the URL is known at approval)
      **Verified absent from prod on 2026-08-17** — none of the three is set.
- [ ] **Live smoke** → superseded by `docs/SALLA_TEST_PLAN.md` **Tier 3**, which covers this
      plus the order/shipment/tracking gates: store row created with refresh token +
      `token_expires_at`; products sync; webhook delivery 200s in nginx/backend logs;
      test-reply returns real prices.

## Phase 2 — Submit — ✅ DONE, APPROVED 2026-08-17

- [x] Partners portal → production app → **"Start publishing your App"** (agrees to Apps T&C).
      6 sections: Basic Info, App Configurations, App Features, Pricing
      (**Salla-managed billing is mandatory for paid apps** — launch is free-tier-only per the
      2026-05-30 decision, so no billing integration needed), Contact, Service Trial.
- [x] Review completed; **approval in hand**. Assume **auto-publish on going live** (portal
      shows no hold control — recon 2026-06-12).

## Phase 2.5 — Catch up the skipped Phase-1 preconditions ⛔ DO THIS FIRST

Phase 2 completed while Phase 1 was open. Close it before anything else — in this order,
because each step depends on the previous.

- [ ] **Deploy `main` to production.** Prod is behind and lacks the tracking fix (#798).
      `./scripts/deploy-production.sh` (runs the full pre-deploy gate: lint, `tsc`,
      schema drift, unit ×4 packages, backend integration, Playwright E2E).
      ⚠️ Do not run two pre-deploy passes concurrently — it produces a false red.
- [ ] **Set the three env vars** in `/var/www/jawab24/env/backend.env`:
      - `SALLA_EASY_MODE_CLAIM_ENABLED=true`
      - `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true`
      - `SALLA_APP_STORE_URL=<public listing URL>` (known now that approval landed; makes
        "Connect Salla" send merchants to the listing, since the OAuth authorize URL is dead
        for Easy-Mode apps — D-031)
      Then `docker compose up -d --force-recreate --no-deps <backend>` **and `nginx -s reload`**
      — recreate changes the container IP and nginx 502s until reloaded.
      ⚠️ The backend reads `env/backend.env`, **not** the root `.env`. Verify with
      `docker exec … printenv | grep '^SALLA_'` — never assume the file was picked up.
- [ ] **Tick `shipping.read`** on the production app in Salla Partners. Config alone does not
      grant it: Easy Mode never calls `buildAuthUrl`, so `config.salla.scopes` has zero effect
      in production and the portal is the whole grant.
      **Ask Salla support whether a scope change on an approved app needs re-review.**
- [ ] **Run Tier 0** of `docs/SALLA_TEST_PLAN.md` and confirm every row passes.

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
- Webhook ingestion can't be "turned off" per store from our side — deactivate a misbehaving
  store row via the admin tooling instead.
- **Unpublishing a live app is NOT self-serve**: Salla requires a booked meeting
  (support@salla.dev) once merchants subscribe — another reason for submit-when-ready.

## Open items tracked elsewhere

- `abandoned.cart` / `order.shipment.created` event strings still unconfirmed by a real delivery
  (power features; not launch-blocking — `SALLA_LAUNCH_VALIDATION.md`).
- Zid: broken/rebuild-pending (D-020), sequenced after Salla.
