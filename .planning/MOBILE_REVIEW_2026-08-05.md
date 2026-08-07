# Mobile App Review & Test Plan — 2026-08-05

> **Scope:** `frontend/` — the Capacitor shell, app lifecycle, keyboard, safe areas, layout,
> offline behaviour, push notifications. Backend and the AI reply path are out of scope.
> **Pinned to:** `main @ 6132be59` (re-verified against `30a384d1`; only the v2.0.25 release
> commit sat between, and it touched none of the reviewed files).
> **Platform:** Capacitor 8 · Android 2.0.25 at review time · iOS unshipped.
>
> 17 findings — **4 measured in a real browser, 13 traced through the source.**
> 81 proposed tests across three layers.

---

## Status ledger

The single most useful thing in this document. Update it whenever a finding moves.

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| M1 | Critical | Native shell re-initializes on every navigation; Android back exits the app from any screen | ✅ **Fixed** — PR #641, plus #642 for the counter it exposed. ⏰ **Unverified on a device** (MOB-11) |
| M2 | High | Push breaks silently after a re-login, and can register to the wrong account | 🔴 Open |
| M3 | High | Offline banner is painted over by the fixed header — nobody ever sees it | ✅ **Fixed** — moved inside `<main>`; verified in a browser across 24 cells |
| M4 | High | Notification language pinned to Arabic in-app regardless of the user | 🔴 Open |
| M5 | Medium | Reply-mode selector clipped off-screen on 360 px phones | 🔴 Open |
| M6 | Medium | Bare `landscape:` also matches desktop — 8 descriptions hidden from most users | 🔴 Open — **has already cost a blocked deploy**, see below |
| M7 | Medium | Android back does not close six panels and overlays | 🔴 Open |
| M8 | Medium | "More" overlay claims `aria-modal` but does not trap focus | 🔴 Open |
| M9 | Medium | Keyboard measurement baseline is not refreshed on rotation | 🔴 Open |
| M10 | Medium | Eight dashboard routes get the wrong status-bar icon colour | 🔴 Open |
| M11 | Medium | Tapping a notification with an expired session loses the destination | 🔴 Open |
| M12 | Low | Notification pre-prompt timer is never cleared | 🔴 Open |
| M13 | Low | ARIA labels hardcoded in English in the mobile shell | 🔴 Open |
| M14 | Low | No `aria-current` on the active bottom-nav tab | 🔴 Open |
| M15 | Low | `min-h-screen` on the three store-onboarding pages | 🔴 Open |
| M16 | Low | iOS: no `NSCameraUsageDescription` despite image-upload fields | 🔴 Open — **blocker before iOS launch** |
| M17 | Low | No background session validation in-app | 🔴 Open |

### What happened after the review (2026-08-05)

- **M1 fixed and shipped** — PR #641 (`routerRef` at the two remaining direct uses, `router`
  dropped from the dependency array, `navDepth` hoisted to a ref, back decision extracted to
  `lib/nativeBackButton.ts`).
- **#641 exposed a second bug (PR #642).** Un-freezing `navDepth` turned on arithmetic that had
  never executed: Next emits `routeChangeComplete` for **backward** navigation too, so the back
  handler's decrement was cancelled by the increment from the navigation it triggered. Net zero —
  the counter could never decrease. Cured with `router.beforePopState`.
  **Lesson worth carrying: when a fix un-freezes a variable, audit the code that variable feeds.
  It has never run.**
- **M6 stopped being theoretical.** The `landscape:hidden` on `KnowledgeBasePanel.tsx:294` hid the
  element that a renamed i18n string ("Products & Services" → "About your business") made a loose
  Playwright locator resolve to. Result: a red `main` that blocked production deploy until PR #643.
  M6 is no longer only a UX cost.
- **Android 2.0.26 (20026)** shipped to the internal track carrying #641 + #642 — the first build
  in which the back button can actually be tested. *(Probed 2026-08-07: 2.0.26 is now live in
  **production**, status `completed`. It was promoted before MOB-11 ran — run it anyway.)*

### 2026-08-07 — M3 fixed, and native-only findings became browser-measurable

**M3 is fixed.** The banner now renders inside `<main>`, which already carries `pt-header`. That
puts it below the fixed header while keeping it in normal flow, so it is visible *and* still pushes
the content down the way it always did. One render site covers both chrome variants. Guard:
`frontend/test/mobile/offlineBannerPlacement.test.ts` (5 assertions, all confirmed red against the
pre-fix source before being kept).

**A first attempt shipped a second bug, and the browser caught it.** Lifting the banner into the
fixed header layer made it visible and passed the occlusion check — while covering the page
heading. Only the screenshot showed it. *An occlusion assertion alone is not enough; also assert
that the thing you made visible does not hide something else.* The matrix now measures both.

⭐ **The technique that unblocks the other eight native-only findings.** Nine of the 17 sit behind
`isNativePlatform()`, which reads `window.Capacitor`. Stubbing that global does **not** work —
`@capacitor/core` overwrites it on import. Two things must both be true instead:

1. open the app's own gate in `lib/capacitor.ts`, and
2. keep `getPersistStorage()` on `localStorage` — on native it switches to `SecureStoragePlugin`,
   which has no usable web implementation, so a seeded session is silently ignored and every route
   redirects to `/login`. *That one cost most of the debugging.*

With both, the **entire native path runs in desktop Chrome**: real React, real component, real
`@capacitor/network` web implementation, and `context.setOffline(true)` drives the store through
the production code path. Capacitor's own runtime still reports `platform=web`, so plugins keep
their web implementations rather than hanging on an absent native bridge.

This was done with a temporary patch, reverted before commit. **The permanent form belongs in the
Part A work and needs no production change:** install a `defineProperty` trap on `window.Capacitor`
from `addInitScript`, so when `@capacitor/core` assigns the real object the trap returns a proxy
with `isNativePlatform()` overridden. Storage still needs an answer — probably resolving
`getPersistStorage` lazily per call rather than caching at first use.

**M3 measured, 24 cells** — 4 viewports × 2 locales × 3 routes, all `found · visible · clears-h1`:

```
360x800p / 390x844p / 414x896p portrait   banner y = 64..96
844x390l landscape                        banner y = 80..112
before the fix, 390x844 /en/settings      banner y = 0..32, elementFromPoint → the header DIV
```

**Two things the matrix turned up for free.** First, **M5 reproduced independently**: `/settings`
overflows 32 px at 360 and 2 px at 390 — matching the original measurement exactly — and it is
**English-only** (Arabic reads 0 at every width), which the review did not record. Second, in
landscape the content column starts at 80 px while the landscape header is 40 px tall; the banner
just follows the flow, so this is pre-existing `main` padding, not something M3 introduced. Worth a
look, not yet a finding.

---

## 00 · How to read this

Every finding carries one of two badges, and the distinction matters — it separates what can be
acted on immediately from what should be confirmed on a real device first.

- **MEASURED** — reproduced in a real browser during the review; the numbers are quoted under the
  finding. These are observations, not inferences.
- **SOURCE-TRACED** — derived from the code and its dependencies by following the mechanism step by
  step. The reasoning is given in full so it can be checked, but the *symptom* was not observed on a
  device or emulator, because the native paths (Capacitor plugins, the back button, FCM) do not
  exist in a desktop browser.

**One finding was dropped, and the reason is worth recording.** An early pass flagged that
bottom-nav button labels lose their accessible name in landscape. That was true at `3b630b7b`. A
`git pull` moved the working copy to `6132be59` mid-review, and PR #639 had changed that exact line
from `max-lg:landscape:hidden` to `max-lg:landscape:sr-only` — fixing it. The finding was dropped
because it had been addressed, not because it was wrong. **Do not re-raise it.**

> ⚠️ That same mid-review `git pull` poisoned three line citations, because a `Read` returned content
> that no longer matched the file. **Reviewing in the main checkout is as unsafe as editing in it.**
> Pin `git rev-parse HEAD` at the start, re-check it at the end, and re-derive every `file:line` with
> grep before publishing.

---

## 01 · Critical

One finding. It sits in the shared native shell that every screen passes through, so its blast
radius is the whole app.

### M1 — Native shell re-initializes on every navigation; Android back exits the app from any screen

**Severity:** Critical · **SOURCE-TRACED** · **Status: fixed in #641/#642, unverified on device**

**Location:** `frontend/src/pages/_app.tsx:323` — `useEffect(…, [hasHydrated, queryClient, router])`

**Mechanism.** In the Next pages router, `useRouter()` does not return an identity-stable object.
`next/dist/client/index.js:237` passes `value={makePublicRouterInstance(router)}` inline in the JSX,
and that function (in `next/dist/client/router.js`) constructs a fresh object on every call. Since
the provider re-renders on every route change, `router`'s identity changes each time — so the effect
re-runs, cleanup and all.

**Consequences.**

1. **The back button.** `navDepth` was declared inside `initNativePlatform`, so it returned to `0` on
   every navigation. The handler's condition is
   `if (isRootScreen || navDepth === 0) App.exitApp()` — meaning back closed the app from settings,
   from leads, from business info, from everywhere. Worse than a plain reset: the cleanup removed the
   `routeChangeComplete` listener before Next fired it, and the replacement was not registered until
   several `await`s later, so the increment was lost outright.
2. **The keyboard.** `setupKeyboard()` ran again and re-captured `baseline = window.innerHeight`.
   Navigating with the keyboard open on a *resize* WebView captures an already-shrunken baseline,
   corrupting the `shrank` arithmetic that `--keyboard-height` depends on until the next keyboard
   hide.
3. **Churn.** Back, app-state, network and keyboard listeners were torn down and re-registered on
   every navigation, and `SplashScreen.hide()` and `Network.getStatus()` re-fired each time. Two fast
   consecutive navigations could leave a slower, still-incomplete init pushing its listeners into the
   newer array — producing duplicate handlers.

**Fix (shipped).** Lines 271 and 275 were the only two places left inside the effect still using
`router` directly; everything else already went through the `routerRef` that exists for exactly this
purpose. Convert those two, drop `router` from the dependency array, and hoist `navDepth` to a ref so
it survives regardless.

**Direct verification.** The identity step was tested against the installed Next, not assumed:

```
makePublicRouterInstance(sameRouter) × 2
a === b               → false   ← new identity on every call
a.events === b.events → true    (static, stable)

next/dist/client/index.js:237  value={makePublicRouterInstance(router)}   ← inline in JSX
next/dist/client/index.js:569  jsxs(AppContainer, …)                      ← via doRender on every navigation
```

The chain is therefore fully established: every navigation re-renders `AppContainer` → a fresh call →
a new `router` identity → the effect re-runs.

**What remains unobserved.** `initNativePlatform` returns early when `!isNativePlatform()`, so the
entire block is inert in a desktop browser. Verification is on-device, via **MOB-11**.

---

## 02 · High

### M2 — Push notifications break silently after a re-login, and can reach the wrong account

**Severity:** High · **SOURCE-TRACED**

**Location:** `frontend/src/lib/notifications.ts:246` (`tapListenerRegistered`) and `:264`
(`pushListenersRegistered`) — module-level flags that are never reset. And
`frontend/src/lib/authManager.ts:105` — `logout()` does not clear them.

**Mechanism.** User A logs out and user B logs in within the same process. `initPushNotifications(B)`
reaches `registerPushListeners(B)`, which returns immediately because the flag is still raised — so
`PushNotifications.register()` never runs again and device B is never registered. On the next
foreground, `refreshPushRegistration()` *does* call `register()`, which fires the `registration`
listener — and that listener still closes over **A's token** from the moment it was registered. At
that point `registerTokenWithBackend` sends this device's FCM token under A's credentials.

**Impact.** B receives no push notifications at all, and A's notifications may arrive on B's device.
The same defect quietly breaks token refresh whenever the JWT rotates — every `register-token` call
is answered with a `401`, and the error is swallowed into Sentry.

**Fix.** Reset both flags inside `authManager.logout()`, and make `registerTokenWithBackend` read the
token from the store at call time rather than holding the value it was created with.

### M3 — Offline banner is covered by the fixed header — nobody ever sees it

**Severity:** High · **MEASURED** · **Status: fixed 2026-08-07, verified in a browser**

**Location:** `frontend/src/components/layout/DashboardLayout.tsx:188` renders `<OfflineBanner />` as
the first in-flow element inside `.dashboard-scroll-root` (line 186), while the mobile header at line
256 is `fixed top-0 inset-x-0 … z-40`.

**Mechanism.** The banner is `position: static`, so its `z-50` class has no effect — `z-index` does
nothing without positioning. The fixed header paints over it. And because `OfflineBanner` returns
`null` unless `isNativePlatform()` holds, the only context in which it renders is the same context in
which it is covered. The user-visible result of losing the network is an unexplained downward shift
of the content, with no message.

**Measurement.** 390×844 on `/en/settings`, injecting the banner's own markup at its own position in
the element tree:

```
bannerRect { top: 0, bottom: 32 }
headerRect { top: 0, bottom: 57 }
elementFromPoint(banner centre)
  → DIV.lg:hidden fixed top-0 inset-x-0 h-14 …
covered → true
```

**Fix (shipped).** Neither of the two options first proposed here. Rendering it inside the fixed
header layer *was* tried and made it visible — and covered the page heading, because a fixed layer
reserves no space. Offsetting a `fixed` banner by `--header-height` needs geometry kept in sync with
a header whose real height (`h-14` + safe area) does not match that variable anyway.

What shipped instead: move it inside `<main>`, which already carries `pt-header`. The header is
cleared for free, the banner stays in normal flow and keeps pushing content down exactly as before,
one render site serves both chrome variants, and there is no arithmetic to drift.

**Update the placement contract, not just the class list.** The banner deliberately carries no
positioning of its own, so *where it is rendered* is the whole fix — hence a source-level guard
rather than a style assertion.

### M4 — Notification language is pinned to Arabic in-app, whatever the user's language

**Severity:** High · **SOURCE-TRACED**

**Location:** `frontend/src/lib/notifications.ts:355` — `getAppLocale()` reads
`window.location.pathname.split('/')[1]` and falls back to `'ar'`.

**Mechanism.** The mobile build is a static export that sets `i18n: undefined` (in
`frontend/next.config.js`, i18n is disabled whenever `IS_MOBILE_BUILD` is set, because Capacitor
cannot do server-side locale routing). App routes therefore never carry an `/en` or `/ar` prefix, the
path check never matches, and the function always returns `'ar'`.

**Impact.** Two surfaces, both mobile-only. First, in-app foreground notification toasts are always
Arabic (`handleForegroundNotification`). Second, `getNotifications()` sends `lang=ar`, so the entire
notification-bell list comes back in Arabic for an English-speaking merchant. The web build is
unaffected — which is exactly why this stayed hidden.

**Fix.** Read `useUIStore.getState().language` first — it is the in-app source of truth, and
`_app.tsx` already treats it as such in `effectiveLocale`. Keep the URL path as a web fallback.

---

## 03 · Medium

### M5 — Reply-mode selector is clipped off-screen on 360 px phones

**Severity:** Medium · **MEASURED**

**Location:** `frontend/src/components/settings/AutoReplyBoardCard.tsx:186` —
`inline-flex rounded-xl border … overflow-hidden` on the element with `role="radiogroup"`.

**Mechanism.** The group is sized by its content, with no `max-w-full`, no wrapping and no horizontal
scroll of its own. Its intrinsic width is 352 px, and the card's padding puts its start edge at 40 px,
so it demands 392 px. The parent's `overflow-x-hidden` **clips rather than scrolls** — the tail of the
second option and part of the "recommended" badge are simply cut off and unreachable, with no
scrollbar to hint that anything is missing.

**Measurement.** Horizontal-overflow sweep across 8 authenticated routes × 360 and 390 px. Only
`/settings` overflowed:

```
/en/settings @360  overflowPx = 32   offender right = 392
/en/settings @390  overflowPx = 2    offender right = 392
all 14 other route × width combinations → overflowPx = 0
```

360 px is very common on Android — this is not an edge case.

**Fix.** `max-w-full` with `flex-wrap`, or stack the options vertically below `sm`. Wrapping beats a
scroll container here: a two-option radio group that scrolls horizontally hides the option itself.

### M6 — Bare `landscape:` also matches desktop — eight descriptions hidden from most users

**Severity:** Medium · **MEASURED** · ⚠️ **has already caused a blocked deploy (see status ledger)**

**Mechanism.** Tailwind's `landscape:` variant is `@media (orientation: landscape)`, which holds for
essentially every desktop browser window — not only a rotated phone. Eight sites use
`landscape:hidden` without the `max-lg:` qualifier that would confine it to mobile. The intent, clear
from the surrounding code, is to reclaim vertical space on a rotated phone; the actual effect is to
hide the text on every desktop screen as well, leaving it visible only in portrait on mobile.

**Measurement.**

```
1440×900 desktop → (orientation: landscape) matches = true
                   (min-width:1024px) guard = absent
390×844  phone   → (orientation: landscape) matches = false
```

**Sites.**

- `settings/NotificationsCard.tsx:31`
- `settings/BusinessHoursCard.tsx:82`
- `settings/GreetingMessageCard.tsx:29`
- `settings/ReplyDelayCard.tsx:25`
- `settings/LimitFallbackMessageCard.tsx:52`
- `pages/settings.tsx:518`
- `knowledge-base/KnowledgeBaseModal.tsx:60`
- `knowledge-base/KnowledgeBasePanel.tsx:294`

`DashboardLayout.tsx` gets this right by using `max-lg:landscape:` — it is the model to copy.

> **Fix note (added 2026-08-05):** fix all eight together with the A3.1 static gate. Fixing
> `KnowledgeBasePanel.tsx:294` alone would make the now-visible description match the loose locator in
> `knowledge-base.spec.ts`, so that test would pass while silently no longer checking the label.

### M7 — Android back does not close six panels and overlays

**Severity:** Medium · **SOURCE-TRACED**

**Mechanism.** `useModalBackHandler` is the registry the back handler in `_app.tsx` draws on. It is
wired to `Modal`, `SidePanel`, `KnowledgeBaseModal`, `TestSmartReplyModal`, `BusinessFactSheet` and
`BusinessHoursSheet` — but **not** to `CatalogImportSheet`, `CatalogItemFormSheet`, `KbCleanupSheet`,
`ListRowSheet`, the "More" overlay in `DashboardLayout`, or the logout confirmation. Back in any of
those falls through to `router.back()` — or exits the app outright, by way of M1.

**Note.** The comment-detail and message-detail modals are correctly excluded: they are URL-driven
(`?conversation=…`), which is the pattern the hook's own documentation prefers.

### M8 — "More" overlay declares `aria-modal` but does not trap focus

**Severity:** Medium · **MEASURED**

**Location:** `DashboardLayout.tsx:514` — `role="dialog" aria-modal="true"`. The `useFocusTrap` hook
exists in `hooks/` but only `ui/Modal.tsx` uses it.

**Measurement.** 25 Tab presses with the overlay open, at 390×844:

```
tab stops that escaped the dialog → 18
first escapes: "Need help?" · <body> · "Notifications"
             · "🇸🇦 العربية" · "🇬🇧 English"
```

Focus moves straight into the page behind the overlay — the page the `aria-modal` contract says is
inert.

**Fix.** Apply `useFocusTrap` to the overlay panel and to the logout confirmation. Both also need
registering in the back handler from M7.

### M9 — Keyboard measurement baseline is not refreshed on rotation

**Severity:** Medium · **SOURCE-TRACED**

**Location:** `frontend/src/lib/keyboardSetup.ts:115` — `baseline` is captured once at init and
refreshed only when the keyboard hides (`didHide` on Android, `willHide` on iOS). There is no
`orientationchange` or `resize` listener.

**Mechanism.** Rotating with the keyboard closed fires no hide event, so `baseline` keeps the portrait
`innerHeight`. On the next open, `shrank = baseline − innerHeight` is a large positive number
unrelated to the keyboard, which drives the fallback `Math.max(0, nativeHeight − shrank)` to zero. On
an *overlay* device — or on iOS at `keyboardWillShow`, before the visual viewport shrinks — the modal
is placed behind the keyboard until the viewport catches up or the first hide corrects the baseline.

**Context.** This module is the best-tested part of the mobile frontend — 34 cases covering shrink,
overlay, viewport silence, the dismiss tail and clamping. Rotation is the single axis missing from
both the implementation and `keyboardSetup.test.ts`. M1 made it worse: navigating with the keyboard
open captured a shrunken baseline.

### M10 — Eight dashboard routes get the wrong status-bar icon colour

**Severity:** Medium · **SOURCE-TRACED**

**Location:** `_app.tsx:256` — `DARK_HEADER_PAGES` lists dashboard, comments, messages, pages,
settings, pricing, auth, terms and privacy.

**Mechanism.** Every authenticated route renders the same `DashboardLayout` header, but the list is
hand-maintained and has fallen behind the router. `/leads`, `/business`, `/catalog`, `/team`,
`/help`, `/integrations`, `/ecommerce-analytics` and `/checkout` are missing from it, so they get
`Style.Light` — dark icons on a dark header.

**Fix.** Invert the rule rather than extending the list: derive it from whether the route uses
`DashboardLayout`, and keep an explicit list only for the light public pages. A hand-maintained list
of routes will fall behind again.

### M11 — Tapping a notification with an expired session loses the destination

**Severity:** Medium · **SOURCE-TRACED**

**Location:** `DashboardLayout.tsx:146` — `router.push('/login')`, with no `redirect` parameter.

**Impact.** Tapping a push notification for a specific conversation with an expired session resolves
the deep link correctly, then the layout redirects to login, and after signing in the user lands on
the dashboard — losing the conversation the notification was about. The login page already supports
`?redirect=`; only the layout fails to pass it.

---

## 04 · Low

### M12 — Notification pre-prompt timer is never cleared

`_app.tsx:341–347` — the `return () => clearTimeout(timer)` statement sits inside a `.then()`
callback, so it is the promise's return value rather than the effect's cleanup function. The 5-second
timer therefore outlives unmount and calls `setShowPushPrompt` on a dead component.

### M13 — ARIA labels hardcoded in English in the mobile shell

`DashboardLayout.tsx:312` has `aria-label="Mobile navigation"` and `:567` has
`aria-label="Close menu"`. Both violate the no-hardcoded-strings rule, so an Arabic screen-reader user
hears English landmark names. This fix has a cost: `e2e/mobile-nav.spec.ts` pins nearly all of its
assertions to the literal string `'Mobile navigation'`, so the tests must move to a translated read in
the same change.

### M14 — No `aria-current` on the active bottom-nav tab

The active tab in `MobileNavButton` is conveyed by colour and a 2 px stroke alone. The workspace
switcher in the same file sets `aria-current` correctly (`:599`) — the tabs should match it.

### M15 — `min-h-screen` on the three store-onboarding pages

`pages/salla/onboarding.tsx:133`, `pages/shopify/onboarding.tsx:133` and
`pages/zid/onboarding.tsx:125` use `min-h-screen` (i.e. `100vh`) where the rest of the app uses
`100dvh` or `flex-1 overflow-y-auto`. On mobile browsers the URL bar makes the `vh` unit taller than
the visible area. These are merchant-facing landing pages, reached from a phone often enough to
matter.

### M16 — iOS: no `NSCameraUsageDescription` despite image-upload fields

`ios/App/App/Info.plist` declares only `NSMicrophoneUsageDescription`. Meanwhile
`comments/PostTriggerModal.tsx:876` and `knowledge-base/FileUploadButton.tsx:111` render
`<input type="file" accept="image/*">`, and the WKWebView picker offers "Take Photo". Choosing it
without a usage string terminates the app. Harmless today because iOS has not shipped — **a blocker
the moment it does.**

### M17 — No background session validation in-app

`DashboardLayout.tsx:120–141` — the background `getProfile()` check is explicitly skipped in-app. A
revoked or expired session therefore shows a fully populated UI until some other request is answered
with a `401`. The bypass is intentional (the comment notes it is for web, relying on cookies), but it
means the worst-case staleness in-app is longer than on web.

---

## 05 · What is already solid

Recorded so it does not get re-opened. These were examined and found correct.

- **RTL discipline.** No physical Tailwind directional classes across 219 components. The five hits
  for `left-` and `right-` are either symmetric centring or a documented physical drag gesture in
  `leads.tsx`.
- **Safe areas.** A single source of truth via `--sai-*` variables in `globals.css`, no direct
  `env(safe-area-inset-*)` in any component, and a JS-measured fallback for Android WebViews that
  report zero.
- **Keyboard height.** One writer, three signals in priority order, an animated transition via
  `@property` to damp viewport jitter, and 34 unit tests. Only rotation is missing (M9).
- **Bottom-nav accessibility.** Labels use `sr-only` in landscape rather than `hidden`, so accessible
  names survive. `NavCountBadge` pairs an `aria-hidden` mark with `sr-only` text.
- **App-to-browser bridge.** Rule 17b is followed: the tab starts at the third party, the return via
  App Link is performed by a page, and degradation is marked in-band with `launchDegraded=1`.
- **Horizontal overflow.** Seven of eight authenticated routes are clean at 360 and 390 px in the
  measured sweep. Only M5 breaks it.
- **Android manifest.** `adjustNothing` mode, rotation inside `configChanges` (so the activity is not
  recreated on rotate), an `autoVerify` App Link scoped to `/auth/app-sync`, and the `<queries>` block
  required by Android 11+.
- **CSV export and external links.** Writing to the cache directory with the native share sheet for
  Android 10+ scoped storage, and a real `completed:false` check in `AppLauncher` rather than merely
  catching the exception.

---

## 06 · Why the tests caught none of this

Coverage exists, but its *shape* leaves one specific gap — and every finding above falls inside it.

| Area | Covered today | Gap |
|------|---------------|-----|
| Keyboard maths | `keyboardSetup.test.ts` — 34 cases | No rotation axis (M9) |
| Mobile visual | `visual.spec.ts` — dashboard, comments, messages, settings; portrait, landscape, Arabic, safe areas | Screenshots only. A 32 px clip inside a card does not move the diff enough to fail (M5) |
| Mobile navigation | `mobile-nav.spec.ts` — 19 tests | Runs in the `chromium` project at mobile size only — no touch, no mobile user-agent. Hosted on `/settings` alone |
| Keyboard and modals | `keyboard-modal-layout.spec.ts` | Synthetic markup injected into `/login` — proves the styles, not the real panels |
| Authenticated routes at phone width | — | **Nothing.** The `mobile-chrome` project runs only `visual`, `landing`, `login`, `ssr`, `seo` and `keyboard-modal-layout` |
| Native-only paths | — | **Nothing.** Back button, deep links, notifications, offline, splash, background resume, permissions |
| Mobile accessibility | — | No assertions for focus trapping, `aria-current`, or landmark names (M8, M13, M14) |
| Horizontal overflow | — | No assertion anywhere — precisely why M5 reached production |

**Structural conclusion.** Nine findings (M1, M2, M4, M7, M9, M10, M12, M16, M17) sit on paths gated
behind `isNativePlatform()` or specific to the OS, so their symptoms cannot be observed in a browser
at all. The remaining eight (M3, M5, M6, M8, M11, M13, M14, M15) are browser-verifiable — and four
already were. That is not an argument against automation; it is an argument for automating everything
a browser can reach (Part A below, 24 tests) so that scarce device time goes to the nine that genuinely
need a phone.

---

## 07 · Test plan · Part A — automated

24 tests, all runnable in CI today with no device required. Each guards a specific finding, so any
regression identifies itself.

### A0 · Playwright setup

Add a fourth project so authenticated functional tests run at phone size with a real mobile
user-agent and touch enabled — today they run in `chromium` with only the viewport changed.

```js
{
  name: 'mobile-chrome-app',
  use: { ...devices['Pixel 7'] },
  testMatch: [
    'mobile-nav.spec.ts', 'mobile-overflow.spec.ts', 'mobile-a11y.spec.ts',
    'settings.spec.ts', 'comments.spec.ts', 'messages.spec.ts',
    'leads.spec.ts', 'team.spec.ts', 'pages.spec.ts', 'knowledge-base.spec.ts',
  ],
}
```

### A1 · New E2E tests

| ID | File / test | Assertion | Guards |
|----|-------------|-----------|--------|
| A1.1 | `mobile-overflow.spec.ts` — 8 routes × {360, 390, 412} px × {en, ar} | On `.dashboard-scroll-root`: `scrollWidth ≤ clientWidth + 1`, and no element's box exceeds the viewport edge | M5 |
| A1.2 | `mobile-a11y.spec.ts` — focus trap | 25 Tab presses inside each open modal never leave it: the "More" overlay, the logout confirmation, and every `DetailSheet` consumer | M8 |
| A1.3 | `mobile-a11y.spec.ts` — active tab | The tab matching the route exposes `aria-current="page"`; the other three do not | M14 |
| A1.4 | `mobile-a11y.spec.ts` — landmark names | Under `/ar/*`, the navigation landmark and close button resolve to the Arabic strings from the JSON files, not English literals | M13 |
| A1.5 | `mobile-a11y.spec.ts` — close exits | `Escape` closes every overlay in the registry and returns focus to the trigger | M7, M8 |
| A1.6 | `mobile-offline.spec.ts` | With `is-native` and `isOffline` forced, the banner is visible and `elementFromPoint` at its centre returns the banner, not the header | M3 |
| A1.7 | `mobile-offline.spec.ts` — degraded network | Under `route.abort()`, every list surface shows an error state with retry — no blank screens, no unhandled rejections | — |
| A1.8 | `responsive-variants.spec.ts` | At 1440×900, the eight `landscape:hidden` descriptions are visible | M6 |
| A1.9 | `mobile-nav.spec.ts` — extension | Rotating to 844×390 mid-session: the bar shrinks to 48 px, labels stay in the accessibility tree, no vertical clipping | — |
| A1.10 | `mobile-nav.spec.ts` — extension | The "More" overlay scrolls internally with 11 cards (an admin account) and never crosses the top safe area | — |

### A2 · New unit tests

| ID | Test | Assertion | Guards |
|----|------|-----------|--------|
| A2.1 | `keyboardSetup.test.ts` — rotation, silent-reporting device | After `orientationchange` with the keyboard closed, the next `keyboardDidShow` yields the full native height, not zero | M9 |
| A2.2 | `keyboardSetup.test.ts` — rotation, shrinking device | The same rotation still yields zero, and the `keyboard-open` class stays set | M9 |
| A2.3 | `keyboardSetup.test.ts` — re-init while open | Calling `setupKeyboard()` again with the keyboard open must not capture a shrunken baseline | M1, M9 |
| A2.4 | `notifications.test.ts` — language | With no locale in the path and store language `en`, `getNotifications` sends `lang=en` and the toast is English | M4 |
| A2.5 | `notifications.test.ts` — re-login | After `logout()`, `initPushNotifications(tokenB)` calls `PushNotifications.register()` again | M2 |
| A2.6 | `notifications.test.ts` — token freshness | A `registration` event after a token rotation sends the current credential, not the one captured when the listener was registered | M2 |
| A2.7 | `nativeInit.test.ts` (new) | Extract the native init body from `_app.tsx` into a testable module; assert it runs once across 5 simulated route changes and that `navDepth` persists across them | M1 |
| A2.8 | `nativeInit.test.ts` — back semantics | Root screen → `exitApp`; depth greater than zero → `router.back()`; open modal → `dismissTopModal` and nothing else | M1, M7 |
| A2.9 | `statusBar.test.ts` (new) | Every route rendered by `DashboardLayout` resolves to `Style.Dark`, and the public-page list resolves to `Style.Light` | M10 |
| A2.10 | `modalRegistry.test.ts` (new) | Every component rendering a `DetailSheet` or a `fixed inset-0` overlay is either registered in `useModalBackHandler` or URL-driven — as an explicit enumeration, so any new panel fails | M7 |

> **Delivered differently in #641/#642.** A2.7 and A2.8 were satisfied without the full module
> extraction: the back decision moved to `lib/nativeBackButton.ts` (pure, unit-tested, including the
> `NavDepthTracker` state machine), and the "runs once" property is pinned by a **source invariant** in
> `test/mobile/nativeInitEffect.test.ts` asserting the effect never regains an unstable dependency.
> Extracting the whole init body remains worth doing, as its own PR.

### A3 · Static gates

| ID | Gate | Rule | Guards |
|----|------|------|--------|
| A3.1 | ESLint or a CI text check | Ban bare `landscape:` in `src/` — require `max-lg:landscape:` or an inline justification comment | M6 |
| A3.2 | ESLint or a CI text check | Ban `min-h-screen` and `h-screen` outside `components/landing/` | M15 |
| A3.3 | CI text check | Ban any literal `aria-label="…"` containing a space inside `components/layout/`, forcing a `t()` call | M13 |
| A3.4 | Gate in `release-android.sh` | Extend the existing merged-manifest check to assert that every permission used by a shipped plugin has a matching iOS usage string | M16 |

---

## 08 · Test plan · Part B — device matrix

Six devices. The first three are mandatory for every release; the rest are a per-milestone sweep. Each
was chosen for the specific failure mode it exposes.

| Code | Device / setup | Exposes | Cadence |
|------|----------------|---------|---------|
| D1 | Android 11, 360×640, 3 GB RAM, throttled to slow 3G | M5 clipping, offline paths, cold-start budget, a weak WebView | Every release |
| D2 | Pixel, Android 14/15, gesture navigation | The back gesture against M1 and M7, edge-to-edge, the notification permission flow | Every release |
| D3 | Samsung with One UI, Android 13+ | The OEM keyboard quirks `keyboardSetup` was written for, and aggressive WebView storage clearing against the migration to Preferences | Every release |
| D4 | Android 10-inch tablet, both orientations | Crossing the `lg` breakpoint — sidebar versus bottom bar | Every milestone |
| D5 | iPhone SE (small) with iPhone 15 Pro (Dynamic Island) | Safe-area extremes, `KeyboardResize.None`, and M16 | Before iOS launch |
| D6 | Mobile web: Chrome on Android and Safari on iOS (no app) | M6, M15, the iOS `vh` unit, and the paths where `isNativePlatform()` is false | Every release |

> Every scenario below is run in **both Arabic and English** and in **both portrait and landscape**
> unless the step says otherwise. Arabic is the default and the majority of real traffic — treating an
> English-only pass as sufficient is a false economy.

---

## 09 · Test plan · Part C — device scenarios

57 checks across eleven areas, numbered so a bug report can cite the step. The "Guards" column ties a
step to a finding; steps without one cover behaviour that is currently correct and unprotected.

### C1 · Cold start, splash and hydration

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-01 | Force stop, remove from recents, launch | Splash on the dark background, no white flash, no spinner; dashboard within 3 s on D2 | — |
| MOB-02 | Launch with airplane mode on | Splash still disappears (3 s safety timeout), the offline banner is visible, cached shell renders | M3 |
| MOB-03 | Launch, background immediately, return after 30 s | No splash replay, no duplicate fetch storm, no `429` | M1 |
| MOB-04 | Fresh install, first launch, decline notifications | The pre-prompt appears once after ~5 s and does not repeat in the session; the recovery banner respects its 14-day timeout | M12 |

### C2 · Navigation and the hardware back button

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-10 | Dashboard → comments → messages, then press back twice | Returns messages → comments → dashboard. The app does not close. | M1 |
| MOB-11 | Dashboard → More → leads → business info, then press back | Returns to leads. **This is the primary M1 reproduction — if the app closes instead, the bug is live.** | M1 |
| MOB-12 | Open each panel in turn (catalog import, catalog item, KB cleanup, list row, "More" overlay, logout confirmation) and press back | Each closes and leaves you on the page beneath | M7 |
| MOB-13 | Back from the dashboard | The app closes — this is correct behaviour | — |
| MOB-14 | Open a message detail and press back | The modal (URL-driven) closes and the page is not left | — |
| MOB-15 | Multi-workspace account: switch workspace from the "More" panel | The panel closes, the page loads in the new workspace, badges recompute | — |

### C3 · Deep links and notification taps

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-20 | Cold start from a push notification for a conversation | Land directly on the conversation, with no intermediate dashboard frame | — |
| MOB-21 | The same with an expired session | Login, then the conversation — not the dashboard | M11 |
| MOB-22 | Warm tap with the app foregrounded on another page | Navigates without reload; any leftover auth tab is closed first | — |
| MOB-23 | Facebook page connect, full cycle | The tab starts at facebook.com; the return via `/auth/app-sync` reopens the app and closes the tab | — |
| MOB-24 | WhatsApp connect, full cycle | Same shape; check the access log for `launchDegraded=1`, which means an embedded tab ran and in-band registration cannot complete there | — |
| MOB-25 | Cancel at the Meta consent screen | Return to the app on `/login` or the originating page — never a dead tab | — |

### C4 · Keyboard

> Run all of C4 on **D3 (Samsung)** in addition to **D2** — OEM inset behaviour is the entire reason
> this code is as complex as it is.

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-30 | Open a message detail and focus the composer | The composer settles directly above the keyboard — no gap, not hidden behind it | — |
| MOB-31 | Dismiss the keyboard from MOB-30, then repeat five times | A smooth retraction every time. The June 2026 bug only reappeared from the second dismiss onward. | — |
| MOB-32 | With the keyboard open, rotate to landscape and type | The modal stays above the keyboard. **This is the M9 reproduction.** | M9 |
| MOB-33 | Rotate with the keyboard closed, then open it | Correct height from the first open — not the second | M9 |
| MOB-34 | With the keyboard open, tap a bottom-nav tab | Clean navigation; the next keyboard open on the new page is correctly positioned | M1, M9 |
| MOB-35 | Fact sheet, list-row sheet and KB modal: focus every field | All keyboard-aware; no field is ever occluded | — |
| MOB-36 | Type Arabic text in a field, then Latin text | `dir="auto"` flips per field, and the caret and placeholder follow | — |

### C5 · Layout, safe areas and rotation

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-40 | Settings on D1 (360 px), reach the reply-mode selector | Both options fully visible with the "recommended" badge intact. **M5 reproduction.** | M5 |
| MOB-41 | On every authenticated page: swipe horizontally | Nothing scrolls sideways and nothing is clipped at the end edge | M5 |
| MOB-42 | Rotate through every page, both directions | No content under the notch or the gesture bar; the bottom bar shrinks to 48 px; no double scrollbar | — |
| MOB-43 | Check status-bar icons on leads, business info, catalog, team, help and integrations | White icons on the dark header. **M10 reproduction — dark icons mean the bug is live.** | M10 |
| MOB-44 | D4 tablet, rotate across the `lg` boundary | Clean transition between sidebar and bottom bar; never a moment with both or neither | — |
| MOB-45 | Set the system font size to maximum | No clipped labels, no overlap in navigation; touch targets stay at 44 px or above | — |
| MOB-46 | Toggle system dark mode with the app open | The theme follows the system immediately; no light text on a light background anywhere | — |

### C6 · Arabic and writing direction

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-50 | Switch to Arabic and walk every page | Full mirroring; no raw translation keys; no English fallback text | — |
| MOB-51 | In Arabic: swipe a lead card | Actions appear from the same physical edge as in English — the gesture is physical by design | — |
| MOB-52 | In Arabic: trigger a toast | Appears at the bottom on the start side, clear of the bottom bar | — |
| MOB-53 | In Arabic with TalkBack: open the "More" overlay | The landmark and close button are announced in Arabic. **M13 reproduction.** | M13 |
| MOB-54 | Switch language with a panel open | No layout tearing and no loss of entered input | — |

### C7 · Network and offline

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-60 | Switch to airplane mode mid-session | The offline banner appears within a second. **M3 reproduction — a content shift with no banner means the bug is live.** | M3 |
| MOB-61 | Restore connectivity | The banner disappears and data is fetched once — not a burst that trips the rate limit | — |
| MOB-62 | Slow 3G on D1: open leads and business info | Skeletons then content. No blank screen; a 15 s timeout offers retry rather than hanging | — |
| MOB-63 | Save settings with the network cut | A translated error message, form state preserved, retry works | — |
| MOB-64 | Background for 30 minutes on mobile data, then return | Data refreshes, polling resumes as the SSE fallback, and no duplicate notification registration (throttled to an hour) | M1 |

### C8 · Authentication and session

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-70 | Log out, log in as a different user, foreground the app twice | B receives a test notification and A receives nothing on this device. **M2 reproduction.** | M2 |
| MOB-71 | Log out | Return to login with no white screen; the FCM token is removed server-side | — |
| MOB-72 | Revoke the session server-side, then use the app | The next request gets a `401` → refresh → login. No infinite loop, no stuck spinner | M17 |
| MOB-73 | Close and relaunch after 7 idle days | The session persists via Preferences, or a clean login — never a half-authenticated shell | — |
| MOB-74 | On D3: clear WebView storage from Android settings, then relaunch | Notification preferences survive (they live in native Preferences, not `localStorage`) | — |

### C9 · Push notifications

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-80 | Grant permission and send a test notification with the app foregrounded | An in-app toast in the user's language. **M4 reproduction — an Arabic toast for an English user means the bug is live.** | M4 |
| MOB-81 | The same with the app backgrounded | A system notification; tapping it opens the right screen | — |
| MOB-82 | English user: open the notification bell | The whole list is in English. **The second and more visible M4 reproduction.** | M4 |
| MOB-83 | Decline permission, enable it in system settings, return to the app | The recovery banner disappears; registration completes on the next foreground | — |
| MOB-84 | Android 13+: fresh install, confirm the system dialog appears exactly once | Preceded by the pre-prompt; declining leads to the recovery banner, not a repeated request | — |

### C10 · Media and permissions

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-90 | Record a voice note in business info; decline the microphone permission once, then grant it | A translated denial message; the granting path records and transcribes | — |
| MOB-91 | Attach an image to a post reply — choose "Take Photo" | The camera opens. **On iOS this is the M16 crash reproduction.** | M16 |
| MOB-92 | Upload a document to the knowledge base | The picker opens, content is extracted successfully, progress is visible | — |
| MOB-93 | Export leads to CSV | The native share sheet appears with a real file (from the cache directory, not Documents) | — |

### C11 · Performance

| ID | Steps | Expected | Guards |
|----|-------|----------|--------|
| MOB-95 | Cold start on D1, timing to dashboard interactivity | Under 5 s on slow 3G, under 3 s on Wi-Fi | — |
| MOB-96 | Scroll a 200-row lead list | No dropped frames and no image pop-in shifting rows | — |
| MOB-97 | Keep the app foregrounded on the dashboard for 30 minutes | No unbounded memory growth; polling backs off; battery use comparable to a browser tab | M1 |

---

## 10 · Release gate

The minimum to pass before pushing any build to an Android track, ordered by cost against confidence
bought.

1. **Automated.** All of Part A passes — including the new `mobile-chrome-app` project and the four
   static gates.
2. **Quick pass on D2.** MOB-01, MOB-10, MOB-11, MOB-30, MOB-60, MOB-80. Six checks in about ten
   minutes, covering the critical finding and two of the three highs.
3. **Small-screen pass on D1.** MOB-40, MOB-41, MOB-62.
4. **OEM keyboard pass on D3.** All of C4.
5. **Language pass.** All of C6 in Arabic, on any device.
6. **Every milestone.** Everything else in Part C, with D4.

### Suggested order of work

Take **M1 first and alone** — two lines and one ref, it sits beneath everything else, and several
other symptoms partly dissolve with it (the baseline corruption in M9, and the listener churn behind
MOB-64 and MOB-97). Then **M3 and M5**: small, measured, and independently verifiable. Then **M2 and
M4 together**, since both live in `notifications.ts` and share one fix — *read the state at call time,
not at registration time*. The low findings ride along with any change that touches their files.

> **Progress:** step 1 is done (#641 + #642) but **not yet device-verified** — and 2.0.26 reached
> production anyway, so MOB-11 is now overdue rather than pending. **M3 is done and verified in a
> browser** (2026-08-07). **M5 is next**, and it is already measured: 32 px at 360, 2 px at 390,
> English only. Then M2 + M4 together.

---

## 11 · Reproducing the measurements

The four measured findings came from temporary Playwright probes run against the dev server on port
3001 with a mocked API, reusing the authentication harness from `e2e/mobile-nav.spec.ts`. Nothing was
written into the repository. To rebuild them:

```bash
# dev server, own distDir — safe alongside a build
cd frontend && PORT=3001 NEXT_PUBLIC_API_URL=http://localhost:4999/api npm run dev
# probes live outside the repo; symlink node_modules so resolution works
ln -s "$PWD/../node_modules" <probe-dir>/node_modules
npx playwright test --config <probe-dir>/playwright.config.ts
```

The four probes were: a horizontal-overflow sweep (8 routes × 2 widths), a focus-escape counter, an
`elementFromPoint` occlusion check for the offline banner, and a media-query read at desktop and phone
sizes. They are worth promoting to `e2e/mobile-overflow.spec.ts` and `e2e/mobile-a11y.spec.ts` almost
as they stand — items A1.1, A1.2 and A1.6 above are those same probes plus assertions.

---

## Provenance

Originally published as a private artifact on 2026-08-05 (Arabic), pinned to `main @ 6132be59`.
Committed here so the findings and the plan survive outside that artifact and can be kept current.

**A note on the review process itself.** A self-audit of the first draft found nine errors — three
wrong line citations and six wrong counts — all corrected before publication. Every `file:line` in
this document was re-derived with grep rather than trusted from an earlier read, because a mid-review
`git pull` had made one `Read` return stale content. Verify a citation before acting on it; the
codebase has moved since.
