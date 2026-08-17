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
