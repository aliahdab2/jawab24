#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# JAWAB24 ANDROID RELEASE SCRIPT
# ═══════════════════════════════════════════════════════════════════
# Builds a signed Android App Bundle (AAB) and publishes it to Google
# Play via the Gradle Play Publisher plugin. Runs identically locally
# and in CI — .github/workflows/android-release.yml is a thin wrapper
# that materializes secrets from the repo Actions secrets and then
# calls this very script (same pattern as deploy-production.sh).
#
# Usage:
#   ./scripts/release-android.sh [track] [options]
#
#   track:  internal (default) | alpha | beta | production
#
# Options:
#   --version X.Y.Z   Explicit versionName (overrides --bump)
#   --bump TYPE       patch (default) | minor | major — bump off build.gradle
#   --dry-run         Build the AAB but do NOT upload (prints the path)
#   --skip-tests      Skip frontend lint + unit tests
#   --ci              Non-interactive; credentials must come from env
#   -y, --yes         Skip the confirmation prompt
#
# Credentials (never hardcoded — env / files only):
#   Signing      — frontend/android/local.properties (RELEASE_* keys)
#   Play upload  — ANDROID_PUBLISHER_CREDENTIALS env var holding the raw
#                  service-account JSON, OR a local key file at
#                  frontend/android/play-service-account.json (gitignored)
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Locate repo root ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ─── Config / defaults ───
TRACK="internal"
BUMP="patch"
EXPLICIT_VERSION=""
DRY_RUN=false
SKIP_TESTS=false
CI_MODE=false
AUTO_CONFIRM=false
GRADLE_FILE="frontend/android/app/build.gradle"
LOCAL_PROPS="frontend/android/local.properties"
LOCAL_SA="${PLAY_SA_JSON:-frontend/android/play-service-account.json}"
AAB_PATH="frontend/android/app/build/outputs/bundle/release/app-release.aab"

# ─── Parse arguments ───
while [[ $# -gt 0 ]]; do
    case "$1" in
        internal|alpha|beta|production) TRACK="$1"; shift ;;
        --version)    EXPLICIT_VERSION="${2:?--version needs a value e.g. 1.2.3}"; shift 2 ;;
        --bump)       BUMP="${2:?--bump needs patch|minor|major}"; shift 2 ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --skip-tests) SKIP_TESTS=true; shift ;;
        --ci)         CI_MODE=true; AUTO_CONFIRM=true; shift ;;
        -y|--yes)     AUTO_CONFIRM=true; shift ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

# ─── Colors ───
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

START_TIME=$(date +%s)

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}${BOLD}🤖 JAWAB24 ANDROID RELEASE${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ─── Resolve version ───
CURRENT_VERSION=$(grep 'def appVersionName' "$GRADLE_FILE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
[ -z "$CURRENT_VERSION" ] && CURRENT_VERSION="0.0.0"

if [ -n "$EXPLICIT_VERSION" ]; then
    VERSION_NAME="$EXPLICIT_VERSION"
    VERSION_SRC="--version"
else
    IFS=. read -r MA MI PA <<< "$CURRENT_VERSION"
    case "$BUMP" in
        major) MA=$((MA+1)); MI=0; PA=0 ;;
        minor) MI=$((MI+1)); PA=0 ;;
        patch) PA=$((PA+1)) ;;
        *) echo -e "${RED}❌ --bump must be patch|minor|major${NC}"; exit 1 ;;
    esac
    VERSION_NAME="$MA.$MI.$PA"
    VERSION_SRC="--bump $BUMP (from $CURRENT_VERSION)"
fi

if ! [[ "$VERSION_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo -e "${RED}❌ versionName '$VERSION_NAME' is not semver X.Y.Z${NC}"; exit 1
fi
IFS=. read -r VMA VMI VPA <<< "$VERSION_NAME"
if [ "$VMI" -ge 100 ] || [ "$VPA" -ge 100 ]; then
    echo -e "${RED}❌ minor/patch must be < 100 for the versionCode scheme${NC}"; exit 1
fi
# versionCode = major*10000 + minor*100 + patch — deterministic & monotonic.
VERSION_CODE=$((VMA*10000 + VMI*100 + VPA))

echo ""
echo -e "📅 Time:        $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo -e "📦 Package:     com.jawab24.android"
echo -e "🏷️  versionName: ${CYAN}$VERSION_NAME${NC}  ($VERSION_SRC)"
echo -e "🔢 versionCode: ${CYAN}$VERSION_CODE${NC}"
echo -e "🎯 Track:       ${CYAN}$TRACK${NC}"
[ "$DRY_RUN" = true ]    && echo -e "🧪 Mode:        ${YELLOW}DRY RUN (build only, no upload)${NC}"
[ "$SKIP_TESTS" = true ] && echo -e "⚠️  Tests:       ${YELLOW}SKIPPED${NC}"

# ─── Pre-flight checks ───
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📋 PRE-FLIGHT CHECKS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if ! grep -q '^RELEASE_STORE_FILE=' "$LOCAL_PROPS" 2>/dev/null; then
    echo -e "${RED}❌ Signing config missing in $LOCAL_PROPS (RELEASE_STORE_FILE etc.)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Signing config present${NC}"

# ─── Public build-time config the app CANNOT ship without ───
# NEXT_PUBLIC_* values are inlined by `next build`. The web image receives these
# as Docker build args (frontend/Dockerfile + docker-compose build.args, wired in
# #418); nothing ever did the same for the mobile build, so v2.0.6 shipped with
# isWhatsAppEnabled() compiled to false — the entire WhatsApp surface stripped out
# of the app while it was live on the web. Silence, not an error: the app simply
# rendered one channel fewer, and only a screenshot caught it.
#
# Fail here rather than ship that again. Values may come from the environment or
# frontend/.env.local (which `next build` loads on its own).
MOBILE_ENV_FILE="frontend/.env.local"
have_public_var() {  # $1 = var name
    [ -n "${!1:-}" ] && return 0
    grep -qE "^${1}=.+" "$MOBILE_ENV_FILE" 2>/dev/null
}
# BOTH are gated, and both for the same reason: `isWhatsAppEnabled()` in
# frontend/src/lib/featureFlags.ts is `!!NEXT_PUBLIC_FB_APP_ID &&
# !!NEXT_PUBLIC_WHATSAPP_CONFIG_ID`, evaluated against values Next inlines at
# BUILD time. Either one missing compiles the whole WhatsApp surface out —
# no row, no channel picker entry, no connect flow, no crash, no error.
#
# An earlier version of this guard exempted NEXT_PUBLIC_FB_APP_ID, reasoning
# that Android reads its Facebook app id from the native config (strings.xml /
# FacebookActivity). That is true of the native SDK and irrelevant here: the
# feature flag reads the value out of the JS bundle. The exemption left the
# exact hole that shipped 2.0.6 with WhatsApp silently absent, just via the
# other variable.
MISSING_PUBLIC=()
for v in NEXT_PUBLIC_FB_APP_ID NEXT_PUBLIC_WHATSAPP_CONFIG_ID; do
    have_public_var "$v" || MISSING_PUBLIC+=("$v")
done
if [ ${#MISSING_PUBLIC[@]} -gt 0 ]; then
    echo -e "${RED}❌ Missing build-time public config: ${MISSING_PUBLIC[*]}${NC}"
    echo -e "   These are inlined at build time. Without them the app ships with those"
    echo -e "   features silently absent — no crash, no error, just a missing channel."
    echo -e "   Add them to $MOBILE_ENV_FILE or export them, then re-run."
    echo -e "   The WhatsApp Configuration ID is the same public value the server uses"
    echo -e "   in /var/www/jawab24/env/frontend.env (it also appears in the OAuth URL)."
    exit 1
fi
echo -e "${GREEN}✅ WhatsApp public config present for the build (FB app id + config id)${NC}"

# The canary flag must NOT leak into a store build: it hides WhatsApp from every
# non-admin, which is every user of the shipped app.
if [ "${NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY:-}" = "true" ] \
   || grep -qE '^NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY=true' "$MOBILE_ENV_FILE" 2>/dev/null; then
    echo -e "${RED}❌ NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY=true is set.${NC}"
    echo -e "   That hides WhatsApp from every non-admin — i.e. from everyone who installs this build."
    exit 1
fi

if [ "$DRY_RUN" = false ]; then
    if [ -z "${ANDROID_PUBLISHER_CREDENTIALS:-}" ]; then
        if [ "$CI_MODE" = false ] && [ -f "$LOCAL_SA" ]; then
            export ANDROID_PUBLISHER_CREDENTIALS="$(cat "$LOCAL_SA")"
            echo -e "${GREEN}✅ Play credentials from $LOCAL_SA${NC}"
        else
            echo -e "${RED}❌ No Play credentials.${NC}"
            echo -e "   Set ANDROID_PUBLISHER_CREDENTIALS (raw JSON) or place a key at $LOCAL_SA"
            exit 1
        fi
    else
        echo -e "${GREEN}✅ Play credentials from ANDROID_PUBLISHER_CREDENTIALS env${NC}"
    fi
fi

if [ "$DRY_RUN" = false ] && [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  Working tree has uncommitted changes${NC}"
    git status -s
    if [ "$AUTO_CONFIRM" = false ]; then
        read -p "Continue anyway? (y/N): " c
        [[ "$c" =~ ^[Yy]$ ]] || { echo -e "${YELLOW}Cancelled.${NC}"; exit 0; }
    fi
fi

# ─── Tests (same checks locally and in CI) ───
if [ "$SKIP_TESTS" = false ]; then
    echo ""
    echo -e "${CYAN}🧪 Lint + unit tests (frontend)${NC}"
    ( cd frontend && npm run lint && npm run test )
    echo -e "${GREEN}✅ Checks passed${NC}"
fi

# ─── Confirm ───
if [ "$AUTO_CONFIRM" = false ] && [ "$DRY_RUN" = false ]; then
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}${BOLD}⚠️  CONFIRM RELEASE${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "Upload ${CYAN}com.jawab24.android${NC} v${CYAN}$VERSION_NAME${NC} (code $VERSION_CODE) to ${CYAN}$TRACK${NC}?"
    read -p "(y/N): " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo -e "${YELLOW}Release cancelled.${NC}"; exit 0; }
fi

# ─── Build web assets + sync Capacitor ───
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📦 BUILD WEB ASSETS + SYNC ANDROID${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
( cd frontend && npm run build:mobile && node scripts/strip-mobile-assets.js && npx cap sync android )

# Prove the config was actually INLINED, not merely present in the environment.
# The pre-flight check above can pass while the value still fails to reach the
# bundle (wrong env file precedence, a typo in the name, a stale `out/`), and the
# failure mode is silent — a shipped app quietly missing a channel. Grep the
# emitted bundle for the value we expect to find in it.
# Both values, because `isWhatsAppEnabled()` needs both — proving only the
# config id landed would have passed a build whose FB app id never made it.
resolve_public_var() {
    local name="$1"
    if [ -n "${!name:-}" ]; then
        printf '%s' "${!name}"
    else
        grep -hE "^${name}=" frontend/.env.local 2>/dev/null | head -1 | cut -d= -f2-
    fi
}
for v in NEXT_PUBLIC_FB_APP_ID NEXT_PUBLIC_WHATSAPP_CONFIG_ID; do
    value="$(resolve_public_var "$v")"
    if [ -n "$value" ] && ! grep -rqF "$value" frontend/out 2>/dev/null; then
        echo -e "${RED}❌ ${v} is NOT present in the built bundle (frontend/out).${NC}"
        echo -e "   It was set going in, so the build did not inline it — the app would ship"
        echo -e "   with the WhatsApp surface silently absent. Not uploading."
        exit 1
    fi
done
echo -e "${GREEN}✅ WhatsApp config inlined into the bundle${NC}"

# ─── Gradle: build (and upload unless dry-run) ───
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$DRY_RUN" = true ]; then
    echo -e "${BLUE}🔨 BUILD SIGNED AAB (dry run)${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    ( cd frontend/android && ./gradlew bundleRelease \
        -PappVersionName="$VERSION_NAME" -PappVersionCode="$VERSION_CODE" \
        --no-daemon --stacktrace )
    echo ""
    echo -e "${GREEN}✅ AAB built: ${AAB_PATH}${NC}"
else
    echo -e "${BLUE}🚀 BUILD + UPLOAD AAB → ${TRACK}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    ( cd frontend/android && ./gradlew publishReleaseBundle --track "$TRACK" \
        -PappVersionName="$VERSION_NAME" -PappVersionCode="$VERSION_CODE" \
        --no-daemon --stacktrace )
fi

# ─── Summary ───
END_TIME=$(date +%s); ELAPSED=$((END_TIME-START_TIME))
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}🎉 ANDROID RELEASE COMPLETE${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "⏱️  Total time: $((ELAPSED/60))m $((ELAPSED%60))s"
echo -e "🏷️  v${VERSION_NAME} (code ${VERSION_CODE})"
if [ "$DRY_RUN" = false ]; then
    echo -e "🎯 Uploaded to: ${TRACK}"
    echo -e "🔗 Play Console: https://play.google.com/console"
    echo -e "${YELLOW}ℹ️  Promote ${TRACK} → next track in the Play Console (no rebuild needed).${NC}"
fi
echo ""
