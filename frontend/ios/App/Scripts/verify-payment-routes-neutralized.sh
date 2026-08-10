#!/bin/bash
#
# App Store Guideline 3.1.1 — fail the build if any payment route in the bundled
# web assets still carries real markup.
#
# WHY THIS RUNS IN XCODE AND NOT ONLY IN npm. `neutralize-ios-payment-routes.js`
# is wired into `build:ios:sync` / `build:ios:clean`, but nothing forces anyone
# to use them: the recipe recorded in the launch notes — and the one actually
# used to produce build 7 — is `npm run build:mobile && npx cap sync ios`, which
# skips the neutralizer entirely. A protection you can bypass by running the
# obvious command is not prevention. This phase sits between the assets and the
# .ipa, so every archive is checked no matter how the bundle got there.
#
# Debug builds only warn: a developer mid-iteration should not be blocked, and
# nothing they build reaches Apple. Release fails hard.

set -u

# Check the BUILT product, not the source tree: that is the artifact that
# becomes the .ipa, and it is what Apple receives.
PUBLIC_DIR="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/public"
CONFIG="${SRCROOT}/../../src/config/payment-routes.json"
STUB_MARKER="jawab24-payment-route-neutralized"

if [ ! -d "$PUBLIC_DIR" ]; then
    echo "error: no web assets at ${PUBLIC_DIR}. Run 'npm run build:ios:sync' before archiving."
    exit 1
fi

if [ ! -f "$CONFIG" ]; then
    echo "error: payment-routes.json not found at ${CONFIG}; cannot verify Guideline 3.1.1."
    exit 1
fi

# Prefixes come from the same JSON the build script and the app import, so there
# is no list to keep in sync here.
PREFIXES=$(/usr/bin/sed -n 's/.*"prefixes"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' "$CONFIG" \
    | /usr/bin/tr ',' '\n' | /usr/bin/tr -d ' "' | /usr/bin/sed '/^$/d')

if [ -z "$PREFIXES" ]; then
    echo "error: could not read payment route prefixes from ${CONFIG}."
    exit 1
fi

FAILURES=0
CHECKED=0

while IFS= read -r prefix; do
    # "/pricing" -> every exported page at or under that path.
    stripped="${prefix#/}"
    for candidate in "${PUBLIC_DIR}/${stripped}.html" "${PUBLIC_DIR}/${stripped}"/*.html; do
        [ -e "$candidate" ] || continue
        CHECKED=$((CHECKED + 1))
        if ! /usr/bin/grep -q "$STUB_MARKER" "$candidate"; then
            rel="${candidate#"${PUBLIC_DIR}"/}"
            if [ "${CONFIGURATION}" = "Release" ]; then
                echo "error: ${rel} is a payment surface and was NOT neutralized. Run 'npm run build:ios:sync'. (App Store Guideline 3.1.1)"
            else
                echo "warning: ${rel} is a payment surface and was NOT neutralized. Run 'npm run build:ios:sync' before archiving."
            fi
            FAILURES=$((FAILURES + 1))
        fi
    done
done <<< "$PREFIXES"

if [ "$CHECKED" -eq 0 ]; then
    echo "error: no payment routes found under ${PUBLIC_DIR}. The bundle is not what this check expects — refusing to certify it."
    exit 1
fi

if [ "$FAILURES" -gt 0 ] && [ "${CONFIGURATION}" = "Release" ]; then
    exit 1
fi

echo "Guideline 3.1.1: ${CHECKED} payment routes verified neutralized."
exit 0
