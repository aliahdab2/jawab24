Build the Jawab24 Android mobile app.

Arguments: $ARGUMENTS
- If arguments include "release", build release variant instead of debug

Steps:
1. Build the Next.js app for mobile and sync with Capacitor:
```bash
cd frontend
npm run build:mobile
npx cap sync android
```

2. Build the Android APK:
```bash
# Debug (default)
cd frontend/android && ./gradlew assembleDebug

# Release
cd frontend/android && ./gradlew assembleRelease
```

3. Report the output APK location when done.

If the build fails, show the relevant error from the Gradle output and suggest a fix.
