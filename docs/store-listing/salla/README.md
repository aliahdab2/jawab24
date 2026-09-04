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
| `gallery-1.png` | 1366×768 | **المتاجر** — «ربط سلة» card, «أزياء الخليج» with «المنتجات المزامنة: 40» and the last-sync time, the linked-page chip, order-notification toggles below (WhatsApp — the SMS rail was retired, D-123). Caption: «اربط متجرك في سلة بواتساب وفيسبوك وإنستغرام في دقيقة». Shot as a **non-admin merchant**, which is only possible since the admin gate came off — see below. |
| `gallery-2.png` | 1366×768 | **اختبار الرد الذكي** — «كم سعر العباية السوداء؟ وهل متوفر مقاس M؟» answered «سعر العباية الكلاسيك السوداء هو 450 ريال، ومقاس M متوفر حالياً.» in 3338 ms, tagged «رد ذكي». A **genuine pipeline reply**, not staged: the modal called the local backend + ai-worker and the price comes from the synced Salla catalog. The reply had to pass the acceptance criteria below to be shot at all. |
| `gallery-3.png` | 1366×768 | **التعليقات**, auto-replied filter — the top row leads with «مها الشهري» «كم سعر العباية السوداء؟» answered «العباية السوداء الكلاسيك بـ 450 ريال والمطرزة بـ 750 ريال» (real catalog prices), beside an English pair that shows the same replies working in both languages. The Arabic lead is enforced by `capture.js`, not left to fixture ordering. |
| `benefit-1.png` | 1600×1600 | Catalog awareness — product chip + «مزامنة تلقائية من متجرك في سلة» + a Q&A bubble pair. |
| `benefit-2.png` | 1600×1600 | Arabic-first — two dialect exchanges (خليجي, مصري) each answered by a Smart Reply. |
| `benefit-3.png` | 1600×1600 | Three channels — WhatsApp/Facebook/Instagram flowing into one Jawab24 hub. |
| `icon-512.png` | 512×512 | The brand mark (`frontend/public/brand/icon-vector.svg`) re-framed: symbol only, transparent, centered. |
| `benefits.md` | — | AR-primary + EN titles/descriptions to paste alongside each Key-Benefits image. |
| `PORTAL_FIELD_MAP.md` | — | Which portal field takes which file/section, plus the decisions the drafts don't cover. |
| `sources/raw-*.png` | 3415×1920 | The unframed app captures. **Committed** — see above for why. |
| `sources/capture.js`, `sources/stage.sh` | — | The shoot itself. |
| `sources/*.html`, `frame.css`, `render.js` | — | The marketing frames; Cairo embedded locally, no external requests. |

## What review changed, and why the shoot is now deterministic

The 2026-09-04 shoot was reviewed before it went to the portal. Three problems were
found in the shipped PNGs, all three are closed, and the shoot can no longer produce
them silently.

### 1. gallery-1 showed a screen a merchant could not open — the gate came off

`/integrations` («المتاجر») used to be admin-only: the nav entry was
`...(options.isAdmin ? … : [])` in `Sidebar.tsx`, and the page redirected every
authenticated non-admin to `/dashboard`. So the App Gallery's LEAD image advertised a
screen every merchant who installed from the Salla App Store would look for and not
find. The tell was in the shoot itself — `stage.sh` had to set `is_admin = true` to
make the shot possible at all.

**Closed by the owner's ruling (2026-09-04): the gate came off**, nav entry and route
guard together. The screen is GA, `stage.sh` now stages a plain merchant
(`is_admin = false`), and gallery-1 is shot as one. `test/components/layout/Sidebar.test.ts`
pins the entry as visible to a NON-admin so the gate cannot come back on the nav side
alone and silently re-break the listing.

### 2. gallery-3's crop was English-only — the fixtures were randomly ordered

The frame shows the first row of a two-column grid, and which comments landed there
was a **coin flip**: `seedData.ts` set every demo comment's timestamp to
`Date.now() - Math.random() * 3 days`. The demo inbox therefore arrived in a different
order on every seed, and the shoot caught a row of two English conversations under an
Arabic caption, for the Saudi storefront.

Fixed at the root: demo comments now carry an explicit `minutesAgo`, the same way
`DEMO_MESSAGES` and the demo notifications always did. Both timestamps are set —
`createdAt`, which the inbox **orders** by, and `createdTime`, which the card
**displays** — because setting only one produced a list whose order disagreed with the
ages on its own cards. The Arabic pairs are deliberately the newest.

### 3. gallery-2's reply was whatever the model happened to say

It is a real model call, so it is not the same twice. Across these shoots the same
question came back as a clean one-liner at 3377 ms and, next run, as a three-line
answer with two raw product URLs at 4883 ms. `capture.js` now re-asks until the reply
meets written criteria — quotes a price, carries no raw URLs, and its latency badge is
at or under **3500 ms**, the production p50 band (2.72 s, D-049) plus headroom for a
locally-run worker. This samples for a REPRESENTATIVE reply, not a flattering one: we
will not advertise slower than typical, and we will not pretend to be faster.

⚠️ Expect several rejected attempts on a cold worker — five were needed on the final
run. Warm the ai-worker first if you want the shoot to finish quickly.

### What `capture.js` now refuses to shoot

Each of these was a real defect that reached a PNG, and each is now an exception:

- a sidebar reading «مستخدم تجريبي», or the demo banner, on any screen
- a store card showing zero synced products
- a comments top row with no Arabic conversation in it — selected **geometrically**,
  because the grid fills by COLUMN, so the first two cards in DOM order are one whole
  column and not the row a reader sees
- the «تم الرد تلقائياً» filter not having applied yet (it waits for every visible card
  to carry a reply, rather than assuming the click was synchronous)
- a reply that is an error, a quota wall, priceless, URL-laden, or too slow

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
