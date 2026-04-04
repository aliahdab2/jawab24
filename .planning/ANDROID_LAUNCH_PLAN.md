# Android App Launch Plan

> **Created:** 2026-04-04
> **Status:** Phase 5 in progress — Play Console account created, identity verification pending (submitted 2026-04-04)
> **Goal:** Launch Jawab24 on Google Play Store while waiting for Meta FB/IG approval
> **Companion plans:** `WHATSAPP_PLAN.md` (WhatsApp frontend), `ECOMMERCE_POWER_FEATURES_PLAN.md` (e-commerce features)

## Context

Jawab24's Android app is built with Capacitor 8 wrapping a Next.js 15 frontend. The native shell is well-architected: push notifications (FCM), deep links, in-app updates, Sentry crash reporting, edge-to-edge layout, safe area handling, keyboard management, and Facebook OAuth are all implemented.

Meta approval for Facebook/Instagram is pending. WhatsApp backend is complete but the frontend connection UI isn't built yet. **This plan focuses on getting the Android app production-ready and published on Google Play while that approval is in progress.**

## Current State Audit

### What's Working ✅
- Capacitor 8.0.0 with all critical plugins (push, keyboard, status bar, splash, secure storage, browser, network, haptics, voice recorder)
- Native Android project: Gradle 8.13, SDK 36, minSdk 24
- Push notifications via Firebase Cloud Messaging (pre-prompt UX, 7-day cooldown, per-type tap routing)
- Deep links: custom scheme (`com.jawab24.app://`) + HTTPS universal links, cold start (`getLaunchUrl`) + warm start (`appUrlOpen`)
- Edge-to-edge: transparent status bar, safe area CSS fallback for Android
- Keyboard: iOS uses `KeyboardResize.None`, Android overrides to `Body` at runtime
- Back button: WebView history navigation + double-press exit on root screens
- In-app updates: Google Play flexible update flow
- Sentry: native ANR detection + JS error capture
- Network: offline banner + auto-refresh on reconnect
- Facebook Login: SDK + CustomTab activity configured
- Signing: release keystore configured via `local.properties`
- ProGuard/R8: minify + resource shrinking enabled for release

### What Needs Work

| Issue | Severity | Details |
|-------|----------|---------|
| No WhatsApp connection UI | HIGH | Backend complete, frontend not started (see `WHATSAPP_PLAN.md` Phase 3) |
| `google-services.json` committed | LOW | Standard Firebase practice — API key is restricted by app signing. Not a real risk. |
| ~~`gradle.properties` has machine-specific Java path~~ | ~~MEDIUM~~ | ✅ Fixed — removed hardcoded path, uses `JAVA_HOME` env var |
| Certificate pinning not enabled | MEDIUM | Config prepared in `network_security_config.xml` but commented out |
| No Play Store listing assets | HIGH | Screenshots + feature graphic still needed. Descriptions drafted in `.planning/play-store-listing.md` |
| ~~Version code is 2~~ | ~~LOW~~ | ✅ Bumped to versionCode 3, versionName 1.1.0 |
| ~~Landscape nav bar overlap~~ | ~~HIGH~~ | ✅ Fixed — native-landscape-spacer pushes buttons clear of Android nav bar |
| ~~Login page not scrollable in landscape~~ | ~~HIGH~~ | ✅ Fixed — max-h-[100dvh] constraint enables scroll |
| ~~Android nav bar opaque~~ | ~~MEDIUM~~ | ✅ Fixed — now transparent for edge-to-edge display |
| No CI/CD for Android builds | MEDIUM | Only local build via `npm run build:mobile:clean` |
| StatusBar style not synced on theme change | LOW | Style determined by pathname — dark mode toggle doesn't update StatusBar |

---

## Phase 1: Build & Signing Pipeline (Day 1-2)

### 1a. Fix Machine-Specific Gradle Properties ✅

~~**Problem**: `gradle.properties` hardcodes Java path.~~
**Done** — removed hardcoded path, uses `JAVA_HOME` env var.

### 1b. Version Strategy ✅

**Done** — versionCode 3, versionName 1.1.0.

### 1c. Release Build Verification ✅

**Done** — release AAB builds successfully (12MB). Tested on physical Samsung device.

### 1d. Keystore Backup & Documentation

The release keystore at the path in `local.properties` (`/Users/aliahdab/jawab24-keys/jawab24-release.keystore`) is **irreplaceable** — if lost, you cannot update the app on Play Store.

**Action items**:
- [ ] Backup keystore to a secure location (encrypted cloud storage, NOT git)
- [ ] Document keystore alias and location in a secure note (not in repo)
- [ ] Consider Google Play App Signing (lets Google manage the upload key — safer)

---

## Phase 2: Play Store Compliance (Day 2-3)

### 2a. Data Safety Section

Google Play requires a Data Safety form. Based on the codebase, Jawab24 collects:

| Data Type | Collected | Shared | Purpose |
|-----------|-----------|--------|---------|
| Name | Yes (Facebook profile) | No | Account identity |
| Email | Yes (Facebook profile) | No | Account identity |
| Phone number | Yes (OTP + WhatsApp) | No | Auth + WhatsApp connection |
| Messages | Yes (FB/IG/WA messages) | No | Core app functionality |
| Device tokens | Yes (FCM push token) | No | Push notifications |
| Crash logs | Yes (Sentry) | Yes (Sentry) | App stability |
| App interactions | Yes (analytics) | No | App improvement |

**Encryption**: All data transmitted over HTTPS (cleartext blocked in `network_security_config.xml`). Sensitive data encrypted at rest (`ecommerceCrypto.ts`, `capacitor-secure-storage-plugin`).

**Account deletion**: Already implemented at `data-deletion.tsx` — compliant with Google Play requirements.

### 2b. Privacy Policy & Terms

**Already exists**: `privacy.tsx` and `terms.tsx` pages at `jawab24.com/privacy` and `jawab24.com/terms`.

**Action**: Verify these URLs are publicly accessible (not gated behind auth). Play Store needs direct links.

### 2c. Content Rating

Submit IARC content rating questionnaire on Play Console. Jawab24 is a business tool — expected rating: **Everyone**.

### 2d. Target Audience

**Not** designed for children. Select "13+" or "All ages" (business app). Do NOT check "Designed for children" — this triggers COPPA requirements.

---

## Phase 3: Play Store Listing Assets (Day 3-4)

### 3a. Required Assets

| Asset | Spec | Notes |
|-------|------|-------|
| App icon | 512×512 PNG, 32-bit, no alpha | Already have adaptive icon (`ic_launcher_foreground.xml`) — export hi-res |
| Feature graphic | 1024×500 PNG/JPG | Hero image shown at top of listing |
| Phone screenshots | Min 2, 16:9 or 9:16, 320-3840px | Need at least: dashboard, messages, settings, integrations |
| Tablet screenshots | Optional but recommended | Same screens, tablet viewport |
| Short description | Max 80 chars | AR: "ردود ذكية تلقائية على رسائل واتساب وفيسبوك وانستغرام" / EN: "Smart auto-replies for WhatsApp, Facebook & Instagram DMs" |
| Full description | Max 4000 chars | Feature list, integrations, AI capabilities |

### 3b. Store Listing Localization

Google Play supports per-language listings. Create both:
- **Arabic (ar)**: Primary listing — RTL, targeting MENA market
- **English (en-US)**: Secondary listing

### 3c. Screenshots Strategy

Capture from actual app on a clean device/emulator:
1. **Dashboard** — overview stats, message counts
2. **Messages inbox** — conversation list with filters
3. **Conversation detail** — AI reply in action
4. **Settings** — reply configuration, business hours
5. **Integrations** — connected Shopify/Salla stores
6. **Templates** — saved reply templates

**For each**: capture in both Arabic and English, both portrait orientations.

---

## Phase 4: Pre-Launch Testing (Day 4-5)

### 4a. Critical Test Matrix

| Test | What to verify |
|------|---------------|
| Fresh install | App launches, splash hides, login screen appears |
| Facebook login | OAuth flow → redirect back → dashboard loads |
| Phone login | OTP flow → phone verification → dashboard loads |
| Push notification (foreground) | Toast appears with correct message |
| Push notification (background) | System notification → tap → routes to correct screen |
| Push notification (cold start) | Tap notification when app killed → app launches → routes correctly |
| Deep link (warm) | `com.jawab24.app://dashboard` → navigates to dashboard |
| Deep link (cold) | Same URL when app killed → app launches → navigates |
| Keyboard | Input focus → keyboard appears → content scrolls → no layout jump |
| Back button | WebView history navigation works, double-press exit on root |
| Offline → online | Offline banner shows → reconnect → data refreshes |
| Landscape | All screens usable, modals scrollable, no content cut off |
| Dark mode | Theme toggle works, StatusBar icons match, all screens readable |
| RTL (Arabic) | All layouts mirrored correctly, text aligned properly |
| In-app update | Simulated update download → snackbar → install |
| Safe area (notch) | Content not hidden behind status bar or nav bar on notch devices |
| Voice recorder | Record audio → play back → send (if applicable) |
| OAuth callback | Login → Chrome Custom Tab → return to app cleanly |

### 4b. Device Coverage

Test on at minimum:
- **Budget**: Samsung Galaxy A14 or similar (Android 13, small RAM)
- **Mid-range**: Samsung Galaxy A54 or Pixel 7a (Android 14)
- **High-end**: Samsung Galaxy S24 or Pixel 8 (Android 15)
- **Tablet**: Samsung Galaxy Tab S9 (if targeting tablets)

### 4c. Performance Checks

- Cold start time: should be <3s to dashboard (after login)
- APK/AAB size: aim for <30MB (Capacitor apps are typically 10-20MB)
- Memory usage: monitor for WebView memory leaks on long sessions
- Battery: no excessive wake locks from push notification listeners

---

## Phase 5: Google Play Console Setup (Day 5-6) — IN PROGRESS

### 5a. Developer Account ✅

1. ✅ Play Console account created (Individual, aliahdab@gmail.com, Account ID: 911237902090522480)
2. ✅ $25 registration fee paid
3. ✅ Identity document uploaded (pending Google review, submitted 2026-04-04)
4. ✅ Android device verified via Play Console mobile app
5. ⏳ Phone number verification — unlocks after identity approval (2-7 days)

### 5b. App Creation (after verification)

1. Create app in Google Play Console
2. Set: App name "Jawab24", Default language "Arabic", App type "App", Free/Paid "Free"
3. Complete all declarations (content rating, target audience, data safety)

### 5c. Internal Testing Track

**Before public launch**, use Internal Testing:
1. Upload AAB (`frontend/android/app/build/outputs/bundle/release/app-release.aab`, 12MB)
2. Add team members as testers (up to 100)
3. Test the full install → use → update flow
4. Verify in-app update mechanism works from Play Store

### 5d. Closed Testing (Optional)

If you want beta feedback before public launch:
1. Create Closed Testing track
2. Invite select merchants (existing web users)
3. Collect feedback for 3-5 days
4. Fix critical issues

### 5e. Production Release

1. Upload AAB to Production track
2. Use **staged rollout** (start at 20% → 50% → 100%)
3. Monitor crash rate in Play Console (target: <1%)
4. Monitor ANR rate (target: <0.5%)

---

## Phase 6: Post-Launch (Week 2+)

### 6a. Monitor & Iterate

- **Play Console vitals**: crash rate, ANR rate, startup time
- **Sentry dashboard**: JS errors, native crashes, ANR reports
- **User reviews**: respond to all reviews within 24h (especially Arabic)

### 6b. Enable Certificate Pinning

After stable launch, uncomment pinning config in `network_security_config.xml`:
```xml
<pin-set expiration="2027-01-01">
    <pin digest="SHA-256">BASE64_HASH_HERE</pin>
    <pin digest="SHA-256">BACKUP_PIN_HERE</pin>
</pin-set>
```

Generate pin hashes from jawab24.com's certificate chain. Include a backup pin.

### 6c. CI/CD Pipeline (Recommended)

Automate Android builds with GitHub Actions:
1. On push to `main` → build debug APK → upload as artifact
2. On tag `v*` → build release AAB → upload to Play Console via Fastlane or Play Developer API
3. Run Detox/Appium E2E tests on emulator (future)

---

## WhatsApp Frontend (Parallel Track)

This is the highest-value feature to ship alongside the Android launch. See `WHATSAPP_PLAN.md` Phase 3 for full details. Summary:

| Task | Effort | Impact |
|------|--------|--------|
| "Connect WhatsApp" button on pages.tsx | 1 day | Enables WhatsApp merchants |
| Embedded Signup callback handler | 1 day | Completes connection flow |
| `POST /pages/connect-whatsapp` endpoint | 0.5 day | Stores WhatsApp credentials |
| WhatsApp row on page card + auto-reply toggle | 0.5 day | Merchant controls |
| Schema: make `facebookPageId` nullable | 0.5 day | WhatsApp-only merchants |
| Translation keys (en + ar) | 0.5 day | Full i18n support |

**Total**: ~4 days, can run in parallel with Play Store setup.

**Why this matters for Android launch**: If you launch the Android app with WhatsApp support from day one, you immediately compete with LetsBot on their own channel — and with a better AI. Without it, the Android app only works for merchants with approved FB/IG pages.

---

## Timeline Summary

| Day | Tasks | Status |
|-----|-------|--------|
| 1-2 | Fix gradle properties, version bump, release build verification | ✅ Done |
| 2-3 | Landscape layout fixes, edge-to-edge nav bar, login page scroll | ✅ Done |
| 3-4 | Play Console account setup, identity verification | ✅ Submitted, awaiting approval |
| 4-7 | ⏳ **BLOCKED** — waiting for Google identity verification (2-7 days) |  |
| 7-8 | Create app, complete data safety + content rating, upload AAB to Internal Testing | Next |
| 8-9 | Store listing assets (screenshots, descriptions, feature graphic) | Next |
| 9-10 | Device testing via Internal Testing track | Next |
| 10+ | Staged production rollout, monitoring | Future |
| Parallel | WhatsApp frontend (4 days, independent track) | Not started |

**Current blocker: Google identity verification (submitted 2026-04-04, ETA 2-7 days).**

---

## Files to Modify

| File | Change |
|------|--------|
| `frontend/android/gradle.properties` | Remove hardcoded Java path |
| `frontend/android/app/build.gradle` | Bump versionCode/versionName, add AAB build config |
| `frontend/package.json` | Add `build:android:release` script |
| `frontend/android/app/src/main/res/xml/network_security_config.xml` | Enable cert pinning (Phase 6) |

## New Assets Needed

| Asset | Format | For |
|-------|--------|-----|
| App icon 512×512 | PNG | Play Store listing |
| Feature graphic 1024×500 | PNG/JPG | Play Store listing |
| Phone screenshots (6+) | PNG | Play Store listing (AR + EN) |
| Short description | Text | Play Store (AR + EN) |
| Full description | Text | Play Store (AR + EN) |
