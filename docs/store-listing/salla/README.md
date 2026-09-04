# Salla App Store — listing assets (Jawab24)

> **Re-shot 2026-09-04** on the owner's 2026-09-03 decision to replace the dev-fixture
> names («Test User», «Test Page», «متجر تجريبي») with a realistic merchant. The whole
> shoot is now reproducible from this folder — see **How to re-shoot** below.

All sizes match Salla's confirmed specs (`.planning/SALLA_LAUNCH_ACTIONS.md` §3):
icon 512×512 ≤1 MB, 3 App Gallery images 1366×768, 3 Key Benefits images 1600×1600.

## How to re-shoot (the whole point of this section)

The 2026-07-18 shoot was rendered from `raw-*.png` captures that were **never
committed**. When the re-shoot was ordered, `node render.js` was useless — the app
captures underneath the frames were gone and the shoot had to be rebuilt from nothing.
So now: the capture is a script, and **the raws are committed**.

```bash
# 1. a scratch database — never the dev database, never production
createdb jawab24_salla_shots
cd backend
DATABASE_URL=postgresql://$USER@127.0.0.1:5432/jawab24_salla_shots npx tsx src/migrate.ts
DATABASE_URL=postgresql://$USER@127.0.0.1:5432/jawab24_salla_shots npx tsx src/scripts/seed-plans.ts

# 2. the worktree stack against it (Rule 18 port band; the ai-worker MUST be up —
#    gallery-2 is a real model reply)
cd backend    && PORT=3200 AI_SERVICE_URL=http://localhost:3202 \
                 DATABASE_URL=postgresql://$USER@127.0.0.1:5432/jawab24_salla_shots npx tsx src/index.ts
cd ai-worker  && PORT=3202 npx tsx src/index.ts
cd frontend   && NEXT_PUBLIC_API_URL=http://localhost:3200 npm run dev -- -p 3201

# 3. shoot, frame, publish
node docs/store-listing/salla/sources/capture.js
node docs/store-listing/salla/sources/render.js
cp docs/store-listing/salla/sources/{gallery,benefit}-*.png docs/store-listing/salla/sources/icon-512.png docs/store-listing/salla/
rm  docs/store-listing/salla/sources/{gallery,benefit}-*.png docs/store-listing/salla/sources/icon-512.png
```

`capture.js` resets the scratch database, does a real demo login (which seeds), prunes
to one Salla merchant via `stage.sh merchant`, refreshes the client's auth snapshot from
the server's own `/auth/me`, and shoots. Traps it already carries, each of which cost a
round on 2026-09-04:

- ⛔ **Do not truncate `plans`.** It is reference data seeded by
  `backend/src/scripts/seed-plans.ts`, not by a migration. Without it the account is on
  no plan and the reply tester answers «تم الوصول للحد الشهري للردود الذكية» instead of
  quoting a product. `stage.sh reset` excludes it.
- ⛔ **A demo-shaped account cannot produce a merchant-shaped screenshot.** The sidebar
  substitutes «مستخدم تجريبي» for any `facebook_id` starting with `demo_`
  (`Sidebar.tsx` → `useIsDemoUser`) and the demo banner keys off the same check —
  renaming the row is not enough, the id has to change. `stage.sh merchant` does both.
- ⛔ **Capture at 1366×768**, the frame's own aspect. Wider captures are scaled down into
  the frame's 1160 px window and the UI text reads tiny.
- The zustand auth store persists `user` and does **not** re-read it on navigation, so a
  DB edit after login is invisible until the snapshot is refreshed.

## What is in the shots (2026-09-04)

One merchant: **«أزياء الخليج»**, a Salla store with **40 synced products** (SAR prices),
linked to one Facebook/Instagram page of the same name. Account owner «نورة الحربي».
All of it is the demo seeder's own fixture data (`backend/src/plugins/demo/seedData.ts`),
pruned to a single store — no real customer, page or merchant appears anywhere.

| File | Size | Shows |
|---|---|---|
| `gallery-1.png` | 1366×768 | **المتاجر** — «ربط سلة» card, «أزياء الخليج» with «المنتجات المزامنة: 40» and the last-sync time, the linked-page chip, order-notification toggles below (WhatsApp — the SMS rail was retired, D-123). Caption: «اربط متجرك في سلة بواتساب وفيسبوك وإنستغرام في دقيقة». ⛔ **NOT READY TO SHIP AS-IS:** this screen is admin-only in production. See «What still needs a re-shoot» below. |
| `gallery-2.png` | 1366×768 | **اختبار الرد الذكي** — «كم سعر العباية السوداء؟ وهل متوفر مقاس M؟» answered «سعر العباية الكلاسيك السوداء هو 450 ريال، ومقاس M متوفر حالياً.», tagged «رد ذكي» with the real latency. A **genuine pipeline reply**, not staged: the modal called the local backend + ai-worker and the price comes from the synced Salla catalog. |
| `gallery-3.png` | 1366×768 | **التعليقات**, auto-replied filter — comment→Smart-Reply pairs. ⛔ **NOT READY TO SHIP AS-IS:** the crop shows the first two cards only, and on this shoot both are in **English** («Do you carry plus sizes?», «Do you ship internationally?»). The Arabic pairs («مها الشهري», «رنا السلمي», quoting 450/750 ريال) are in `sources/raw-comments.png` but below the fold. See «What still needs a re-shoot» below. |
| `benefit-1.png` | 1600×1600 | Catalog awareness — product chip + «مزامنة تلقائية من متجرك في سلة» + a Q&A bubble pair. |
| `benefit-2.png` | 1600×1600 | Arabic-first — two dialect exchanges (خليجي, مصري) each answered by a Smart Reply. |
| `benefit-3.png` | 1600×1600 | Three channels — WhatsApp/Facebook/Instagram flowing into one Jawab24 hub. |
| `icon-512.png` | 512×512 | The brand mark (`frontend/public/brand/icon-vector.svg`) re-framed: symbol only, transparent, centered. |
| `benefits.md` | — | AR-primary + EN titles/descriptions to paste alongside each Key-Benefits image. |
| `PORTAL_FIELD_MAP.md` | — | Which portal field takes which file/section, plus the decisions the drafts don't cover. |
| `sources/raw-*.png` | 3415×1920 | The unframed app captures. **Committed** — see above for why. |
| `sources/capture.js`, `sources/stage.sh` | — | The shoot itself. |
| `sources/*.html`, `frame.css`, `render.js` | — | The marketing frames; Cairo embedded locally, no external requests. |

## What still needs a re-shoot ⛔

Found reviewing the 2026-09-04 shoot. Both are in the shipped PNGs; neither is fixed by
editing this file, so **do not upload gallery-1 or gallery-3 to the portal until these
are closed.** `sources/capture.js` now fails the shoot on the second one rather than
letting it ship again.

### 1. gallery-1 shows a screen a Salla merchant cannot open

`/integrations` and its «المتاجر» nav item are **admin-only in production**:

- `Sidebar.tsx` → `getNavigationGroups` renders `nav.integrations` only `...(options.isAdmin ? … : [])`
- `pages/integrations.tsx` redirects any authenticated non-admin to `/dashboard`

That gate is why `stage.sh merchant` sets `is_admin = true` — the shot is not
producible without it. So the App Gallery's LEAD image, captioned «اربط متجرك في سلة …
في دقيقة», advertises a screen that every merchant who installs from the Salla App
Store will look for and not find.

Two ways to close it, and the choice is the owner's:

- **Drop the gate.** It is described in `Sidebar.tsx` as temporary («admin-only while
  we finish the public roll-out»). If it goes before submission, the shot becomes
  truthful with no re-shoot, and `is_admin = true` comes out of `stage.sh`.
- **Re-shoot on a merchant-visible surface** — `/salla/onboarding` (which the
  reviewer's own Service Trial script already uses) or `/pages`. Changes the
  composition and needs a caption that matches the new screen.

### 2. gallery-3's crop is English-only, against an Arabic caption

The marketing frame shows roughly the first two comment cards. On this shoot the
seeder's ordering put two English conversations there, under «يرد على تعليقات فيسبوك
وإنستغرام تلقائياً», for the **Saudi** Salla App Store — and the approved shot-list
(`.planning/SALLA_LISTING_BRIEF.md` §4, shot 3) specifies «Customer comment **in
Arabic**». The Arabic pairs exist in `sources/raw-comments.png`, below the fold.

Fix by re-ordering the fixtures so an Arabic pair leads, then re-run the shoot.
`capture.js` asserts every card inside the crop carries an Arabic conversation and
throws otherwise, so this cannot ship silently a second time.

### 3. gallery-2 publishes its own latency

The reply carries a «3377 مللي ثانية» badge. Reply speed is the product (Rule 17,
D-049; measured p50 is 2.72 s), so a 3.4-second number on the storefront argues
against us. Re-shoot against a warm ai-worker, or crop the badge.

## Two bugs the shoot found (both fixed in the same PR)

A screenshot session is an unusually good bidi audit, because it forces you to read the
Arabic UI as a stranger would.

1. **`/integrations` printed the store's last-sync time backwards and in English.**
   `toLocaleString(undefined, …)` formats in the *browser's* locale, and the formatted
   date-time is several runs joined by neutrals, so in the RTL paragraph it painted
   right-to-left. Fixed with the app locale + `<bdi>`, the same treatment
   `BusinessFactRows` already uses.
2. **A Latin auto-reply in the comments list painted its trailing punctuation on the
   wrong side.** The incoming comment carried `dir="auto"` and the reply bubble did not
   — `CommentDetailModal` already had it; only `CommentCard` was missing it.

Both are visible in the *old* gallery images and absent from the new ones.

## Notes for review

1. **Comment conversations are the demo seeder's fixtures**, per the brief's hard rule:
   never screenshot real customers. The replies were authored to match the catalog, and
   the prices they quote (450/750 ريال) are the catalog's real ones.
2. gallery-2's modal dims the page behind it — that is the app's real UX.
3. gallery-1 is the Stores page (`/integrations`), which is behind an admin-only client
   gate during rollout. Everything shown is merchant-facing UI; the gate is temporary and
   tracked in `PORTAL_FIELD_MAP.md` §6, where the reviewer's own instructions deliberately
   route around it via `/salla/onboarding`.
4. The browser-window frame crops the bottom ~8% of each raw capture — intentional
   composition, not a clipped screenshot.
5. **Icon**: the confirmed spec (launch-actions §1) is 512×512 ≤1 MB. Delivered at
   512×512, symbol-only, from the existing mark. Nothing was redesigned.
6. Copy rules honored: فصحى only in our overlay copy (dialect appears only inside
   *customer* bubbles in benefit-2, which is the product's actual dialect-mirroring
   behaviour); «مندوب مبيعات» identity, no «وكيل», no transact verbs; «رد ذكي» labels come
   from the product UI itself.

## Environment hygiene

- The shoot runs entirely against the throwaway `jawab24_salla_shots` database on the
  local dev Postgres. Production is not touched, and neither is the shared dev database —
  `stage.sh` refuses any URL that does not name a `*_shots` database, because `reset`
  truncates every application table.
- No repo file is modified by the shoot; the only outputs are the PNGs.
