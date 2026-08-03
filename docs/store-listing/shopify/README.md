# Shopify App Store — listing assets (Jawab24)

> Cloned from the Salla pipeline (`docs/store-listing/salla/`, shipped 2026-07-18).
> Final PNGs live here; HTML/CSS sources + fonts in `sources/` — re-render with
> `cd sources && node render.js` (finals land in `sources/`, move them up one level).
> From a worktree without `node_modules`:
> `NODE_PATH=<installed-checkout>/node_modules node render.js`.

Specs per `docs/shopify-app-listing.md` §7: icon **1200×1200 PNG, no transparency,
no pre-rounded corners** (Shopify rounds them); screenshots **1600×900** (16:9),
no device frames, EN + AR sets for the localized listing.

## Status

| File | Size | State |
|---|---|---|
| `icon-1200.png` | 1200×1200, RGB (no alpha) | ✅ DONE — brand mark full-bleed (gradient edge-to-edge, bubble centered); verified no alpha channel |
| `shot-1-en.png` / `shot-1-ar.png` | 1600×900 | ✅ DONE — public landing hero (`jawab24.com/{en,ar}/landing`), captured from PROD 2026-08-01 |
| `shot-2-*` (Shopify onboarding, products synced) | 1600×900 | ❌ pending dev-stack capture |
| `shot-3-*` (dashboard overview) | 1600×900 | ❌ pending dev-stack capture |
| `shot-4-*` (comments with Smart Reply + product data) | 1600×900 | ❌ pending dev-stack capture |
| `shot-5-*` (integrations — Shopify connected & synced) | 1600×900 | ❌ pending dev-stack capture |
| `shot-6-*` (rules / Business Info editor) | 1600×900 | ❌ pending dev-stack capture |

All 12 frame HTMLs (`sources/shot-{1..6}-{en,ar}.html`) are wired and render-ready —
`render.js` skips a shot until its raw capture exists, so partial renders always work.

## Producing the missing raw captures (the Salla recipe, adapted)

1. Start the dev stack with the Shopify dev store connected and products synced:
   `/shopify-dev` (ngrok + backend + frontend). The shots must show REAL app UI
   with really-synced catalog data — never mock the app UI inside the frame HTML.
2. Capture each screen with Playwright Chromium, viewport **1360×780,
   deviceScaleFactor 2**, authenticated as the dev workspace user; save as
   `sources/raw-<n>-<lang>.png` (`en` capture on `/en/...`, `ar` on `/ar/...`).
3. `cd sources && node render.js`, move finals up one level.

Hard rules carried over from the Salla shoot (see its README §Compromises):

- **Never screenshot real customers.** Seed synthetic conversations into the local
  dev DB for shot 4, delete them afterwards, and restore any flags touched.
- Overlay/caption copy is **فصحى only**; dialect may appear only inside *customer*
  bubbles (that's the product's real dialect-mirroring behavior).
- «مندوب مبيعات» identity — never «وكيل» or bot-words; «رد ذكي» labels come from
  the product UI itself.
- Workspace/page naming: dev fixtures ("Test Workspace") are honest but the founder
  may prefer a realistic store name — re-shoot is one `node render.js` after new
  raw captures.

## Frame anatomy

- `frame.css` — brand-teal marketing canvas (tokens from
  `frontend/src/styles/globals.css`), Cairo embedded locally (no external
  requests), browser-window chrome, caption + brandmark topbar. Direction comes
  from each frame's `<html dir>` (EN = LTR, AR = RTL).
- The window deliberately bleeds off the canvas bottom (same composition as the
  Salla set); `.shot` uses `object-fit: cover; object-position: top`.
- `icon.html` — the brand mark with its rounded square flattened to full-bleed
  (the Shopify spec forbids transparency and pre-rounded corners).
