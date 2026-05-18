Release the Jawab24 Android app to Google Play.

Arguments: $ARGUMENTS
- "internal" (default) — upload to Internal Testing track
- "closed" — upload to Closed Testing track
- "production" — upload to Production (rollout)
- "patch" | "minor" | "major" — bump versionName accordingly (versionCode always +1)
- "skip-bump" — keep current versionName/versionCode (re-upload only; rarely needed)
- "dry-run" — do everything except upload (build AAB, stop, report path)

If no track is passed, ask the user which track. Default bump is `patch`.

## Preconditions (check before starting)

1. **Clean git tree** — `git status --porcelain` must be empty. If not, stop and tell the user to commit/stash.
2. **On `main`** — `git rev-parse --abbrev-ref HEAD` should be `main`. If not, confirm with user before proceeding.
3. **Signing config present** — `frontend/android/local.properties` must define `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`. If missing, stop with instructions to restore the keystore.
4. **Lint + tests pass** — run `cd frontend && npm run lint && npm run test` (fail the release if either fails).

## Step 1: Bump version

Read current `versionCode` and `versionName` from [frontend/android/app/build.gradle](frontend/android/app/build.gradle#L38-L39).

Unless `skip-bump` is passed:
- `versionCode` → +1 (always)
- `versionName` → bump per arg (patch=Z+1, minor=Y+1 + Z=0, major=X+1 + Y=0 + Z=0)

Edit those two lines in `build.gradle`. Show the user the before/after and confirm before continuing.

> The iOS project has its own version in `frontend/ios/App/App/Info.plist` — don't touch it here. Keep Android and iOS versions aligned by convention but bump them in separate release flows.

## Step 2: Build signed AAB

The `/build-mobile` skill produces APKs. For Play Store we need an **AAB** (Android App Bundle).

```bash
cd frontend && npm run build:mobile
cd frontend && npx cap sync android
cd frontend/android && ./gradlew bundleRelease
```

Output: `frontend/android/app/build/outputs/bundle/release/app-release.aab`

If `bundleRelease` fails:
- Signing error → re-check `local.properties` paths/passwords
- Lint/resource error → run `./gradlew bundleRelease --stacktrace` and surface the relevant lines

If `dry-run` was passed, stop here. Print the AAB path and skip Step 3–5.

## Step 3: Upload to Play Console

We do not have `fastlane` wired up yet. Default = **manual upload via Play Console web UI** (safer for now, lets the user write release notes inline):

1. Open https://play.google.com/console/u/0/developers/app
2. Pick app **Jawab24** → left nav → **Testing** → **Internal testing** (or Closed/Production per arg)
3. Click **Create new release**
4. Upload the AAB from `frontend/android/app/build/outputs/bundle/release/app-release.aab`
5. Fill **Release notes** — short Arabic + English changelog (one line per significant change)
6. **Review release** → **Start rollout**

Tell the user explicitly: "Open the Play Console, upload the AAB at `<path>`, then start the rollout."

## Step 4: Tag the release

After the user confirms the upload finished:

```bash
git add frontend/android/app/build.gradle
git commit -m "chore(android): release v<versionName> (code <versionCode>)"
git tag -a "android-v<versionName>" -m "Android release v<versionName> (versionCode <versionCode>)"
git push origin main
git push origin "android-v<versionName>"
```

## Step 5: Update memory

Append to MEMORY.md → "Play Store" line: latest versionName/versionCode and release date. Use today's date in `YYYY-MM-DD` form.

## Step 6: Post-release reminders

- Promotion from Internal → Closed → Production is a separate Play Console action (no rebuild needed).
- If this release changes permissions, data collection, or target SDK → re-check the Data Safety form and Permissions declaration in Play Console.
- Watch Sentry for the first 24h after rollout — new versionName appears as a release tag.

## Future improvement

Wire up `fastlane supply` with a Google Play service account JSON key so Step 3 becomes a single CLI command. Out of scope for first version of this skill — keep manual upload until the user asks for it.
