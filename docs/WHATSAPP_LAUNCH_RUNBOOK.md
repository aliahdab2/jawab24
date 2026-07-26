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

**Marketing lands here, BEFORE the env flip** (plan: `.planning/WHATSAPP_MARKETING_LAUNCH.md`):

> **Packaging is already on main (verified 2026-07-26).** The `plans.ts` `whatsappEnabled` flip
> (starter false; business/pro/scale-20k/scale-30k true) and the `WHATSAPP_PLAN_REQUIRED` connect
> gate landed independently of the marketing branch, so clearing the allowlist can no longer expose
> WhatsApp to Starter. The old `feat/whatsapp-ga-marketing` branch is 136 commits behind and 4 of its
> 8 commits are redundant — do NOT rebase it. Use `feat/whatsapp-ga-launch` (cut fresh off main),
> which carries only the still-missing marketing surface.

- [ ] **Marketing branch:** `feat/whatsapp-ga-launch` — landing WhatsApp presence (chip, orbit
      bubble, hero/SEO/FAQ copy), i18n copy sweep (meta/about/blog/help/contact + `what-is-jawab24`
      JSON-LD), pricing FAQ #9 (Meta conversation fees) + hero/SEO copy, blog teaser → "now live",
      status docs → live. CI green.
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
