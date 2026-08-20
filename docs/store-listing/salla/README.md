# Salla App Store — DRAFT listing assets (Jawab24)

> **Repo copy** (moved from the session scratchpad 2026-07-18). Final PNGs live here;
> HTML/CSS sources + fonts in `sources/` — re-render with `cd sources && node render.js`
> (PNGs land in `sources/`, move them up one level). `raw-*.png` originals were not
> carried over. Captions name واتساب/فيسبوك/إنستغرام (2026-07-18 Mando competitive pass).

Produced 2026-07-18 for founder review. All sizes match Salla's confirmed specs
(`.planning/SALLA_LAUNCH_ACTIONS.md` §3): icon 512×512 ≤1 MB, 3 App Gallery images
1366×768, 3 Key Benefits images 1600×1600.

## How they were made

- The **gallery screenshots are the REAL app UI** — the local dev stack
  (frontend :3001 / backend :3000) rendered in Arabic (`/ar/...`, RTL, light mode),
  captured with Playwright Chromium at deviceScaleFactor 2, authenticated as the local
  test user whose workspace has a **real connected Salla dev store (متجر تجريبي, 20
  synced products, SAR prices)**.
- The AI reply in gallery-2 is a **genuine reply from the live pipeline** (the test
  Smart-Reply modal called the real backend + AI worker; it quotes the store's actual
  dress price of 83/94 SAR from the synced Salla catalog).
- Each screenshot is framed on a brand-teal marketing canvas (brand tokens from
  `frontend/src/styles/globals.css`, Cairo font from `frontend/public/fonts`) with an
  Arabic caption from the approved shot-list copy in `SALLA_LISTING_BRIEF.md` §4.

## Files

| File | Size | Shows |
|---|---|---|
| `gallery-1.png` | 1366×768 | **المتاجر page** — Salla connected card («ربط سلة»), متجر تجريبي with «المنتجات المزامنة: 20» + last-sync time, page-link chips (Test Page linked), order-notification toggles below. Caption: «اربط متجرك في سلة بصفحاتك في دقيقة». |
| `gallery-2.png` | 1366×768 | **اختبار الرد الذكي modal** — customer asks «كم سعر الفستان؟ وهل هو متوفر حالياً؟» and the AI answers with the real price (83 ريال سعودي), the real size range (XS–XL) and stock state, tagged «رد ذكي». Caption: «الذكاء الاصطناعي يقرأ منتجاتك وأسعارك مباشرة». |
| `gallery-3.png` | 1366×768 | **التعليقات page** — auto-replied filter with three Arabic comment→Smart-Reply cards (price question answered «94 ريال», availability, shipping to جدة). Caption: «يرد على تعليقات فيسبوك وإنستغرام تلقائياً». |
| `benefit-1.png` | 1600×1600 | Catalog awareness card — product chip (فستان · 94 ر.س · XS–XL) + «مزامنة تلقائية من متجرك في سلة» + a Q&A bubble pair. |
| `benefit-2.png` | 1600×1600 | Arabic-first card — two dialect exchanges (خليجي «بكم الجاكيت؟…», مصري «عايزة أعرف المقاسات…») each answered by a Smart Reply. |
| `benefit-3.png` | 1600×1600 | Three channels card — WhatsApp/Facebook/Instagram chips flowing into one Jawab24 hub («كل رسائلك وتعليقاتك في مكان واحد»). |
| `icon-512.png` | 512×512, 58 KB | Existing brand mark (`frontend/public/brand/icon-vector.svg`) re-framed: symbol only, no text, transparent background, 40 px margin all sides, centered. |
| `benefits.md` | — | AR-primary + EN titles/descriptions to paste alongside each Key-Benefits image. |
| `PORTAL_FIELD_MAP.md` | — | Which portal field takes which file/section, plus the decisions the drafts don't cover (sub-category, supported countries, pricing type, contact + service-trial gaps). |
| `raw-*.png` | 2560×1440 | Unframed 2× app captures (kept in case a different frame is wanted). |
| `*.html`, `frame.css`, `render.js`, `icon.html` | — | Sources; re-render everything with `node render.js`. |

## Compromises / notes for review

1. **Workspace + page names are the dev fixtures** — the header shows “Test User /
   Test Workspace”, the linked Facebook page is “Test Page”, and the Salla store is the
   dev store «متجر تجريبي». Honest, but for the final shots the founder may prefer a
   nicer-named staging workspace (e.g. a realistic store name) — re-shoot is one
   `node render.js` after new raw captures.
2. **Comment conversations are synthetic** (per the brief's hard rule: never screenshot
   real customers). Three Arabic comment+reply pairs were seeded into the local dev DB
   for the shot and **deleted afterwards**; replies were written to match the real
   catalog prices (94/114 ريال). The AI reply in gallery-2, by contrast, is a live
   pipeline response, not staged.
3. gallery-2's modal backdrop dims the page behind it (that's the app's real UX); a
   yellow «إعادة الربط مطلوبة» banner for a stale dev-store page connection sits behind
   the modal but is fully covered on the final crop.
4. gallery-1 was taken on the admin-gated Stores page (`/integrations`) — the page is
   behind an admin-only client gate during rollout, but everything shown (Salla card,
   sync, page linking, notifications) is the merchant-facing UI.
5. The browser-window frame crops the bottom ~8% of each raw capture (window bleeds off
   the canvas edge — intentional composition).
6. **Icon**: Salla's earlier guidance said 1024×1024 in the brief but the confirmed spec
   (launch-actions §1) is 512×512 ≤1 MB — delivered at 512×512 (58 KB), symbol-only, from
   the existing mark. Nothing was redesigned.
7. Fonts: Cairo (the app's own Arabic font) embedded locally from
   `frontend/public/fonts` — no external requests anywhere.
8. Copy rules honored: فصحى only in our overlay copy (dialect appears only inside
   *customer* bubbles in benefit-2, which is the product's actual dialect-mirroring
   behavior); «مندوب مبيعات» identity, no «وكيل», no transact verbs; «رد ذكي» labels come
   from the product UI itself.

## Repo / environment hygiene

- No repo files were modified; the token-minting helper (`backend/mint-token-tmp.ts`)
  was deleted after use, and the minted dev JWT file was removed.
- Dev DB restored: the 3 seeded comments were deleted; the pre-existing English test
  comment's flags were touched during the shoot and restored to their original values
  (verified: `replied=t, reply_method=ai, needs_attention=t`).
