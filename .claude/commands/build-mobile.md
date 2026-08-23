Build the Jawab24 mobile app for Android, iOS, or both.

Arguments: $ARGUMENTS
- "android" or "a" — build Android only
- "ios" or "i" — build iOS only
- "both" or "all" — build both platforms
- "release" — build release variant (combine: "android release", "ios release")
- "clean" — clean build caches first (combine: "android clean", "ios clean release")
- "open" — iOS only: open Xcode after sync instead of CLI build
- No arguments — ask the user which platform to build

## Step 1: Parse arguments

Determine from $ARGUMENTS:
- **platform**: android | ios | both (default: ask user)
- **variant**: debug (default) | release
- **clean**: true | false
- **openXcode**: true | false (iOS "open" flag)

## Step 2: Clean (if requested)

```bash
cd frontend && rm -rf .next out
```

Android clean:
```bash
cd frontend/android && ./gradlew clean
```

iOS clean:
```bash
rm -rf frontend/ios/App/App/public/*
```

## Step 3: Build Next.js static export

Always required regardless of platform:

```bash
cd frontend && npm run build:mobile
```

If this fails:
- **«Mobile build refused: NEXT_PUBLIC_SENTRY_DSN is not set»** — the guard in
  `frontend/scripts/build-mobile.js`. `NEXT_PUBLIC_*` values are inlined by
  `next build` and baked into the APK/IPA, so a missing one cannot be repaired
  at runtime: the store binary ships without it. A DSN-less build produces an
  app that reports **no crashes at all** — which is how a merchant-visible
  crash went unnoticed for 90 days (zero Sentry events from `app.jawab24.com`).
  Fix by putting the DSN in `frontend/.env.local` (the same value the web image
  gets as a Docker build arg), then re-run. Do **not** work around the guard.
  ⚠️ A fresh worktree has no `.env.local` — copy it from the main checkout.
- Check TypeScript errors: `cd frontend && npx tsc --noEmit`
- Check lint errors: `cd frontend && npm run lint`

## Step 4: Sync with Capacitor

Android:
```bash
cd frontend && npx cap sync android
```

iOS:
```bash
cd frontend && npx cap sync ios
```

If iOS sync fails with pod errors:
```bash
cd frontend/ios/App && pod install --repo-update
```

If iOS sync fails with SPM cache errors (e.g. "already exists in file system"):
```bash
rm -rf ~/Library/Caches/org.swift.swiftpm/artifacts/https___github_com_ionic_team_capacitor_swift_pm_*
```
Then retry `npx cap sync ios`.

## Step 5: Build native app

### Android Debug (default)
```bash
cd frontend/android && ./gradlew assembleDebug
```
Output: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

### Android Release
```bash
cd frontend/android && ./gradlew assembleRelease
```
Output: `frontend/android/app/build/outputs/apk/release/app-release.apk`
Note: requires signing config in `frontend/android/app/build.gradle`.

### iOS — open Xcode (when "open" is passed)
```bash
cd frontend && npx cap open ios
```
Tell the user: "Xcode is open. Press Cmd+R to build and run."

### iOS Debug (CLI)
```bash
cd frontend/ios/App && xcodebuild -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath build -quiet
```
Output: `frontend/ios/App/build/Build/Products/Debug-iphonesimulator/App.app`

### iOS Release (CLI)
```bash
cd frontend/ios/App && xcodebuild -scheme App -sdk iphoneos -configuration Release -derivedDataPath build -quiet
```
Note: requires signing certificates and provisioning profiles. If signing fails, suggest opening Xcode with `npx cap open ios` to configure Signing & Capabilities.

### iOS Troubleshooting

**Firebase crash on launch** (`FirebaseApp.configure() could not find GoogleService-Info.plist`):
- `GoogleService-Info.plist` must be added to the Xcode project's build resources (PBXBuildFile + PBXResourcesBuildPhase in project.pbxproj)
- File exists at `frontend/ios/App/App/GoogleService-Info.plist`

**Firebase SPM dependencies missing** (`Unable to find module dependency: FirebaseCore`):
- `firebase-ios-sdk` must be in `frontend/ios/App/CapApp-SPM/Package.swift` dependencies
- Required products: `FirebaseCore`, `FirebaseMessaging`

## Step 6: Package for distribution

### iOS — zip for Facebook review or TestFlight
```bash
cd frontend/ios/App/build/Build/Products/Debug-iphonesimulator && zip -r -q ~/Downloads/Jawab24-simulator-$(date +%Y%m%d-%H%M).zip App.app
```

### iOS — run on simulator
```bash
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl install "iPhone 17 Pro" frontend/ios/App/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch "iPhone 17 Pro" com.jawab24.app
open -a Simulator
```

## Step 7: Report results

Show:
- Platform(s) built and variant (debug/release)
- Output file path (APK for Android, .app for iOS)
- Any warnings from build output

If the build fails, show the relevant error and suggest a fix.
