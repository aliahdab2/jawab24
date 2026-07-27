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

## Phase 0 — Prerequisites (before approval day)

- [ ] PR `feat/whatsapp-launch-plumbing` merged + deployed — threads the two `NEXT_PUBLIC_WHATSAPP_*` vars through `frontend/Dockerfile` and all compose files' `build.args`. **Without this, setting the config ID does nothing.** (Inert while the env vars are unset.)
- [ ] Pre-launch 9-persona review of the WhatsApp surface done; Critical/High fixes merged.
- [ ] Meta App Review submission **submitted** (unlocks once the API-call gates register; then 3–5 business days).

## Phase 1 — On Meta approval (Meta dashboard, ~10 min)

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

> ⛔ **Added gate (D-045, 2026-07-27): Coexistence must ship BEFORE GA.** Without it every merchant
> must dedicate a fresh number, which is the #1 adoption blocker and guaranteed to be the top
> support question on day one. Plan: `~/.claude/plans/moonlit-conjuring-moonbeam.md`. Phases 1–2
> (connect path + echo ingestion) are built; the UI choice, human-first reply mode and the
> two-path copy remain. Coexistence cannot be validated without a real number already on the
> WhatsApp Business app — line that merchant up early, it gates the release.
>
> ⛔ **Sanctions:** Meta bars businesses AND recipients in Cuba, Iran, North Korea, **Syria** and
> three sanctioned Ukrainian regions from the WhatsApp Business Platform. Launch copy must not
> imply Syrian merchants or customers can use it. Libya is unrestricted.

**Marketing + packaging land here, BEFORE the env flip** (plan: `.planning/WHATSAPP_MARKETING_LAUNCH.md`):

- [ ] **Marketing branch:** rebase **`feat/whatsapp-ga-launch` (#504)** on main, resolve, CI green.
      ⚠️ NOT `feat/whatsapp-ga-marketing` (#428) — that branch is SUPERSEDED and 136 commits behind.
      Contains: `plans.ts` `whatsappEnabled` flip (business/pro/scale-20k/scale-30k),
      `WHATSAPP_PLAN_REQUIRED` connect gate, landing/pricing/i18n sweep, teaser post → "now live".
- [ ] Merge-day-only commit on that branch: bump sitemap `<lastmod>` for `/`, `/pricing`,
      `/blog/whatsapp-auto-reply-jawab24` to today; `npm run sitemap:validate`.
- [ ] Merge **`feat/whatsapp-ga-launch` (#504)** to main — the deploy below ships marketing + plan
      flip + env flip in ONE rebuild (`seed-plans` reconciles `whatsapp_enabled` in the DB).
      **Ordering is load-bearing:** clearing the allowlist without this merge opens WhatsApp
      to Starter (no plan gate exists on main today).

```bash
ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196
# frontend.env: remove NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY (keep CONFIG_ID!)
# backend.env:  remove WHATSAPP_ALLOWLIST (empty = open to all)
exit
./scripts/deploy-production.sh
```

- [ ] Verify with a non-admin account: WhatsApp UI now visible; connect works.
- [ ] **Marketing verification** (/ar AND /en): landing shows WhatsApp chip + features card +
      FAQ; `/pricing` shows the WhatsApp row included on Business+ and NOT included on Starter;
      blog teaser reads "now live"; meta/OG descriptions mention WhatsApp (view-source).
- [ ] **Plan-gate verification:** Starter account connect attempt → 403 `WHATSAPP_PLAN_REQUIRED`
      toast; Business account → Embedded Signup opens and connects.
- [ ] Plans flip is seed-driven — confirm `plans` table shows `whatsapp_enabled=true` for
      business/pro/scale-20k/scale-30k after deploy (seed runs post-migrate).
- [ ] Revisit the **coexistence copy** (`pages.whatsappTooltip`, `pages.channelWhatsAppDesc` in `frontend/src/i18n/{en,ar}/pages.json`) — "use a number not already on the WhatsApp app" is the #1 adoption barrier; decide softening/Coexistence support post-launch.
- [ ] Update `SYSTEM_ANALYSIS.md` + `.planning/codebase/INTEGRATIONS.md` (WhatsApp status → live) in the same commit as any code change.

## Kill switch (if something goes wrong live)

- **Fast (minutes): backend-off** — set `WHATSAPP_ALLOWLIST=nobody@jawab24.com` on the server + recreate the active backend container → all NEW connects blocked instantly (existing connected numbers keep replying).
- **Full (needs a rebuild): frontend-dark** — unset `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` + redeploy → entire WhatsApp UI hidden again. NOT instant; budget a deploy cycle (already-connected numbers stay visible by design — `|| page.whatsappConnected`).
- Stopping replies for ONE number: disconnect the page card (or toggle its WhatsApp auto-reply off) — no deploy needed.
