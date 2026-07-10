# Salla App Store Submission Runbook

> Executable, in-order checklist for taking the Salla integration from "code done, dark" to
> live on the Salla App Store. Companion to `.planning/SALLA_LAUNCH_ACTIONS.md` (specs, portal
> recon, auto-responder text), `.planning/SALLA_LISTING_BRIEF.md` (listing copy), and
> `DECISIONS.md` D-012 (Easy-Mode claim binding).
> Created 2026-07-10, while both Salla and WhatsApp were staged dark
> (WhatsApp awaiting Meta App Review; Salla awaiting Partners ID verification).

## How the switches work (read once)

| Switch | Type | Where | Applied by |
|---|---|---|---|
| `SALLA_EASY_MODE_CLAIM_ENABLED` | **Runtime** — `false`/unset = claim endpoints (`GET /salla/store/pending`, `POST /salla/store/claim`) return 404 (dormant); `true` = Easy-Mode installs claimable | `/var/www/jawab24/env/backend.env` | backend container recreate (no rebuild) |
| `SALLA_SKIP_PULL_REFRESH_EASY_MODE` | Runtime — `true` = 6h pull-refresh skips Easy-Mode stores (Salla pushes refreshed tokens via re-fired `app.store.authorize`; pulling would race the push) | same file | backend container recreate |
| `SALLA_CLIENT_ID` / `SALLA_CLIENT_SECRET` / `SALLA_WEBHOOK_SECRET` | Runtime — must match the **production** Salla Partners app (NOT Jawab24-Dev `1565152053`) | same file | backend container recreate |
| Portal **Easy Mode** toggle | Salla Partners portal, per app | portal | — (published apps MUST use Easy Mode) |

Two apps exist on the Partners portal: **Jawab24-Dev** (`1565152053`, Custom Mode, dev-store
testing, ngrok callbacks) and the **production app** (creds live in prod `backend.env` — verified
2026-07-10: `SALLA_CLIENT_ID/SECRET/WEBHOOK_SECRET` present, `SALLA_HOST_NAME=jawab24.com`,
client id ≠ dev app). The dry-run happens on Dev; the submission happens on the production app.

## Phase 0 — Prerequisites (before submission day)

- [ ] **Partners ID verification complete** (founder; THE gate — the submission form is
      unreachable until verified). Non-Saudi individual path: passport bio-data page as PDF +
      international (non-KSA) bank with SWIFT/IBAN, holder name matching passport in English.
      Portal → dropdown by your name → Account Settings → Verify My Account.
      Start immediately: review time unknown, longest lead item.
- [ ] **Easy-Mode dry-run on Jawab24-Dev done** (founder + engineering, ~30 min portal work):
      flip Dev app to Easy Mode in the portal → reinstall on the dev store → confirm
      `app.store.authorize` webhook lands (staged pending install, `handleStoreAuthorize`) →
      attempt the standard OAuth authorize redirect. Outcomes to record:
      1. Does the authorize redirect still work in Easy Mode? → settles **D-012** (YES → claim
         binding reuses shared `authCallback`/`fetchStoreInfo`; NO → owner-email match).
      2. Does Salla push token refreshes via re-fired `app.store.authorize`, and at what cadence?
         → decides `SALLA_SKIP_PULL_REFRESH_EASY_MODE`.
      3. Where are webhooks configured in Easy Mode (portal-level vs API per-store)?
- [ ] **Easy-Mode claim binding implemented + merged** (engineering, gated on the dry-run):
      per the confirmed D-012 branch, shipped dormant behind `SALLA_EASY_MODE_CLAIM_ENABLED`.
      Until then real App-Store installs stage a pending row nobody can claim.
- [ ] **Marketing sign-off** on listing copy §1–2 (`.planning/SALLA_LISTING_BRIEF.md` — honesty
      pass done 2026-07-05; sales-rep frame per D-014, no transact verbs, no "AI agent").
- [ ] **Designer assets produced** (spec in `SALLA_LAUNCH_ACTIONS.md` §3):
      exactly **3 App Gallery images @ 1366×768**, exactly **3 Key Benefits images @ 1600×1600**
      (each with title + description), **icon 512×512** PNG/JPEG ≤1MB (symbol-only, margin),
      optional **YouTube link ≤2 min**. Include a WhatsApp screenshot — the copy claims it.
- [ ] **Support inbox live** + auto-responder pasted (`SALLA_LAUNCH_ACTIONS.md` §2;
      `jawab24.com/help` already live and linked).
- [ ] **CI green / deploys unblocked**: repo secrets `STRIPE_TEST_PUBLISHABLE_KEY` +
      `STRIPE_TEST_SECRET_KEY` restored (`gh secret set …`) so the pipeline + auto-deploy work
      on launch day (manual `scripts/deploy-production.sh` bypasses GitHub if needed).

## Phase 1 — Submission-day preconditions (same day, BEFORE clicking submit)

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
        `offline_access products.read_write settings.read webhooks.read_write orders.read_write`.
      - Webhook secret in the portal == prod `SALLA_WEBHOOK_SECRET`.
      - Switch the production app to **Easy Mode** (mandatory for published apps).
- [ ] **Prod env flips** (backend.env, then container recreate — NOT plain `docker restart`;
      use `up -d --force-recreate` per deploy convention):
      - `SALLA_EASY_MODE_CLAIM_ENABLED=true` (only if Phase 0 binding is merged + deployed)
      - `SALLA_SKIP_PULL_REFRESH_EASY_MODE=true` if the dry-run confirmed push-refresh
- [ ] **Live smoke**: from a browser, connect the dogfood Salla store against PROD
      (`jawab24.com`) via the production app → store row created with refresh token +
      `token_expires_at`; products sync; webhook delivery 200s in nginx/backend logs;
      test-reply returns real prices.

## Phase 2 — Submit

- [ ] Partners portal → production app → **"Start publishing your App"** (agrees to Apps T&C).
      Fill the 6 sections: Basic Info, App Configurations, App Features, Pricing
      (**Salla-managed billing is mandatory for paid apps** — launch is free-tier-only per the
      2026-05-30 decision, so no billing integration needed), Contact, Service Trial.
- [ ] Expect **5–10 day review**. Assume **auto-publish on approval** (portal shows no hold
      control — recon 2026-06-12): submit only when ready to be live.

## Phase 3 — On approval (go-live verification)

- [ ] Install from the public App Store listing onto a real store → Easy-Mode token push lands →
      pending install visible → claim flow binds it to the right Jawab24 account → products sync.
- [ ] `order.created` → customer SMS fires (dedup holds: exactly one shipped SMS, tracking
      upgraded in place — see PR #411 design note).
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
