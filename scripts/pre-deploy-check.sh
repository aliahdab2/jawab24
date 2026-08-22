#!/bin/bash
#
# Pre-Deploy Check Script — Single source of truth for CI and local runs.
# CI (.github/workflows/ci.yml) calls this script directly.
#
# Usage:
#   Local:  ./scripts/pre-deploy-check.sh
#   CI:     Automatically called by the "checks" job with env vars set.
#
# Environment variables (optional — defaults to local dev Docker):
#   DATABASE_URL  — Postgres connection string
#   CI            — Set to "true" in GitHub Actions
#

set -e

echo "🚀 Jawab24 Pre-Deploy Check"
echo "==========================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# =============================================
# Exclusive run lock — one frontend build per working copy
# =============================================
# Guards against a second run of THIS script and against an Android release
# (scripts/release-android.sh), which builds into the same frontend/.next.
# The full rationale — including why distDir isolation cannot help and why the
# mobile build shares `.next` despite its name — lives in the helper.
# shellcheck source=scripts/lib/build-lock.sh
source "$REPO_ROOT/scripts/lib/build-lock.sh"
acquire_frontend_build_lock "pre-deploy check" || exit 1
# Also sweep the mktemp logs. Each step rm's its own $_TEST_LOG once it has been
# consumed, but a Ctrl-C in between would otherwise leak one file per interrupted
# run — and this gate is interrupted often. Removing an already-removed path is a
# no-op under `rm -f`, so the trap is safe to fire in any state.
trap 'release_frontend_build_lock; rm -f "${_TEST_LOG:-}" "${_DB_LOG:-}"' EXIT INT TERM

# Database URL: CI provides this via env; locally falls back to a test database
# whose name is unique to THIS checkout, so a gate run and a suite running in
# another worktree cannot truncate each other's fixtures. scripts/test-db-url.sh
# is the single source of truth and carries the full rationale.
#
# Assigned and exported SEPARATELY on purpose. `export VAR="$(cmd)"` reports
# `export`'s own exit status, which is always 0, so `set -e` does NOT fire when
# the substitution fails — DATABASE_URL would silently become empty and the gate
# would run steps 0–5 (~10 minutes) before dying at step 6 with an empty name.
if [ -z "${DATABASE_URL:-}" ]; then
    # Both failure shapes are caught here, and neither is caught by the one-liner:
    # a non-zero exit (`export` swallows it, so `set -e` never fires) and a
    # zero-exit-but-empty stdout (nothing to fire on at all).
    if ! DATABASE_URL="$("$REPO_ROOT/scripts/test-db-url.sh")" || [ -z "$DATABASE_URL" ]; then
        echo -e "${RED}❌ Could not resolve a test database URL.${NC}"
        echo -e "${RED}   scripts/test-db-url.sh failed or produced no output.${NC}"
        echo -e "${YELLOW}   Is it present and executable?  ls -l scripts/test-db-url.sh${NC}"
        exit 1
    fi
fi
export DATABASE_URL
PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
PG_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
# Database name = last path segment, minus any ?query string.
TEST_DB_NAME="${DATABASE_URL##*/}"
TEST_DB_NAME="${TEST_DB_NAME%%\?*}"

# Announce the target NOW, not at step 6. A run that dies early should still say
# in its log which database it was pointed at.
echo "🗄️  Test database for this checkout: ${TEST_DB_NAME} (${PG_HOST}:${PG_PORT})"
echo ""

# The naming rules must hold before anything relies on them: step 6 DROPs whatever
# this resolves to, and `test:integration:local` has to resolve the identical name
# or the gate would migrate one database while the suite reads another. Checked
# here rather than at step 6 so a broken invariant fails in seconds, not minutes.
if ! (cd "$REPO_ROOT" && npm run --silent test:db-tooling) > /dev/null 2>&1; then
    echo -e "${RED}❌ Test-database tooling self-tests failed — isolation is not trustworthy${NC}"
    (cd "$REPO_ROOT" && npm run --silent test:db-tooling)
    exit 1
fi

# Same reasoning for the build lock this run is already holding: if its
# invariants have broken, an Android release could start mid-gate and delete
# frontend/.next underneath us. Seconds to check, a corrupted run to miss.
if ! (cd "$REPO_ROOT" && npm run --silent test:build-lock) > /dev/null 2>&1; then
    echo -e "${RED}❌ Build-lock self-tests failed — concurrent-build protection is not trustworthy${NC}"
    (cd "$REPO_ROOT" && npm run --silent test:build-lock)
    exit 1
fi

# =============================================
# 0. Verify critical config files
# =============================================
echo "0️⃣  Checking critical config files..."

CRITICAL_CONFIGS=(
    "frontend/postcss.config.js"
    "frontend/tailwind.config.js"
    "frontend/next.config.js"
    "frontend/tsconfig.json"
    "backend/tsconfig.json"
)

MISSING_CONFIG=false
for config in "${CRITICAL_CONFIGS[@]}"; do
    if [ ! -f "$config" ]; then
        echo -e "${RED}   ❌ MISSING: $config${NC}"
        MISSING_CONFIG=true
    fi
done

if [ "$MISSING_CONFIG" = true ]; then
    echo ""
    echo -e "${RED}   CRITICAL CONFIG FILES ARE MISSING!${NC}"
    echo -e "${RED}   This will silently break the production build (e.g., no CSS).${NC}"
    echo -e "${RED}   Restore the missing files before deploying.${NC}"
    exit 1
fi
echo -e "${GREEN}   ✅ All critical config files present${NC}"

# =============================================
# 0.5. Validate translations
# =============================================
echo ""
echo "🌐 Validating translations..."
if node frontend/scripts/validate-translations.js > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Translations valid${NC}"
else
    echo -e "${RED}   ❌ Translation validation failed!${NC}"
    node frontend/scripts/validate-translations.js
    exit 1
fi

# =============================================
# 0.55. Validate sitemap (no future <lastmod>, hreflang pairs intact, no dupes)
# =============================================
echo ""
echo "🗺️  Validating sitemap..."
if node frontend/scripts/validate-sitemap.js > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Sitemap valid${NC}"
else
    echo -e "${RED}   ❌ Sitemap validation failed!${NC}"
    node frontend/scripts/validate-sitemap.js
    exit 1
fi

# =============================================
# 0.57. Validate llms.txt / llms-full.txt (the AI-assistant-facing surface)
# =============================================
echo ""
echo "🤖 Validating llms.txt files..."
# Distinguish an environmental problem from a content problem. The validator
# resolves integrations.ts, competitors.ts and the blog content dir relative to
# its own location; if a checkout is trimmed or partial, it exits 1 for a reason
# that has nothing to do with llms.txt being stale. Both still block the deploy —
# but the operator reading this log needs to know which one they are looking at.
if [ ! -d "frontend/src/content/blog/ar" ] || [ ! -f "frontend/src/data/integrations.ts" ]; then
    echo -e "${RED}   ❌ Cannot validate llms.txt — the checkout is missing files it reads${NC}"
    echo "      Expected frontend/src/content/blog/ar/ and frontend/src/data/integrations.ts."
    echo "      This is an incomplete checkout, not a stale llms.txt."
    exit 1
fi
# The gate itself must work before it is trusted to gate anything.
if ! (cd frontend && node --test scripts/__tests__/validate-llms.test.mjs) > /dev/null 2>&1; then
    echo -e "${RED}   ❌ llms.txt validator's own tests failed — the gate is broken${NC}"
    (cd frontend && node --test scripts/__tests__/validate-llms.test.mjs)
    exit 1
fi
if node frontend/scripts/validate-llms.js > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ llms files current (validator self-tests pass)${NC}"
else
    echo -e "${RED}   ❌ llms.txt validation failed!${NC}"
    node frontend/scripts/validate-llms.js
    exit 1
fi

# The iOS 3.1.1 price gate. Its own tests run here for the same reason the
# llms gate's do: it shipped once reporting a clean bundle while six compare/*
# pages rendered "$15/mo" (2026-08-10). The gate runs during the iOS build,
# which no deploy performs — so this is the only place its correctness is
# checked on a cadence.
if ! (cd frontend && npm run --silent build:ios:payment-guard:test) > /dev/null 2>&1; then
    echo -e "${RED}   ❌ iOS payment-route gate's own tests failed — the 3.1.1 gate is broken${NC}"
    (cd frontend && npm run --silent build:ios:payment-guard:test)
    exit 1
fi
echo -e "${GREEN}   ✅ iOS 3.1.1 price gate self-tests pass${NC}"

# =============================================
# 0.6. Lock file sync check
# =============================================
echo ""
echo "🔒 Checking package-lock.json is in sync..."
if npm ls --workspace=jawab24-backend > /dev/null 2>&1 && \
   npm ls --workspace=jawab24-frontend > /dev/null 2>&1 && \
   npm ls --workspace=jawab24-ai-worker > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ package-lock.json in sync with package.json${NC}"
else
    echo -e "${RED}   ❌ package-lock.json is out of sync!${NC}"
    echo -e "${RED}   Run 'npm install' to regenerate the lock file.${NC}"
    echo -e "${RED}   This prevents Docker builds from using stale dependency versions.${NC}"
    exit 1
fi

# =============================================
# 0.7. OpenAI SDK version parity check
# =============================================
echo ""
echo "🤖 Checking OpenAI SDK version parity..."
if npm run check:openai-sync > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ OpenAI SDK versions are pinned and in sync${NC}"
else
    echo -e "${RED}   ❌ OpenAI SDK version parity check failed!${NC}"
    npm run check:openai-sync
    exit 1
fi

# =============================================
# 0.8. Fastify plugin compatibility check
# =============================================
echo ""
echo "🔌 Checking Fastify plugin compatibility..."

# Detect Fastify major version from backend/package.json
FASTIFY_MAJOR=$(node -e "const p=require('./backend/package.json'); const v=p.dependencies.fastify.replace(/[\^~>=<]/g,''); console.log(v.split('.')[0])")

if [ "$FASTIFY_MAJOR" -ge 5 ]; then
    # All @fastify/* plugins must use fastify-plugin ^5.0.0 (not ^4.0.0) for Fastify 5
    STALE_PLUGINS=$(node -e "
        const lock = require('./package-lock.json');
        const pkgs = lock.packages || {};
        const bad = [];
        for (const [key, val] of Object.entries(pkgs)) {
            if (key.includes('@fastify/') && val.dependencies && val.dependencies['fastify-plugin']) {
                const fpRange = val.dependencies['fastify-plugin'];
                if (fpRange.startsWith('^4') || fpRange.startsWith('~4') || fpRange === '4') {
                    bad.push(key.replace(/.*node_modules\//, '') + '@' + val.version + ' (needs fastify-plugin ' + fpRange + ')');
                }
            }
        }
        if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
    " 2>&1)

    if [ $? -ne 0 ]; then
        echo -e "${RED}   ❌ Fastify plugin version mismatch detected!${NC}"
        echo -e "${RED}   These plugins use fastify-plugin v4 but Fastify $FASTIFY_MAJOR requires v5:${NC}"
        echo "$STALE_PLUGINS" | while read -r line; do echo -e "${RED}      - $line${NC}"; done
        echo -e "${RED}   Upgrade these @fastify/* packages to Fastify $FASTIFY_MAJOR-compatible versions.${NC}"
        exit 1
    fi
    echo -e "${GREEN}   ✅ All @fastify plugins compatible with Fastify $FASTIFY_MAJOR${NC}"
else
    echo -e "${GREEN}   ✅ Fastify $FASTIFY_MAJOR — no compatibility check needed${NC}"
fi

# =============================================
# 0.9. Dependency security audit
# =============================================
echo ""
echo "🔒 Running dependency security audit..."

AUDIT_FAILED=false

# ── Acknowledged-unreachable advisories ─────────────────────────────────────────
# Broad dependency refresh 2026-08-01 took the workspace audit from 33 findings
# (1 critical, 12 high, 20 moderate) down to the 5 GHSAs below:
#   - in-range updates: tar (the critical), axios, hono, fast-uri, find-my-way,
#     js-yaml, brace-expansion, protobufjs, @google-cloud/storage, gaxios
#   - next 15.5.18 → 15.5.22 (clears the entire Next 15.5.x server CVE cluster:
#     GHSA-m99w/89xv/68g3/4633/4c39/p9j2/q8wf/955p — contrary to the earlier note,
#     a patched 15.5.x DID ship; no Next 16 needed for these)
#   - @fastify/swagger-ui 5 → 6 (ships @fastify/static 10: GHSA-83w8/8pvw fixed)
#   - firebase-admin 13 → 14 (clears the firestore/google-gax/teeny-request chain)
#   - root overrides: uuid ^11.1.1 (GHSA-w5hq), sharp ^0.35.3 (GHSA-f88m libvips
#     CVEs), drizzle-kit's esbuild ^0.25 + @hono/node-server ^2 (dev-only cluster)
#   - REMOVED the vestigial next-intl→next@16.2.3 override (April 2026 artifact,
#     commit 977cbe67): the tree now holds a SINGLE hoisted next — previously
#     next-intl/@sentry/nextjs resolved next@16.x while the app ran 15.5.x
#   - sharp added as an explicit frontend dependency: next/@vercel/og declare it
#     OPTIONAL and the override made npm silently omit it, but standalone output
#     REQUIRES sharp for image optimization
#   - full package-lock.json regeneration (the old blockers — the next-intl
#     override and --legacy-peer-deps churn — are gone with it)
# ⚠️ Still NEVER run `npm audit fix` / `--force` here: npm's offered "fixes" for
# every remaining finding are DOWNGRADES (next@14.2, @vercel/og@1.0.0 — a 2023
# release older than 0.11.x, autocannon@2, exceljs@3, geoip-lite@1.2).
#
# What remains, and why it is acknowledged instead of fixed (list drifts as
# advisories publish against the SAME pinned deps — 2026-08-04 added two new
# codes for the already-acknowledged postcss and ip-address pins; count is 6):
#
# GHSA-gpj5 (drizzle-orm SQLi) — DROPPED 2026-08-01: fixed by the 0.29→0.45 upgrade.
# GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 — postcss XSS /
# arbitrary file read / sourcemap path traversal in next@15.5.x's OWN pinned
# nested copy (node_modules/next/node_modules/postcss@8.4.31). The workspace-level
# postcss is already patched; a framework-internal exact pin cannot be bumped
# without a Next major. Build-time CSS tooling with no runtime path — postcss
# never stringifies attacker-controlled CSS and nothing loads sourcemaps at
# runtime. next, next-intl and @sentry/nextjs echo the same three codes
# transitively. Cleared by the planned Next 16 migration — drop these then.
# GHSA-fxqj-rqcc-2cmp — postcss follow-up published as the "incomplete fix of
# GHSA-6g55" (added 2026-08-04): attacker-controlled sourceMappingURL reads
# arbitrary .map files when `from` is unset. Same nested next@15.5.x pinned
# copy, same reachability as its three siblings above: build-time tooling over
# repo-authored CSS only — no attacker-supplied CSS or sourceMappingURL ever
# enters the build, and nothing parses CSS at runtime. next 15.5.22 is the
# LATEST 15.5.x (verified 2026-08-04), so no in-range bump exists. Cleared by
# the planned Next 16 migration together with the other three.
# GHSA-v2v4-37r5-5v8g — ip-address XSS in Address6 HTML-emitting methods
# (moderate). Transitive via geoip-lite, which pins ip-address 5.8.9–5.9.4
# (patched line is >=10.1.1, an incompatible major). We only call
# geoip.lookup(ip), which returns a plain data object; the HTML-emitting methods
# are never invoked. geoip-lite feeds the sanctioned-country check (LEGAL path) —
# no override experiments here. Revisit when geoip-lite ships on ip-address >=10.
# GHSA-mwp4-54f8-5fhr — ip-address Address4 decodes leading-zero octets as
# decimal while OS resolvers decode them as octal → validate-then-connect SSRF
# / trust-boundary bypass (high; added 2026-08-04). Unreachable here: the only
# call is geoip.lookup(request.ip) in backend/src/middleware/geo.ts, mapping
# the IP to a country for the sanctions gate — the string is never resolved,
# dialed, or fetched, so there is no second decoder for the parser/resolver
# differential to bypass. request.ip is Fastify's XFF-resolved address behind
# nginx, not raw attacker text reaching a connect path.
# PROPER RETIREMENT for both ip-address codes: geoip-lite >=2.0.2 rides
# ip-address ^10.2.0 (2.0.3 current) but every 2.x requires node >=24 and the
# backend ships on node:22-alpine — bundle the bump with the Node 24 platform
# upgrade, do NOT override ip-address under geoip-lite 1.x (5.x→10.x is an
# incompatible major inside the LEGAL sanctions path).
# GHSA-hq66-cqwq-w95j — pdfjs-dist arbitrary JS execution on opening a malicious
# PDF (high, CVE-2026-16633; added 2026-08-07). Read the advisory body, not the
# title: the CWE is 79 (XSS) and the documented mitigations are
# `enableScripting: false` or a script-src CSP — this is the SCRIPTING engine,
# NOT the older isEvalSupported RCE class. Unreachable here, verified against
# the installed source rather than inferred:
#   1. `enableScripting` is not a getDocument() option at all — it is absent
#      from types/src/display/api.d.ts and is consumed by `class
#      AnnotationElement`, i.e. the ANNOTATION LAYER.
#   2. Neither PDF path renders annotations. backend/src/services/kb/
#      file-extractor.ts does getDocument() → getTextContent() (text stream),
#      and pdf-to-img does getDocument() → page.render({canvas, viewport}) →
#      toBuffer("image/png"). AnnotationLayer.render() is never called.
#   3. Nothing in backend/ai-worker/frontend imports a viewer surface — zero
#      hits for pdfjs-dist/web, PDFViewer, PDFScriptingManager, enableScripting.
#   4. Both call sites already pass isEvalSupported:false (ours explicitly,
#      pdf-to-img internally) — belt-and-braces against the other class.
#   5. Threat-model mismatch: CWE-79 executes in the hosting domain's origin.
#      This runs server-side in Node with no DOM and no origin; the output is a
#      PNG buffer or a string. Merchant PDFs ARE untrusted input, but the
#      vulnerable path is never entered.
# NO BUMP EXISTS: pdf-to-img@6.2.0 is the LATEST release and pins
# pdfjs-dist "~5.6.205", so raising our direct pin to the patched 6.2.108 would
# only add a SECOND, nested 5.6.x copy for pdf-to-img — still flagged, now
# duplicated. `npm audit fix --force` does exactly that or breaks pdf-to-img.
# PROPER RETIREMENT: when a pdf-to-img release moves to pdfjs-dist >=6.2.108,
# bump both together and delete this entry. Re-check with
# `npm view pdf-to-img dependencies`.
IGNORED_GHSA="GHSA-qx2v-qp2m-jg93|GHSA-6g55-p6wh-862q|GHSA-r28c-9q8g-f849|GHSA-fxqj-rqcc-2cmp|GHSA-v2v4-37r5-5v8g|GHSA-mwp4-54f8-5fhr|GHSA-hq66-cqwq-w95j"

# Helper: run audit for a workspace, distinguish network errors from real vulnerabilities
run_audit() {
    local workspace_name="$1"
    local workspace_label="$2"
    local output exit_code=0
    output=$(npm audit --workspace="$workspace_name" --audit-level=high --omit=dev 2>&1) || exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}   ✅ ${workspace_label}: no high/critical vulnerabilities${NC}"
    elif echo "$output" | grep -q "ENOTFOUND\|ECONNREFUSED\|ETIMEDOUT\|EAI_AGAIN\|audit endpoint"; then
        echo -e "${YELLOW}   ⚠️  ${workspace_label}: audit skipped (npm registry unreachable)${NC}"
    else
        # Check if any unignored GHSA advisories remain
        local unignored
        unignored=$(echo "$output" | grep -oE "GHSA-[A-Za-z0-9-]+" | grep -vE "$IGNORED_GHSA" | sort -u)
        if [ -z "$unignored" ]; then
            echo -e "${GREEN}   ✅ ${workspace_label}: no actionable vulnerabilities (${IGNORED_GHSA} acknowledged)${NC}"
        else
            echo -e "${RED}   ❌ ${workspace_label}: high/critical vulnerabilities found!${NC}"
            echo "$output" | tail -20
            AUDIT_FAILED=true
        fi
    fi
}

run_audit "jawab24-backend" "Backend"
run_audit "jawab24-frontend" "Frontend"
run_audit "jawab24-ai-worker" "AI Worker"

if [ "$AUDIT_FAILED" = true ]; then
    echo ""
    echo -e "${RED}   High/critical vulnerabilities detected in production dependencies!${NC}"
    echo -e "${RED}   Run 'npm audit' for details. Do NOT run 'npm audit fix' (its fixes are${NC}"
    echo -e "${RED}   downgrades here — see the allowlist comments above). Bump the affected${NC}"
    echo -e "${RED}   package deliberately or allowlist with a written reachability rationale.${NC}"
    exit 1
fi

# =============================================
# 0.95. Lockfile cross-platform native binaries (npm/cli#4828)
# =============================================
# Production Docker builds run on linux-arm64 Alpine (musl). Regenerating
# package-lock.json on a dev Mac WITH node_modules present makes npm record only
# the darwin variants of native-binary packages (npm/cli#4828); the server's
# npm ci then can't install e.g. @rollup/rollup-linux-arm64-musl and the image
# build dies mid-webpack (2026-08-01 deploy failure, right after PR #589).
# Regenerate locks ONLY from a clean tree:
#   rm -rf node_modules package-lock.json && npm install
echo ""
echo "🧩 Checking lockfile carries linux-arm64 native binaries (npm/cli#4828)..."
MATRIX_FAILED=false
for pair in \
    "@rollup/rollup-darwin-arm64:@rollup/rollup-linux-arm64-musl" \
    "@esbuild/darwin-arm64:@esbuild/linux-arm64" \
    "@next/swc-darwin-arm64:@next/swc-linux-arm64-musl" \
    "@img/sharp-darwin-arm64:@img/sharp-linuxmusl-arm64"; do
    darwin_pkg="${pair%%:*}"
    linux_pkg="${pair##*:}"
    if grep -q "\"node_modules/${darwin_pkg}\"" package-lock.json && \
       ! grep -q "\"node_modules/${linux_pkg}\"" package-lock.json; then
        echo -e "${RED}   ❌ lockfile has ${darwin_pkg} but is missing ${linux_pkg}${NC}"
        MATRIX_FAILED=true
    fi
done
if [ "$MATRIX_FAILED" = true ]; then
    echo -e "${RED}   The server (linux-arm64 musl) cannot build from this lockfile.${NC}"
    echo -e "${RED}   Fix: rm -rf node_modules package-lock.json && npm install  (clean-tree regen)${NC}"
    exit 1
fi
echo -e "${GREEN}   ✅ linux-arm64 native binary matrix present${NC}"

# =============================================
# 1.0. Check REDIS_PASSWORD is set and not the placeholder
# =============================================
echo ""
echo "🔑 Checking REDIS_PASSWORD configuration..."

ENV_FILE="env/backend.env"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}   ⚠️  $ENV_FILE not found — skipping Redis password check (CI environment)${NC}"
else
    REDIS_PW=$(grep -E '^REDIS_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    if [ -z "$REDIS_PW" ]; then
        echo -e "${RED}   ❌ REDIS_PASSWORD is not set in $ENV_FILE!${NC}"
        echo -e "${RED}   A missing password will cause Redis auth failures on every backend restart.${NC}"
        exit 1
    elif [ "$REDIS_PW" = "changeme_in_production" ]; then
        echo -e "${RED}   ❌ REDIS_PASSWORD is still the default placeholder in $ENV_FILE!${NC}"
        echo -e "${RED}   Set a real password before deploying to production.${NC}"
        exit 1
    fi
    echo -e "${GREEN}   ✅ REDIS_PASSWORD is set${NC}"
fi

# =============================================
# 0.97. Cross-file code duplication (Rule 10.8)
# =============================================
# Rule 10.8 was prose-only, so nothing enforced it. The April 2026 `maybeEncrypt`
# extraction migrated four call sites but left a fifth copy behind in
# AuthService, because a `private` member is invisible to a grep for the exported
# name. Known findings live in scripts/duplication-baseline.json and are reported
# without failing; anything new fails. Full scan is ~0.4s.
echo ""
echo "🧬 Checking for new cross-file duplication..."
if node scripts/check-duplication.mjs > /tmp/dupcheck.$$ 2>&1; then
    echo -e "${GREEN}   ✅ No new duplication${NC}"
    grep -E "^Known duplication" /tmp/dupcheck.$$ || true
else
    echo -e "${RED}   ❌ New cross-file duplication introduced (Rule 10.8)${NC}"
    cat /tmp/dupcheck.$$
    echo -e "${RED}   Extract the shared logic into a module both sites import.${NC}"
    echo -e "${YELLOW}   If it is duplication by design: npm run check:duplication:baseline${NC}"
    rm -f /tmp/dupcheck.$$
    exit 1
fi
rm -f /tmp/dupcheck.$$

# =============================================
# 0.98. nginx platform routing (Zid/Salla/Shopify)
# =============================================
# `nginx -t` passes on a config that routes a merchant-facing page to the backend
# (or an OAuth callback to the frontend) — both are 404s that only show up when a
# real merchant or a marketplace reviewer clicks Install. On 2026-08-10 the first
# real Zid install hit a 404 because nginx.conf had no /zid/ block at all, and
# /salla/connected had been silently swallowed by the /salla/ prefix. This boots
# the real config against stub upstreams and asserts where each URL lands.
# Skips (does not fail) when docker is unavailable.
echo ""
echo "🧭 Checking nginx platform routing..."
if ./scripts/check-nginx-routing.sh > /tmp/nginxroute.$$ 2>&1; then
    if grep -q "^SKIP" /tmp/nginxroute.$$; then
        echo -e "${YELLOW}   ⚠️  Skipped (docker unavailable)${NC}"
    else
        echo -e "${GREEN}   ✅ $(grep '^PASS' /tmp/nginxroute.$$)${NC}"
    fi
else
    echo -e "${RED}   ❌ nginx routes a platform URL to the wrong upstream${NC}"
    cat /tmp/nginxroute.$$
    echo -e "${RED}   A Next.js page must reach frontend_active; OAuth/webhooks must reach backend_active.${NC}"
    echo -e "${YELLOW}   Exact-match blocks (location = /x/page) must sit ABOVE the prefix block (location /x/).${NC}"
    rm -f /tmp/nginxroute.$$
    exit 1
fi
rm -f /tmp/nginxroute.$$

# =============================================
# 1. Check for ESM-only packages
# =============================================
echo ""
echo "1️⃣  Checking for ESM-only packages..."

ESM_PACKAGES=("uuid" "node-fetch" "chalk" "ora" "execa" "got" "globby")
for pkg in "${ESM_PACKAGES[@]}"; do
    if grep -q "\"$pkg\":" backend/package.json 2>/dev/null; then
        echo -e "${YELLOW}   ⚠️  Found '$pkg' - may cause ESM errors in production${NC}"
        ERRORS=1
    fi
done

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}   ✅ No ESM-only packages detected${NC}"
fi

# =============================================
# 1.5. Build shared package (required before backend/frontend)
# =============================================
echo ""
echo "1.5️⃣  Building shared package..."
if npm run build --workspace=@jawab24/shared > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Shared package builds successfully${NC}"
else
    echo -e "${RED}   ❌ Shared package build failed!${NC}"
    npm run build --workspace=@jawab24/shared
    exit 1
fi

# =============================================
# 2. TypeScript compilation
# =============================================
echo ""
echo "2️⃣  Checking TypeScript compilation..."
if npm run build --workspace=jawab24-backend > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Backend builds successfully${NC}"
else
    echo -e "${RED}   ❌ Backend build failed!${NC}"
    npm run build --workspace=jawab24-backend
    exit 1
fi

# A running `next dev` for THIS repo USED to corrupt this build: both wrote to
# frontend/.next, so during the build script's `rm -rf .next && lint && next
# build` the dev server's watcher regenerated .next (types/validator.ts, trace,
# dev chunks) and raced `next build`'s export→server-pages rename. Symptoms seen
# in the wild: ENOENT during the rename step, and "File '.next/types/validator.ts'
# not found" during typecheck (root-caused 2026-06-11; 2/3 builds raced with a
# dev server up, 4/4 clean with it down).
#
# That class of failure is now STRUCTURALLY IMPOSSIBLE: `next dev`
# (NODE_ENV=development) writes to `.next-dev` and `next build` (production)
# writes to `.next` — see distDir in next.config.js (PR #310). The two never
# share a path, so a concurrent dev server can no longer corrupt the build.
# This check is therefore a NON-FATAL advisory (belt-and-braces), not a block:
# we still surface a running dev server because it competes for CPU/RAM during
# the build, and because the E2E step later in this script kills whatever listens
# on port 3001 — so the dev server WILL be stopped before tests run regardless.
#
# Detection note: the previous "$(pwd)/node_modules/.bin/next dev" pgrep pattern
# never matched a real dev server — npm runs the dev script through the
# symlink-resolved node_modules/next/dist/bin/next (and the bin is often
# root-hoisted by npm workspaces), so the live command line doesn't contain the
# .bin path. We now match any `next dev` whose command line references this repo
# root, plus a port-3001 (frontend dev port) belt-and-braces check — immune to
# bin-path / symlink / cwd / workspace-hoisting differences. We deliberately do
# NOT block on a non-`next dev` listener (e.g. a stale `next start` from E2E) —
# that doesn't regenerate .next and is auto-killed later in this script.
DEV_SERVER_PIDS=$(
    {
        pgrep -f "next dev" 2>/dev/null || true
        lsof -nP -iTCP:3001 -sTCP:LISTEN -t 2>/dev/null || true
    } | sort -u | while read -r _pid; do
        [ -n "$_pid" ] || continue
        _cmd=$(ps -ww -o command= -p "$_pid" 2>/dev/null || true)
        # A dev server for THIS repo: command names `next dev` AND references the
        # repo root (scopes out other projects' dev servers and non-dev listeners).
        if printf '%s' "$_cmd" | grep -q "next dev" && printf '%s' "$_cmd" | grep -qF "$REPO_ROOT"; then
            echo "$_pid"
        fi
    done | tr '\n' ' ' | sed 's/ *$//'
)
if [ -n "$DEV_SERVER_PIDS" ]; then
    echo -e "${YELLOW}   ⚠️  A Next.js dev server for this repo is running (PID(s): ${DEV_SERVER_PIDS})${NC}"
    echo -e "${YELLOW}      The build is isolated (dev → .next-dev, build → .next), so it${NC}"
    echo -e "${YELLOW}      cannot corrupt this build. It does compete for CPU/RAM, and the${NC}"
    echo -e "${YELLOW}      E2E step later in this script will stop it (it owns port 3001).${NC}"
    echo -e "${YELLOW}      To free resources / keep it alive elsewhere:  kill ${DEV_SERVER_PIDS}${NC}"
fi

# Always clean .next and webpack cache before building to avoid stale vendor chunks
# after npm install. Incremental builds sound nice but cause MODULE_NOT_FOUND errors.
rm -rf frontend/.next frontend/node_modules/.cache
# NEXT_PUBLIC_* vars are baked at build time in standalone mode.
# Set the API URL to a dummy host with /api prefix so that E2E test mocks
# using '**/api/**' patterns match the actual request URLs.
# This only affects the local pre-deploy build — production builds on the server
# use their own .env with the real API URL.
# A retry is kept as belt-and-braces for genuinely transient flakes, but the
# common cause (concurrent dev server) is blocked by the guard above.
# The WhatsApp vars are pinned HERE, not only in build_e2e_frontend() further down.
# That function pins them so "the E2E build is deterministic instead of inheriting
# whatever .env.local holds" — but it only runs when no standalone build exists, and
# THIS build always produces one first, so its pins never actually took effect. E2E
# determinism therefore rested on .env.local carrying the vars, which is exactly what
# the pins were introduced to avoid: in a checkout without .env.local (a fresh
# worktree) the bundle bakes WhatsApp OFF, the nav renders "My Pages" instead of
# "Channels", and six specs across pages/sidebar/mobile-nav fail with nothing wrong
# in the code. Verified 2026-08-07: those specs go 6 red → 44/44 green when the same
# build carries these two values.
build_frontend() {
    CI=true NEXT_PUBLIC_API_URL=http://localhost:4999/api \
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY:-pk_test_placeholder} \
        NEXT_PUBLIC_FB_APP_ID=${NEXT_PUBLIC_FB_APP_ID:-e2e-dummy-fb-app-id} \
        NEXT_PUBLIC_WHATSAPP_CONFIG_ID=${NEXT_PUBLIC_WHATSAPP_CONFIG_ID:-e2e-dummy-whatsapp-config} \
        npm run build --workspace=jawab24-frontend "$@"
}

# Each attempt's output is captured, so the log of the attempt that actually
# failed survives. The old code sent both attempts to /dev/null and then ran the
# build a THIRD time verbosely before an unconditional `exit 1`: when that third
# run PASSED — which it does whenever the failure was environmental, e.g. the
# concurrent-run race the lock at the top of this script now prevents — the gate
# printed a fully green build log under a red "❌ Frontend build failed after
# retry!" and still refused to deploy, with the real failures already discarded.
# Observed 2026-07-28; the same misleading-log bug is documented for the Docker
# step below. A retry that passes is still surfaced (tail of the first failure),
# so a genuine flake never disappears into a green checkmark.
_FE_LOG_1=$(mktemp)
if build_frontend > "$_FE_LOG_1" 2>&1; then
    echo -e "${GREEN}   ✅ Frontend builds successfully${NC}"
    rm -f "$_FE_LOG_1"
else
    echo -e "${YELLOW}   ⚠️  Frontend build failed on first attempt — retrying with clean cache${NC}"
    echo -e "${YELLOW}      First attempt ended with:${NC}"
    tail -12 "$_FE_LOG_1" | sed 's/^/      /'
    rm -rf frontend/.next
    _FE_LOG_2=$(mktemp)
    if build_frontend > "$_FE_LOG_2" 2>&1; then
        echo -e "${GREEN}   ✅ Frontend builds successfully (passed on retry — first attempt flaked, see above)${NC}"
        rm -f "$_FE_LOG_1" "$_FE_LOG_2"
    else
        echo -e "${RED}   ❌ Frontend build failed on both attempts. Retry output:${NC}"
        cat "$_FE_LOG_2"
        rm -f "$_FE_LOG_1" "$_FE_LOG_2"
        exit 1
    fi
fi

# Verify CSS output is non-trivial (catches silent Tailwind/PostCSS failures)
CSS_DIR="frontend/.next/static/css"
if [ -d "$CSS_DIR" ]; then
    CSS_SIZE=$(find "$CSS_DIR" -name "*.css" -exec cat {} + 2>/dev/null | wc -c | tr -d ' ')
    if [ "$CSS_SIZE" -lt 5000 ]; then
        echo -e "${RED}   ❌ CSS output is suspiciously small (${CSS_SIZE} bytes)!${NC}"
        echo -e "${RED}   This likely means Tailwind CSS is not processing correctly.${NC}"
        echo -e "${RED}   Check postcss.config.js and tailwind.config.js${NC}"
        exit 1
    fi
    echo -e "${GREEN}   ✅ CSS output size OK (${CSS_SIZE} bytes)${NC}"
else
    echo -e "${RED}   ❌ No CSS output directory found after build!${NC}"
    exit 1
fi

# Smoke-test the standalone artifact — boot the traced server and request one
# page. Catches runtime modules Next's file tracing missed (dynamic requires):
# 2026-08-01 a floated @sentry/nextjs@10.69 required meriyah dynamically; the
# build passed but every SSR request 500'd with MODULE_NOT_FOUND, and it only
# surfaced 10 minutes later in the E2E step. This dies here in seconds instead.
STANDALONE_SERVER="frontend/.next/standalone/frontend/server.js"
if [ -f "$STANDALONE_SERVER" ]; then
    SMOKE_PORT=3197
    # a foreign/stale listener would answer our curl and fake the verdict —
    # refuse to run rather than report an untrustworthy result
    if lsof -iTCP:${SMOKE_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
        echo -e "${RED}   ❌ Port ${SMOKE_PORT} is already in use — cannot smoke-test the standalone server.${NC}"
        echo -e "${RED}   Likely a stale smoke server from an aborted run:${NC}"
        lsof -iTCP:${SMOKE_PORT} -sTCP:LISTEN 2>/dev/null | sed 's/^/      /' || true
        echo -e "${RED}   Kill it and rerun.${NC}"
        exit 1
    fi
    PORT=$SMOKE_PORT HOSTNAME=127.0.0.1 node "$STANDALONE_SERVER" > /tmp/standalone-smoke.log 2>&1 &
    SMOKE_PID=$!
    SMOKE_OK=false
    # every command below is || true guarded: this script runs under set -e, and
    # a pre-bind curl (exit 7), a kill on an exited PID, or wait's SIGTERM status
    # must poll/clean up, not abort the whole check (bit us 2026-08-01)
    for _ in $(seq 1 30); do
        if ! kill -0 "$SMOKE_PID" 2>/dev/null; then break; fi
        SMOKE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SMOKE_PORT}/en/login" 2>/dev/null || true)
        if [ "$SMOKE_CODE" = "200" ]; then SMOKE_OK=true; break; fi
        if [ "$SMOKE_CODE" = "500" ]; then break; fi
        sleep 1
    done
    # Next's standalone server shuts down "gracefully" on SIGTERM and can
    # linger holding the port (orphan observed 2026-08-01) — escalate to KILL
    kill "$SMOKE_PID" 2>/dev/null || true
    for _ in 1 2 3; do
        kill -0 "$SMOKE_PID" 2>/dev/null || break
        sleep 1
    done
    kill -9 "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
    if [ "$SMOKE_OK" = true ]; then
        echo -e "${GREEN}   ✅ Standalone server smoke test passes (SSR 200)${NC}"
    else
        echo -e "${RED}   ❌ Standalone server failed to serve a page (got '${SMOKE_CODE:-no response}')${NC}"
        echo -e "${RED}   A runtime module is likely missing from the standalone trace:${NC}"
        grep -m 3 "Cannot find module" /tmp/standalone-smoke.log 2>/dev/null | sed 's/^/      /' || true
        echo -e "${RED}   Full log: /tmp/standalone-smoke.log${NC}"
        exit 1
    fi
else
    echo -e "${RED}   ❌ No standalone server.js after build — output: 'standalone' broken?${NC}"
    exit 1
fi

if npm run build --workspace=jawab24-ai-worker > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ AI Worker builds successfully${NC}"
else
    echo -e "${RED}   ❌ AI Worker build failed!${NC}"
    npm run build --workspace=jawab24-ai-worker
    exit 1
fi

# =============================================
# 3. Linting
# =============================================
echo ""
echo "3️⃣  Running linters..."
if npm run lint --workspace=jawab24-backend > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Backend lint passes${NC}"
else
    echo -e "${RED}   ❌ Backend lint failed!${NC}"
    npm run lint --workspace=jawab24-backend
    exit 1
fi

if npm run lint --workspace=jawab24-frontend > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Frontend lint passes${NC}"
else
    echo -e "${RED}   ❌ Frontend lint failed!${NC}"
    npm run lint --workspace=jawab24-frontend
    exit 1
fi

if npm run lint --workspace=jawab24-ai-worker > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ AI Worker lint passes${NC}"
else
    echo -e "${RED}   ❌ AI Worker lint failed!${NC}"
    npm run lint --workspace=jawab24-ai-worker
    exit 1
fi

# @jawab24/shared was omitted here, so its lint errors only ever surfaced in the
# repo-wide `npm run lint` — it sat red while deploys kept passing. It ships in
# both the backend and frontend images, so it gets the same gate as they do.
if npm run lint --workspace=@jawab24/shared > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Shared package lint passes${NC}"
else
    echo -e "${RED}   ❌ Shared package lint failed!${NC}"
    npm run lint --workspace=@jawab24/shared
    exit 1
fi

# =============================================
# 4. Code quality checks
# =============================================
echo ""
echo "4️⃣  Code quality checks..."

# Duplicate /api/api paths in frontend
echo "   Checking for duplicate API paths..."
if grep -r "'/api/" frontend/src/lib/api.ts 2>/dev/null; then
    echo -e "${RED}   ❌ Found API paths with /api prefix in api.ts!${NC}"
    echo -e "${RED}   The baseURL already includes /api — use '/plans' instead of '/api/plans'${NC}"
    exit 1
fi
if grep -r "/api/api" frontend/src/ 2>/dev/null; then
    echo -e "${RED}   ❌ Found duplicate /api/api in frontend code!${NC}"
    exit 1
fi
echo -e "${GREEN}   ✅ No duplicate API paths${NC}"

# Validate migration files
if [ -f "backend/scripts/validate-migrations.ts" ]; then
    echo "   Validating migrations..."
    if (cd backend && npx ts-node scripts/validate-migrations.ts) > /dev/null 2>&1; then
        echo -e "${GREEN}   ✅ Migrations valid${NC}"
    else
        echo -e "${RED}   ❌ Migration validation failed!${NC}"
        (cd backend && npx ts-node scripts/validate-migrations.ts)
        exit 1
    fi
fi

# Schema drift
echo "   Checking for schema drift..."
chmod +x scripts/check-schema-drift.sh
if ./scripts/check-schema-drift.sh; then
    echo -e "${GREEN}   ✅ No schema drift detected${NC}"
else
    echo -e "${RED}   ❌ Schema drift detected!${NC}"
    echo ""
    echo "Run: npm run db:generate --workspace=jawab24-backend"
    exit 1
fi

# =============================================
# 5. Unit tests (no DB needed — fast, fail early)
# =============================================
echo ""
echo "5️⃣  Running tests..."

echo "   Testing Shared Package..."
_TEST_LOG=$(mktemp)
if npm test --workspace=@jawab24/shared -- --run > "$_TEST_LOG" 2>&1; then
    echo -e "${GREEN}   ✅ Shared package tests pass${NC}"
    rm -f "$_TEST_LOG"
else
    echo -e "${RED}   ❌ Shared package tests failed!${NC}"
    cat "$_TEST_LOG"; rm -f "$_TEST_LOG"
    exit 1
fi

echo "   Testing Backend (Unit + coverage thresholds)..."
_TEST_LOG=$(mktemp)
if npm run test:coverage --workspace=jawab24-backend > "$_TEST_LOG" 2>&1; then
    echo -e "${GREEN}   ✅ Backend tests pass (coverage thresholds met)${NC}"
    rm -f "$_TEST_LOG"
else
    echo -e "${RED}   ❌ Backend tests or coverage thresholds failed!${NC}"
    cat "$_TEST_LOG"; rm -f "$_TEST_LOG"
    exit 1
fi

echo "   Testing Frontend (Unit + coverage thresholds)..."
_TEST_LOG=$(mktemp)
if npm run test:coverage --workspace=jawab24-frontend > "$_TEST_LOG" 2>&1; then
    echo -e "${GREEN}   ✅ Frontend unit tests pass (coverage thresholds met)${NC}"
    rm -f "$_TEST_LOG"
else
    echo -e "${RED}   ❌ Frontend tests or coverage thresholds failed!${NC}"
    cat "$_TEST_LOG"; rm -f "$_TEST_LOG"
    exit 1
fi

echo "   Testing AI Worker..."
_TEST_LOG=$(mktemp)
if npm test --workspace=jawab24-ai-worker -- --run > "$_TEST_LOG" 2>&1; then
    echo -e "${GREEN}   ✅ AI Worker tests pass${NC}"
    rm -f "$_TEST_LOG"
else
    echo -e "${RED}   ❌ AI Worker tests failed!${NC}"
    cat "$_TEST_LOG"; rm -f "$_TEST_LOG"
    exit 1
fi

# =============================================
# 6. Integration tests (requires Postgres — hard gate)
# =============================================
echo ""
echo "6️⃣  Integration tests..."

# Check if Postgres is reachable; if not, auto-start via Docker (local only)
if ! pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
    if [ "$CI" = "true" ]; then
        echo -e "${RED}   ❌ Postgres not available in CI! Check service container config.${NC}"
        exit 1
    fi
    echo -e "${YELLOW}   ⏳ Postgres not running on ${PG_HOST}:${PG_PORT} — starting via Docker...${NC}"
    docker compose -f docker-compose.dev.yml up -d postgres
    RETRIES=30
    until pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null || [ "$RETRIES" -eq 0 ]; do
        sleep 1
        RETRIES=$((RETRIES - 1))
    done
    if [ "$RETRIES" -eq 0 ]; then
        echo -e "${RED}   ❌ Postgres failed to start within 30 seconds!${NC}"
        echo -e "${RED}   Integration tests cannot run. Ensure Docker is available.${NC}"
        exit 1
    fi
    echo -e "${GREEN}   ✅ Postgres started${NC}"
fi

# Drop and recreate the test database for a clean slate.
# This prevents schema drift issues from previous drizzle-kit push:pg runs.
# Integration tests now use migrations (not push:pg) which match production.
#
# SAFETY: two independent conditions, BOTH required.
#
#   1. The name must satisfy scripts/testDatabaseName.mjs — the single, anchored
#      rule shared with globalSetup.ts and setup.ts.
#   2. The server must be local.
#
# Until 2026-08-09 this was an `||`, but the DROP target was the LITERAL string
# `autoreply_test`, so a loose guard in front of a fixed target could not reach
# anything else. This step now drops ${TEST_DB_NAME}, i.e. whatever DATABASE_URL
# resolves to — which is what makes the guard load-bearing, and why it must not be
# a prefix glob. `[[ $name == autoreply_test* ]]` accepts
# `autoreply_test; DROP DATABASE autoreply` and hands the tail to psql as a second
# statement; the shared validator is anchored and rejects it.
# Integration tests should always start with a fresh database to ensure reproducibility.
echo "   Setting up clean test database (${TEST_DB_NAME})..."
if node "$REPO_ROOT/scripts/testDatabaseName.mjs" --validate "$TEST_DB_NAME" \
    && { [[ "$PG_HOST" == "localhost" ]] || [[ "$PG_HOST" == "127.0.0.1" ]]; }; then
    # Every psql call below used to be silenced with `> /dev/null 2>&1`. Combined
    # with `set -e` at the top of this script, that made a failure here INVISIBLE:
    # the gate died immediately after the line above and printed nothing at all,
    # so the deploy log showed a bare "Pre-deploy checks failed!" with no cause.
    # Seen live 2026-08-09; the failing command was DROP DATABASE, which Postgres
    # refuses while another session is connected to the database. Capture the
    # output and print it on failure instead.
    _DB_LOG=$(mktemp)
    _test_psql() {
        PGPASSWORD=postgres psql -h "$PG_HOST" -p "$PG_PORT" -U postgres \
            -v ON_ERROR_STOP=1 -q -c "$1" >> "$_DB_LOG" 2>&1
    }
    # Terminate connections left behind by a PREVIOUS run. No run in another
    # checkout can be attached — the name is unique to this one — but a hand-run
    # `npm run test:integration:local` in THIS checkout uses the same database and
    # takes no gate lock, so it can still be attached and will be killed here.
    if ! _test_psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB_NAME}' AND pid <> pg_backend_pid()" \
        || ! _test_psql "DROP DATABASE IF EXISTS \"${TEST_DB_NAME}\"" \
        || ! _test_psql "CREATE DATABASE \"${TEST_DB_NAME}\""; then
        echo -e "${RED}   ❌ Could not recreate test database ${TEST_DB_NAME} on ${PG_HOST}:${PG_PORT}!${NC}"
        cat "$_DB_LOG"
        exit 1
    fi
    echo -e "${GREEN}   ✅ Test database created (${TEST_DB_NAME})${NC}"
else
    echo -e "${RED}   ❌ Safety check failed: refusing to drop '${TEST_DB_NAME}' on ${PG_HOST}.${NC}"
    echo -e "${RED}   The test database must match ^autoreply_test[a-z0-9_]*\$ and live on localhost.${NC}"
    exit 1
fi

echo "   Testing Backend (Integration)..."
_TEST_LOG=$(mktemp)
if (cd backend && npm run test:integration) > "$_TEST_LOG" 2>&1; then
    echo -e "${GREEN}   ✅ Backend integration tests pass${NC}"
    rm -f "$_TEST_LOG"
else
    echo -e "${RED}   ❌ Backend integration tests failed!${NC}"
    cat "$_TEST_LOG"; rm -f "$_TEST_LOG"
    exit 1
fi

# ---------------------------------------------------------------------------
# 6b. Real Stripe round-trip (test mode) — payments must be PROVEN, not assumed
#
# Every other payment test mocks stripeService, which is precisely how merchants
# were charged and never activated for weeks with a green suite: the tests
# validated our model of Stripe, not Stripe. This step makes one genuine
# subscribe → pay → activate cycle against Stripe TEST mode.
#
# A missing key is a HARD FAILURE, not a skip. "No key so we skipped it" reads
# identically to "payments verified" in a deploy log, and that indistinguishable
# silence is the bug class this whole gate exists to prevent. Opt out only
# deliberately, with ALLOW_UNVERIFIED_PAYMENTS=1, which says so out loud.
# ---------------------------------------------------------------------------
echo "   Testing Backend (real Stripe round-trip, test mode)..."
if [ -n "${STRIPE_TEST_SECRET_KEY:-}" ] && [[ "${STRIPE_TEST_SECRET_KEY}" == sk_test_* ]]; then
    _TEST_LOG=$(mktemp)
    if (cd backend && STRIPE_ROUNDTRIP=1 STRIPE_SECRET_KEY="$STRIPE_TEST_SECRET_KEY" \
            npm run test:integration -- stripe.roundtrip) > "$_TEST_LOG" 2>&1; then
        echo -e "${GREEN}   ✅ Real Stripe round-trip passes (subscribe → pay → activate)${NC}"
        rm -f "$_TEST_LOG"
    else
        echo -e "${RED}   ❌ Real Stripe round-trip FAILED — do not deploy payments!${NC}"
        cat "$_TEST_LOG"; rm -f "$_TEST_LOG"
        exit 1
    fi
elif [ "${ALLOW_UNVERIFIED_PAYMENTS:-}" = "1" ]; then
    echo -e "${YELLOW}   ⚠️  SKIPPED by ALLOW_UNVERIFIED_PAYMENTS=1 — payments are NOT verified in this deploy.${NC}"
else
    echo -e "${RED}   ❌ STRIPE_TEST_SECRET_KEY is not set (or is not an sk_test_ key).${NC}"
    echo -e "${RED}   The payment path cannot be verified, and an unverified payment path is${NC}"
    echo -e "${RED}   how merchants got charged without being activated.${NC}"
    echo ""
    echo -e "${YELLOW}   Fix: add the test-mode key from Stripe Dashboard → Developers → API keys${NC}"
    echo -e "${YELLOW}         - locally: export STRIPE_TEST_SECRET_KEY=sk_test_...${NC}"
    echo -e "${YELLOW}         - in CI:   gh secret set STRIPE_TEST_SECRET_KEY${NC}"
    echo -e "${YELLOW}   Or, deliberately and visibly: ALLOW_UNVERIFIED_PAYMENTS=1 ./scripts/pre-deploy-check.sh${NC}"
    exit 1
fi

# =============================================
# 7. E2E tests
# =============================================
echo ""
echo "7️⃣  E2E tests..."

# Clean only test artifacts — keep .next from step 2's production build.
# Playwright uses `next start` (CI=true) so .next files are static and stable —
# no HMR/Fast Refresh rewriting files mid-test (eliminates ENOENT race conditions).
rm -rf frontend/test-results frontend/playwright-report frontend/blob-report

# Safety: if .next is missing OR standalone is missing (e.g. last build was mobile/export
# or dev mode), rebuild with standalone output. Clean .next first — partial/dev artifacts
# cause Next 15 incremental builds to "compile successfully" then fail page data collection
# with PageNotFoundError on otherwise-valid pages.
#
# The WhatsApp vars are PINNED (dummy non-empty = feature visible) so the E2E build
# is deterministic instead of inheriting whatever .env.local holds. NEXT_PUBLIC_*
# is baked into the client bundle at BUILD time — the playwright.config.ts env
# block cannot change an already-built bundle. WhatsApp is GA (2026-07-26), the
# specs assert the GA labels ("Channels"), so an OFF build fails six specs; see
# the matching pins in frontend/playwright.config.ts (they cover the dev-server
# path the same way).
build_e2e_frontend() {
    (cd frontend && CI=true \
        NEXT_PUBLIC_API_URL=http://localhost:4999/api \
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY:-pk_test_placeholder} \
        NEXT_PUBLIC_FB_APP_ID=e2e-dummy-fb-app-id \
        NEXT_PUBLIC_WHATSAPP_CONFIG_ID=e2e-dummy-whatsapp-config \
        npx next build)
}
if [ ! -d "frontend/.next" ] || [ ! -d "frontend/.next/standalone" ]; then
    echo "   ⚠️  No standalone .next build found, building for E2E..."
    rm -rf frontend/.next frontend/node_modules/.cache
    if ! build_e2e_frontend > /dev/null 2>&1; then
        echo -e "${RED}   ❌ E2E build failed — retrying with clean cache${NC}"
        rm -rf frontend/.next frontend/node_modules/.cache
        if ! build_e2e_frontend; then
            exit 1
        fi
    fi
fi

# Standalone output requires static files copied into the standalone dir.
# Without this, the standalone server.js can't serve CSS/JS/images.
if [ -d "frontend/.next/standalone" ]; then
    cp -r frontend/.next/static frontend/.next/standalone/frontend/.next/static 2>/dev/null || true
    cp -r frontend/public frontend/.next/standalone/frontend/public 2>/dev/null || true
fi

# Kill any existing process on port 3001 so Playwright can start its own server
if lsof -ti:3001 > /dev/null 2>&1; then
    echo "   Stopping existing process on port 3001..."
    kill $(lsof -ti:3001) 2>/dev/null || true
    sleep 1
fi

# Ensure Playwright browsers are installed
echo "   Ensuring Playwright browsers are available..."
if [ "$CI" = "true" ]; then
    (cd frontend && npx playwright install --with-deps chromium) > /dev/null 2>&1
else
    (cd frontend && npx playwright install chromium) > /dev/null 2>&1 || true
fi

# CI=true triggers: forbidOnly, retries:2, single worker, no server reuse.
# Locally that OOM-kills Chromium (Next dev server + browser + retries).
# Use --retries=0 and list reporter locally to keep memory in check.
E2E_EXTRA_ARGS=""
if [ "$CI" != "true" ]; then
    E2E_EXTRA_ARGS="--retries=0 --reporter=list"
fi

if (cd frontend && CI=true npx playwright test $E2E_EXTRA_ARGS); then
    echo -e "${GREEN}   ✅ Frontend E2E tests pass${NC}"
else
    echo -e "${RED}   ❌ Frontend E2E tests failed!${NC}"
    echo "   Check playwright report for details."
    exit 1
fi

# =============================================
# 8. Docker build (skipped in CI — handled by dedicated Docker job with buildx)
# =============================================
if [ "$CI" != "true" ]; then
    echo ""
    echo "8️⃣  Building Docker image..."

    # Pre-flight: reclaim disk so the build doesn't ENOSPC on OrbStack VM.
    # Only touches build cache + dangling/untagged images — leaves tagged
    # images and running containers alone. Quiet unless something fails.
    docker builder prune -af > /dev/null 2>&1 || true
    docker image prune -f > /dev/null 2>&1 || true

    # Build once, capturing output to a log (same pattern as the test steps
    # above). A first-build failure here is frequently TRANSIENT: the cache was
    # just pruned, so `npm ci` runs uncached against the network — a registry
    # hiccup or a momentary BuildKit/disk blip fails the attempt. The build is
    # idempotent, so retry ONCE (reusing any layers the first attempt cached)
    # before failing the gate; only surface the log — and exit — if BOTH fail.
    # (The old code discarded the first attempt's error to /dev/null, then did a
    # blind verbose re-run whose success was ignored — producing a misleading
    # "❌ failed!" next to a green build log, with no actual error to act on.)
    _DOCKER_LOG=$(mktemp)
    if docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check . > "$_DOCKER_LOG" 2>&1; then
        echo -e "${GREEN}   ✅ Docker image builds successfully${NC}"
        rm -f "$_DOCKER_LOG"
    elif docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check . > "$_DOCKER_LOG" 2>&1; then
        echo -e "${GREEN}   ✅ Docker image builds successfully (passed on retry — first attempt flaked)${NC}"
        rm -f "$_DOCKER_LOG"
    else
        echo -e "${RED}   ❌ Docker build failed (both attempts). Build output:${NC}"
        cat "$_DOCKER_LOG"; rm -f "$_DOCKER_LOG"
        exit 1
    fi
fi

# =============================================
# Summary
# =============================================
echo ""
echo "==========================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All pre-deploy checks passed!${NC}"
    echo "   Safe to deploy to production."
    if [ "$CI" != "true" ]; then
        echo ""
        echo "   Note: Docker smoke tests (container startup) run in CI only."
    fi
else
    echo -e "${YELLOW}⚠️  Checks completed with warnings${NC}"
    echo "   Review warnings before deploying."
fi
echo ""
