Release the Jawab24 Android app to Google Play.

This skill drives `scripts/release-android.sh` — the single entrypoint that builds a
signed AAB and uploads it to Google Play via the Gradle Play Publisher plugin. It runs
fully **locally** (no GitHub Actions required); the `.github/workflows/android-release.yml`
workflow is an optional manual-dispatch mirror (a CI fallback) that calls the same script.

Arguments: $ARGUMENTS
- "internal" (default) — Internal Testing track
- "alpha" | "beta" — Closed Testing tracks
- "production" — Production rollout
- "patch" (default) | "minor" | "major" — versionName bump (versionCode is derived)
- "vX.Y.Z" — explicit versionName instead of a bump
- "dry-run" — build the AAB only, no upload
- "skip-tests" — skip the frontend lint + unit tests

If no track is passed, ask the user. Default bump is `patch`.

## Preconditions (the script checks these too — fail early here with clear guidance)

1. **On `main`** — `git rev-parse --abbrev-ref HEAD` should be `main`. If not, confirm with the user.
2. **Clean tree** — `git status --porcelain` empty (unless `dry-run`). If dirty, stop and tell the user to commit/stash.
3. **Signing present** — `frontend/android/local.properties` defines `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`. If missing, stop with instructions to restore the keystore.
4. **Play credentials present** (unless `dry-run`) — either the `ANDROID_PUBLISHER_CREDENTIALS` env var (raw service-account JSON) or a key file at `frontend/android/play-service-account.json` (gitignored). If missing, stop and point to the service-account setup.

## Step 1: Decide the version

Read the current `versionName` from the `def appVersionName = … ?: "X.Y.Z"` fallback in
[frontend/android/app/build.gradle](frontend/android/app/build.gradle). Compute the next version:
- explicit `vX.Y.Z` → use it verbatim
- `patch` → Z+1 · `minor` → Y+1, Z=0 · `major` → X+1, Y=0, Z=0

`versionCode = major*10000 + minor*100 + patch` (the script computes the same; keep them in sync).
Show the user before → after and confirm.

> The iOS project versions separately in `frontend/ios/App/App/Info.plist` — don't touch it here.

## Step 2: Run the release script

```bash
./scripts/release-android.sh <track> --version <X.Y.Z> [--dry-run] [--skip-tests]
```

The script runs lint+tests (unless skipped), builds the web assets, `cap sync`s, builds the
**signed AAB**, and uploads it to the chosen track. It prints a summary on success.

If `dry-run` was passed, stop here — report the AAB path (`frontend/android/app/build/outputs/bundle/release/app-release.aab`) and skip Steps 3–5.

If the gradle step fails: re-run the same command (the script passes `--stacktrace`) and surface
the relevant lines. Signing errors → re-check `local.properties`. `403`/auth errors → the
service account lacks release permission for `com.jawab24.android` in the Play Console.

## Step 3: Record the released version

Update the two fallback literals in [frontend/android/app/build.gradle](frontend/android/app/build.gradle) so they reflect the version just shipped (this is the "last released" record and the base for the next bump):
- `def appVersionName = … ?: "X.Y.Z"`
- `def appVersionCode = … ?: "<code>"`

## Step 4: Commit & tag

```bash
git add frontend/android/app/build.gradle
git commit -m "chore(android): release v<X.Y.Z> (code <code>)"
git tag -a "android-v<X.Y.Z>" -m "Android release v<X.Y.Z> (versionCode <code>)"
git push origin main
git push origin "android-v<X.Y.Z>"
```

> The `android-v*` tag is just a release marker — it does NOT trigger any upload. The optional CI
> workflow (`.github/workflows/android-release.yml`) is manual-dispatch only, so there's no
> duplicate-upload risk. The local upload via this script is authoritative.

## Step 5: Update memory

Update the "Play Store" line in MEMORY.md with the new versionName/versionCode and today's date (`YYYY-MM-DD`).

## Step 6: Post-release reminders

- Promotion internal → alpha → beta → production is a Play Console action (no rebuild).
- If this release changed permissions, data collection, or target SDK → re-check the Data Safety form and Permissions declaration.
- Watch Sentry for 24h — the new versionName appears as a release tag.
