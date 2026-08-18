# Slow-connection performance harnesses

Reproducible measurement of Jawab24 against **production** on emulated slow
connections (Playwright Chromium + CDP `Network.emulateNetworkConditions`,
DevTools presets: Slow 3G = 400 kbps / 2,000 ms RTT). Established 2026-08-17
during the slow-connection audit; these scripts are the measuring stick for
every performance PR — run them before claiming a win.

Run from the repo root (playwright is a frontend devDependency):

```bash
# App screen, APK-equivalent (warm asset cache — Next.js chunks are immutable
# so they serve from cache like the APK's bundled assets, while /api/* has no
# Cache-Control and still crosses the network). Logs into the shared demo
# account via the real UI first, unthrottled.
node frontend/scripts/perf/measure-page.mjs "Slow 3G" apk /en/dashboard
node frontend/scripts/perf/measure-page.mjs "Slow 3G" apk /en/settings

# Same, but only /dashboard (the original single-screen variant)
node frontend/scripts/perf/measure-slow.mjs "Slow 3G" apk

# Public website, cold cache = a first visit (the merchant tapping an ad)
node frontend/scripts/perf/measure-site.mjs "Slow 3G" /ar
```

Presets: `"Slow 3G" | "Fast 3G" | "Fast 4G" | none`. Cache modes: `apk`
(warm assets) | `web` (cold).

## Baselines — production, 2026-08-17 (pre payload-trims PR #806)

| Surface | Time to content | Notes |
|---|---|---|
| /dashboard (apk, Slow 3G) | 5,459 ms | 16 /api calls, 38.5 kB, one wave |
| /comments (apk, Slow 3G) | 5,457 ms | 28.7 kB |
| /messages (apk, Slow 3G) | 6,872 ms | 26.3 kB; /api/pages = 47% of bytes |
| /settings (apk, Slow 3G) | 8,895 ms | 89.5 kB; TWO waves + 67.5 kB prefetch |
| /ar website (cold, Slow 3G) | FCP 16,164 ms | CSS 15th in line behind GTM + 13 font preloads |
| /ar website (cold, Fast 4G) | FCP 736 ms | same bytes — the gap is the link |
| /dashboard (apk, Fast 4G) | 1,010 ms | |

## Reading the numbers

- **Wire bytes only.** `/api/*` is served brotli (~4–6× for Arabic JSON); raw
  DB/JSON byte counts overstate every win. The scripts report
  `encodedDataLength` (actual wire bytes).
- The `bundled` bucket (JS/CSS/fonts) is NOT an APK cost — those ship inside
  the APK. Only `api` + `image` transfer to the app.
- The emulator throttles **responses, not handshakes** — preconnect/DNS wins
  do not show up here; only a real device shows them.
- Never quote the cold-cache web total as the app's cost (it includes ~1 MB of
  JS the APK never downloads).

## Baselines — production, 2026-08-18 (after PR #806 + #807, SHA `6c0e1a5`)

| Surface | Measured | Notes |
|---|---|---|
| /ar website (cold, Slow 3G) | FCP = LCP 14,236–14,448 ms | 1,090.8 kB / 52 req; CLS 0.000 |
| — bytes delivered before first paint | **607.3 kB** | JS 427.2 (75%), fonts 134.7 (24%), HTML 7.1 |
| — effective throughput | **49.8 kB/s** | matches the Slow 3G preset's 51.2 kB/s |

**The throughput constant is the useful part: ~49.8 kB/s means every 49.8 kB
removed from the pre-paint set is worth ~1.0 s of FCP.** Size a change against
that before building it.

## Read the waterfall, never the duration columns

`measure-site.mjs` prints, after the byte tables:

1. **`waterfall`** — every request as start→end ms from the first request.
2. **`competing for the pipe while the stylesheet downloads`** — each request's
   bytes apportioned across its own start..end and integrated over the
   stylesheet's window, i.e. the payload first paint actually waited on.

⛔ The `15 heaviest` / `10 slowest` tables report **duration, not arrival
order**. A 9,078 ms download that started at 19 s reads exactly like one that
started at 0 s. On 2026-08-18 that misreading pointed an investigation at GTM
(which Phase 1 had already moved safely behind first paint) and then at
framer-motion, whose chunk *finished* after the stylesheet — while in fact it
had been downloading alongside it the whole time and stealing bandwidth.
**Arrival order undercounts; contention is the metric.**

## Barrel imports are the landing's dominant JS cost (2026-08-18)

Measured, not assumed: `@/components/ui` (43 re-exports) reached
`NotificationBell` → `@/hooks` (53 re-exports) → the whole Post Reply feature,
and four other UI components reached `@jawab24/shared`. Together that put
**147.7 kB gzip** of authed-app code on a public marketing page — 8588
(libphonenumber-js + zod) 66.1 kB, 2115 (radix popover + floating-ui + date-fns)
32.5 kB, 8389 (the UI barrel) 32.1 kB, 7280 (the shared barrel) 20.0 kB, 2182
(notifications) 4.7 kB. Landing client JS+CSS: **440.6 → 292.9 kB gzip (−34%)**.

⛔ **`@jawab24/shared` is compiled to CommonJS** (`"module": "commonjs"`), with
no `exports` map and no `sideEffects: false` — **webpack cannot tree-shake
CommonJS**, so one named import pulls the entire barrel. A single regex
constant (`PHONE_REGEX`, imported by `lib/whatsapp.ts`) was charging every
public page 66.1 kB. Until that package ships an ESM build, treat any
`@jawab24/shared` import on a public path as importing all of it.

Pinned by `frontend/src/__tests__/perf/publicPageBarrels.test.ts`, which walks
the real value-import graph — the cost arrives transitively, so grepping one
file does not find it.

## Open levers, measured but not taken

- **`_next/static` is served gzip, not brotli** (`/api/*` IS brotli; verified
  with `curl -I -H 'Accept-Encoding: br, gzip'` on a real chunk). Brotli on the
  landing's JS+CSS is 292.9 → 248.9 kB = **44 kB ≈ 0.9 s**. Fonts are woff2 and
  gain nothing. This is an nginx change, not a code change. Note this is NOT
  the previously rejected `_next/data` brotli lever (that one was worth 0.04 s)
  — different asset class.
- **134.7 kB of font preloads sit in the pre-paint set** (4 files, ~24% of it).
  On `/ar` that includes the English body font; on `/en`, Cairo. `next/font`
  preloads per-font, not per-locale. Dropping a preload moves the fetch behind
  the stylesheet (`display: 'swap'` already set) — worth ~2.7 s, but the CLS
  budget is 0.1 and Cairo has no `adjustFontFallback`. Measure CLS on both
  locales before taking it.
