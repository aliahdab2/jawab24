# Play Store listing assets (Gradle Play Publisher)

Everything under `listings/` is published to Google Play by GPP on each release
(`play { track = 'internal'; defaultToAppBundles = true }` in `app/build.gradle`).
Anything NOT in this tree has to be uploaded by hand in Play Console, which means
nobody can review it, diff it, or notice when it goes stale.

```
listings/
  ar/graphics/feature-graphic/main.png      1024×500, bilingual, shared with en-US
  ar/graphics/phone-screenshots/1.png …     Arabic UI captures
  en-US/graphics/feature-graphic/main.png   byte-identical to the ar copy
  en-US/graphics/phone-screenshots/1.png …  English UI captures
```

## Why both locales need their own screenshots

The default listing language is **en-US**; **ar** is the additional language. Graphics are
per-locale and fall back to the default, so an Arabic-only set means anyone browsing Play in
English sees English copy over Arabic UI images. The feature graphic sidesteps this by
carrying both languages in one image — UI screenshots cannot, so they need two sets.

Arabic is the higher-value set: the target markets are Saudi, UAE, Kuwait, Bahrain, Oman,
Qatar, Egypt and Jordan.

## Play's requirements

| | |
|---|---|
| Count | 2 minimum, 8 maximum per locale |
| Size | 1080×1920 minimum, 16:9 or taller |
| Format | PNG or JPEG, ≤ 8 MB each |
| Ordering | GPP publishes in filename order — `1.png`, `2.png`, … |

## ⛔ Never capture a real merchant's data

These images go on a public store page. Real conversations carry real customer names.
**Capture only from seeded demo data** (`backend/src/plugins/demo/seedData.ts`, reachable via
`POST /auth/demo` when `DEMO_MODE_ENABLED=true`), never from a production merchant account.

## Known gap: no WhatsApp screenshot

The short description leads with WhatsApp and the feature graphic shows three channel icons,
but no screenshot proves the channel exists. The demo seed cannot currently supply one —
it has no WhatsApp page and no WhatsApp thread, only a `social.whatsapp` number in the
Business Info fixture (`seedData.ts`). Adding a WhatsApp page + thread to the demo seed is a
prerequisite for that capture, and is worth doing on its own merits: WhatsApp is positioned
as the primary channel and the demo does not show it at all.
