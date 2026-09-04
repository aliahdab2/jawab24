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
| `gallery-1.png` | 1366×768 | **المتاجر** — «ربط سلة» card, «أزياء الخليج» with «المنتجات المزامنة: 40» and the last-sync time, the linked-page chip, order-notification toggles below (WhatsApp — the SMS rail was retired, D-123). Caption: «اربط متجرك في سلة بواتساب وفيسبوك وإنستغرام في دقيقة». |
| `gallery-2.png` | 1366×768 | **اختبار الرد الذكي** — «كم سعر العباية السوداء؟ وهل متوفر مقاس M؟» answered «سعر العباية الكلاسيك السوداء هو 450 ريال، ومقاس M متوفر حالياً.», tagged «رد ذكي» with the real latency. A **genuine pipeline reply**, not staged: the modal called the local backend + ai-worker and the price comes from the synced Salla catalog. |
| `gallery-3.png` | 1366×768 | **التعليقات**, auto-replied filter — Arabic and English comment→Smart-Reply pairs quoting real catalog prices (450/750 ريال) and shipping terms. |
| `benefit-1.png` | 1600×1600 | Catalog awareness — product chip + «مزامنة تلقائية من متجرك في سلة» + a Q&A bubble pair. |
| `benefit-2.png` | 1600×1600 | Arabic-first — two dialect exchanges (خليجي, مصري) each answered by a Smart Reply. |
| `benefit-3.png` | 1600×1600 | Three channels — WhatsApp/Facebook/Instagram flowing into one Jawab24 hub. |
| `icon-512.png` | 512×512 | The brand mark (`frontend/public/brand/icon-vector.svg`) re-framed: symbol only, transparent, centered. |
| `benefits.md` | — | AR-primary + EN titles/descriptions to paste alongside each Key-Benefits image. |
| `PORTAL_FIELD_MAP.md` | — | Which portal field takes which file/section, plus the decisions the drafts don't cover. |
| `sources/raw-*.png` | 3415×1920 | The unframed app captures. **Committed** — see above for why. |
| `sources/capture.js`, `sources/stage.sh` | — | The shoot itself. |
| `sources/*.html`, `frame.css`, `render.js` | — | The marketing frames; Cairo embedded locally, no external requests. |

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
