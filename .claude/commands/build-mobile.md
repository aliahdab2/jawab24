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
cd frontend/ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath build clean build 2>&1 | tail -30
```

### iOS Release (CLI)
```bash
cd frontend/ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -derivedDataPath build clean build 2>&1 | tail -30
```
Note: requires signing certificates and provisioning profiles. If signing fails, suggest opening Xcode with `npx cap open ios` to configure Signing & Capabilities.

## Step 6: Report results

Show:
- Platform(s) built and variant (debug/release)
- Output file path (APK for Android)
- Any warnings from build output

If the build fails, show the relevant error and suggest a fix.
