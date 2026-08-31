# Play Store listing assets (Gradle Play Publisher)

> ⚠️ **These files do NOT reach Play automatically today.** `scripts/release-android.sh`
> runs `./gradlew publishReleaseBundle`, which in GPP 3.13 uploads the **App Bundle only**.
> Listing text and graphics are published by `publishReleaseListing` (or `publishRelease`,
> which does both) — and nothing in the release path calls either.
>
> That cuts both ways:
> - **Safe:** committing or changing anything here cannot alter the live listing, so a
>   partial screenshot set can never silently replace the images already on Play.
> - **Not wired:** until someone runs `./gradlew publishReleaseListing --track <track>` or
>   uploads by hand in Play Console, this tree is version control and review only. Keep it
>   matching what is actually published, or it becomes a second source of drift rather than
>   a cure for the first.

This tree is where Play listing assets belong. Anything NOT in it exists only inside Play
Console, where nobody can review it, diff it, or notice when it goes stale.

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

## Current sets come from DIFFERENT sources — do not mistake one for the other

| set | source | numbers |
|---|---|---|
| `en-US/` | **production, the owner's live account** | real (3,179 smart replies, 664 today, 97.0% reply rate) |
| `ar/` | **local demo seed** | fixture data, fictional names |

That split is not ideal and should be closed. It exists because the dashboard locale is
pinned to `settings.dashboard_language` on the account, and on production it would not hold:
the switch needs an explicit Save (a first click silently did not persist), it rendered
Arabic once and then reverted on its own, and `/ar/comments` served a cached English page
regardless. So a full Arabic set could not be captured live.

**Customer names are blurred at capture time, as a REGION not per name.** Blurring
individual name nodes loses a race against the live inbox: an early attempt blurred 11
names and the very next capture still showed one that had arrived in between. Blur the
whole list container instead — it cannot be outrun by new rows.

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
