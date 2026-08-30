# WhatsApp Launch Runbook

> Executable, in-order checklist for taking the WhatsApp channel from "approved by Meta" to GA.
> Companion to `.planning/WHATSAPP_PLAN.md` (architecture/history) and
> `docs/meta-app-review-resubmission.md` § "WhatsApp Embedded Signup Submission" (the submission itself).
> Created 2026-07-08, while the App Review submission (draft `949305008122443`) awaited Meta.

## How the switches work (read once)

| Switch | Type | Where | Applied by |
|---|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` | **Build-time** master switch — unset = entire WhatsApp UI hidden (dark) | `/var/www/jawab24/env/frontend.env` on the server | **frontend rebuild + redeploy** (Next.js inlines it) |
| `NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY` | Build-time — `true` = WhatsApp UI visible to platform admins only | same file | frontend rebuild + redeploy |
| `WHATSAPP_ALLOWLIST` | **Runtime** hard gate — non-empty = only listed emails can connect (403 otherwise); empty = open | `/var/www/jawab24/env/backend.env` | backend container recreate (no rebuild) |

Defense in depth: the frontend flags control *visibility*; the backend allowlist controls *ability*. During canary, set **both**.

## Phase 0 — Prerequisites (before approval day) — ✅ ALL DONE

- [x] PR `feat/whatsapp-launch-plumbing` (#418) merged + deployed — threads the two `NEXT_PUBLIC_WHATSAPP_*` vars through `frontend/Dockerfile` and all compose files' `build.args`. **Without this, setting the config ID does nothing.** (Inert while the env vars are unset.) Verified deployed 2026-07-10.
- [x] Pre-launch 9-persona review of the WhatsApp surface done 2026-07-08; both Highs fixed + merged (#420). **Do not re-run it.**
- [x] Meta App Review submission `949305008122443` submitted 2026-07-08.
- [x] Canary-leak fix (M3 — nav rename/badges used `isWhatsAppEnabled` instead of `isWhatsAppVisible`) merged; `Sidebar`, `dashboard`, `pages`, `WhatsAppNudgeBanner` all canary-aware.

## Phase 1 — On Meta approval (Meta dashboard, ~10 min) — ⬅️ **YOU ARE HERE (approved 2026-07-26)**

1. [ ] App Dashboard ([app 774211662298446](https://developers.facebook.com/apps/774211662298446)) → confirm `whatsapp_business_messaging` + `whatsapp_business_management` show **Advanced Access**.
2. [ ] Create the Embedded Signup **configuration**: Facebook Login for Business → **Configurations** → Create → type "WhatsApp Embedded Signup" (also reachable via WhatsApp → Embedded Signup).
3. [ ] Copy the **Configuration ID** — this becomes `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`.
4. [ ] **Enable JS-SDK login** — Facebook Login for Business → **Settings** → *Client OAuth settings*:
   - `Login with the JavaScript SDK` → **Yes** (it defaults to **No**; while off, every connect attempt dies in the popup with *"JSSDK option is not toggled"* and no amount of correct config helps)
   - `Allowed Domains for the JavaScript SDK` → add `https://jawab24.com` (apex only — `www` 301s to it, so the SDK never runs there). Meta normalises it to a trailing slash. ⚠️ Once this list is non-empty **only** listed domains work.
   - Click **Save Changes** (the page does NOT autosave), then **reload the page and re-read both values** — the save can succeed with no visible confirmation.
   - Reachable only by clicking **Settings** in the left sidebar; typing `/fb-login/settings/` or `/fb-login-for-business/settings/` silently redirects to the dashboard.
5. [ ] Verify the CSP allows the SDK — `curl -sI https://jawab24.com/pages | grep -io 'content-security-policy:.*'` must contain `connect.facebook.net` (script-src), `staticxx.facebook.com` (frame-src) and `graph.facebook.com` (connect-src). Guarded by `backend/src/__tests__/nginx-config.test.ts`; **`graph.facebook.com` also appears in `img-src`, so grep the specific directive, not the whole header.**

> **Two config gates, two different failure signatures — both look like "WhatsApp is broken":**
> CSP missing `connect.facebook.net` → *"Failed to load Facebook SDK"* (our own error, from `script.onerror`).
> JS-SDK toggle off → Meta's own dialog says *"JSSDK option is not toggled"*.
> Both are deterministic for every merchant on every browser, and neither is catchable by any test in the repo except the nginx one — CSP is enforced only by a real browser, and the toggle only by Meta.

**Noted for later (not blocking):** `Use Strict Mode for redirect URIs` is **Yes**, and Meta's own help text says `Valid OAuth Redirect URIs` "is also used by the JavaScript SDK for in-app browsers that suppress popups". A pure `FB.login` popup never uses a redirect URI, and native/Capacitor is already bounced to the web dashboard (`pages.tsx` `handleConnectWhatsApp`) — but if a merchant ever reaches connect from an in-app browser that blocks popups, the SDK falls back to a redirect and would need a matching URI listed.

## Phase 2 — Canary flip (server + deploy, ~30 min)

```bash
ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196
# 1. Frontend env (build-time vars, consumed by the next image build):
#    add to /var/www/jawab24/env/frontend.env:
#      NEXT_PUBLIC_WHATSAPP_CONFIG_ID=<Configuration ID from Phase 1>
#      NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY=true
# 2. Backend env (runtime):
#    add to /var/www/jawab24/env/backend.env:
#      WHATSAPP_ALLOWLIST=aliahdab@gmail.com
exit
# 3. Full deploy from the dev machine (rebuilds frontend → bakes the flags in):
./scripts/deploy-production.sh
```

Notes:
- The deploy script runs the full pre-deploy gate (lint/unit/integration/E2E/docker) and auto-rolls-back if the live dashboard check fails.
- `WHATSAPP_ALLOWLIST` is applied by the same deploy (backend container is recreated). For a later allowlist-only tweak, recreating the **active-color** backend container is enough — no rebuild (verify with `scripts/check-status.sh` which color is live; per ops lesson, use `docker compose ... up -d --force-recreate`, not `docker restart`).

## Phase 3 — Canary verification (immediately after deploy)

- [ ] **Admin account** (founder): sidebar shows **"Channels"** (not "My Pages"); channel picker offers WhatsApp; dashboard nudge visible.
- [ ] **Non-admin account**: ZERO WhatsApp UI anywhere (canary flag working); "My Pages" name unchanged.
- [ ] **Non-allowlisted connect attempt** (API-level): returns `WHATSAPP_NOT_ALLOWLISTED` 403.
- [ ] `scripts/health-check.sh` green; Sentry quiet.

## Phase 4 — Founder pilot (own number, before any announcement)

- [ ] Connect founder's WhatsApp Business number via the Embedded Signup popup (desktop browser — the ES popup does not work inside the Capacitor WebView).
- [ ] Inbound text → AI reply arrives (check reply language + Business Info grounding).
- [ ] **Voice note** → transcribed → answered.
- [ ] Image / non-text → nudge behavior correct.
- [ ] Manual reply from the inbox (works inside 24h window; friendly `DM_WINDOW_EXPIRED` error outside it).
- [ ] Disconnect + reconnect flow works; WhatsApp-only card billing/page-slot behaves.
- [ ] **Payment-method watch item**: confirm inbound-only service conversations work with NO payment method on the WABA (matters for sanctioned-country merchants). Record the answer in `.planning/WHATSAPP_PLAN.md`.

## Phase 5 — GA flip (after a clean pilot bake, e.g. 2–3 days)

> ✅ **D-045 Coexistence gate — SATISFIED (#530, 2026-07-28).** The connect path, echo ingestion,
> the connect-time path question (`WhatsAppPathModal`) and the two-path copy are all on main, so a
> merchant can keep their number on the WhatsApp Business app. Verified live in production
> 2026-07-29: `featureType` reaches Meta correctly for BOTH paths (empty vs
> `whatsapp_business_app_onboarding`), Meta honours it with a distinct 6-step flow containing a
> "Select your setup" stage, and **Meta itself refuses a number that is not registered in the
> Business app** rather than silently migrating it.
>
> ✅ **Proven in production 2026-08-29 — and both feared failure modes happened on day one.** The
> first real Coexistence connect failed on the register call (`platform_type` lied — fixed by #968,
> Coexistence is now sticky), and echo ingestion then produced the *self-mute*: the WhatsApp
> Business **app's own greeting** is echoed exactly like a typed reply, was stored `manual`, and
> silenced the AI for the whole handoff window in every conversation — the customer's follow-up
> was answered 14 min later. Fixed by `whatsappEchoClassifier` (`app_auto`, D-109); the card now
> tells Coexistence merchants to switch the app's Greeting/Away off. Contained: those branches only
> run for pages with `whatsapp_coexistence = true`, so Facebook/Instagram/migration merchants cannot
> be affected. **Human-first reply mode (Phase 3) is deliberately NOT built** — deferred until a
> real coexistence number exists and its timing is observable (one now does).
> Still unverified: whether receive-and-discard satisfies Meta's 24h "synchronize or
> offboard" warning on the `history` field.
>
> ⛔ **Sanctions:** Meta bars businesses AND recipients in Cuba, Iran, North Korea, **Syria** and
> three sanctioned Ukrainian regions from the WhatsApp Business Platform. Launch copy must not
> imply Syrian merchants or customers can use it. Libya is unrestricted. **Not yet enforced in
> code** — `utils/geoCheck.ts` is not called from the WhatsApp connect path.

**Marketing lands here, BEFORE the env flip** (plan: `.planning/WHATSAPP_MARKETING_LAUNCH.md`):

> **Packaging is already on main — do NOT repeat the old "ordering is load-bearing" warning.**
> Re-verified against the production database 2026-07-29: the `WHATSAPP_PLAN_REQUIRED` connect gate
> is live in `controllers/whatsapp.ts`. **Since D-118 (2026-08-30) `plans.whatsapp_enabled` is `true`
> for starter/business/pro/scale-20k/scale-30k and `false` for basic only** — the trial rides on
> Starter, so trialing accounts are now entitled. The old `feat/whatsapp-ga-marketing` (#428) branch is
> superseded and 136 commits behind — do NOT rebase it.

- [ ] **Marketing branch:** `feat/whatsapp-ga-launch` (#504) — landing WhatsApp presence (chip, orbit
      bubble, hero/SEO/FAQ copy), i18n copy sweep (meta/about/blog/help/contact + `what-is-jawab24`
      JSON-LD), pricing FAQ #9 (Meta conversation fees) + hero/SEO copy, blog teaser → "now live",
      status docs → live. Merge main in first and re-run the local gates (GitHub CI is dead — the
      real gate is `scripts/pre-deploy-check.sh`).
- [ ] Merge-day-only commit on that branch: bump sitemap `<lastmod>` for `/`, `/pricing`,
      `/blog/whatsapp-auto-reply-jawab24` to today; `npm run sitemap:validate`.
- [ ] Merge `feat/whatsapp-ga-launch` to main — the deploy below ships marketing + env flip in ONE
      rebuild. (`seed-plans` reconciles `whatsapp_enabled` in the DB; already true in config.)

```bash
ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196
# frontend.env: remove NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY (keep CONFIG_ID!)
# backend.env:  remove WHATSAPP_ALLOWLIST (empty = open to all)
exit
./scripts/deploy-production.sh
```

- [ ] Verify with a non-admin account: WhatsApp UI now visible; connect works.
- [ ] **Marketing verification** (/ar AND /en): landing shows WhatsApp chip + features card +
      FAQ; `/pricing` shows the WhatsApp row included from Starter up and NOT included on Basic;
      blog teaser reads "now live"; meta/OG descriptions mention WhatsApp (view-source).
- [ ] **Plan-gate verification:** Basic account connect attempt → 403 `WHATSAPP_PLAN_REQUIRED`
      toast; Starter/Business account → Embedded Signup opens and connects.
- [ ] Plans flip is seed-driven — confirm `plans` table shows `whatsapp_enabled=true` for
      starter/business/pro/scale-20k/scale-30k after deploy (seed runs post-migrate).
- [x] ~~Revisit the **coexistence copy**~~ — done: `pages.whatsappTooltip` and `pages.channelWhatsAppDesc` now state both paths instead of "use a number not already on the WhatsApp app", and the blog's "no QR-code hacks" line (which pre-contradicted Coexistence, since it uses a QR step) was rewritten in both locales.
- [ ] **Verify the path question live in BOTH locales** (`/en/pages`, `/ar/pages`): picking "WhatsApp only" asks the question before the Meta popup, both options render translated (no raw `pages.whatsappPath*` keys), and the RTL layout is correct.
- [ ] Update `SYSTEM_ANALYSIS.md` + `.planning/codebase/INTEGRATIONS.md` (WhatsApp status → live) in the same commit as any code change.

## Kill switch (if something goes wrong live)

- **Fast (minutes): backend-off** — set `WHATSAPP_ALLOWLIST=nobody@jawab24.com` on the server + recreate the active backend container → all NEW connects blocked instantly (existing connected numbers keep replying).
- **Full (needs a rebuild): frontend-dark** — unset `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` + redeploy → entire WhatsApp UI hidden again. NOT instant; budget a deploy cycle (already-connected numbers stay visible by design — `|| page.whatsappConnected`).
- Stopping replies for ONE number: disconnect the page card (or toggle its WhatsApp auto-reply off) — no deploy needed.
