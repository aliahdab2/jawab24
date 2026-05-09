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

# Database URL: CI provides this via env; locally falls back to dev Docker on port 5433.
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/autoreply_test}"
PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
PG_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')

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

# GHSA-3ppc-4f35-3m26 — minimatch ReDoS inside @sentry/node's bundler tooling.
# Patterns are developer-supplied (not user input); no upstream fix yet.
# GHSA-gpj5-g38j-94v9 — drizzle-orm SQL injection via dynamic identifiers.
# We use static schema only (no dynamic table/column names). Fix requires major upgrade (0.29→0.45).
# GHSA-vpq2-c234-7xj6 — teeny-request via @google-cloud/firestore (optional dep of firebase-admin).
# Transitive, no direct fix available until firebase-admin ships patched version.
# GHSA-q4gf-8mx6-v5v3 — Next.js DoS via Server Components (next@16.0.0-beta.0 - 16.2.2).
# next-intl declares next@^16.0.0 as a peer dep, causing npm to hoist next@16.2.1 at root.
# Our app runs on frontend/node_modules/next@15.5.15 (patched). The root next@16.x is a
# resolution artifact only — it does not serve requests. Additionally, we use Pages Router
# exclusively (no App Router server components), so the DoS vector does not apply.
# GHSA-w5hq-g745-h8pq — uuid missing buffer bounds check in v3/v5/v6 when caller passes
# pre-allocated `buf`. Transitive via bullmq/exceljs/gaxios; none of them call uuid with a
# caller-provided buffer (all use the no-arg form for ID generation). Vulnerable code path
# unreachable. Re-audit when these packages bump their uuid dep to >=14.
# GHSA-qx2v-qp2m-jg93 — postcss XSS via unescaped </style> in CSS stringify output (moderate).
# postcss is build-time CSS tooling for the frontend (tailwindcss/autoprefixer/next). It never
# processes user-controlled CSS at runtime — output is static CSS files baked into the bundle.
# The XSS vector requires runtime stringification of attacker-controlled CSS, which we don't do.
# Surfaces in the backend audit only because npm audit reads the workspace-wide lockfile.
# GHSA-v2v4-37r5-5v8g — ip-address XSS in Address6 HTML-emitting methods (moderate).
# Transitive via geoip-lite. We only call geoip.lookup(ip), which returns a plain JS object
# (country/region/city). The vulnerable Address6.toString()/HTML-emitter methods are never
# invoked, so the XSS path is unreachable.
# GHSA-4c35-wcg5-mm9h — next-intl prototype pollution via experimental.messages.precompile
# with attacker-controlled translation catalog keys. We use the standard getMessages flow
# (makeGetStaticProps loading static JSON from frontend/src/i18n/{en,ar}/*.json) and do not
# enable experimental.messages.precompile. Vulnerable code path is unreachable.
# GHSA-r27j-894h-3w3p — icu-minify DoS via unsanitized `select` key lookup on Object.prototype
# when precompile: true. Transitive via next-intl's precompile feature, which we don't use
# (see GHSA-4c35-wcg5-mm9h above). Vulnerable code path is unreachable.
IGNORED_GHSA="GHSA-3ppc-4f35-3m26|GHSA-gpj5-g38j-94v9|GHSA-vpq2-c234-7xj6|GHSA-q4gf-8mx6-v5v3|GHSA-w5hq-g745-h8pq|GHSA-qx2v-qp2m-jg93|GHSA-v2v4-37r5-5v8g|GHSA-4c35-wcg5-mm9h|GHSA-r27j-894h-3w3p"

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
    echo -e "${RED}   Run 'npm audit' for details and 'npm audit fix' to attempt auto-fix.${NC}"
    exit 1
fi

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

# Always clean .next and webpack cache before building to avoid stale vendor chunks
# after npm install. Incremental builds sound nice but cause MODULE_NOT_FOUND errors.
rm -rf frontend/.next frontend/node_modules/.cache
# NEXT_PUBLIC_* vars are baked at build time in standalone mode.
# Set the API URL to a dummy host with /api prefix so that E2E test mocks
# using '**/api/**' patterns match the actual request URLs.
# This only affects the local pre-deploy build — production builds on the server
# use their own .env with the real API URL.
# Next.js 15 + i18n occasionally hits a flaky ENOENT during the export→server-pages
# rename step (race condition in parallel static-page generation). Retry once with a
# clean .next dir before declaring failure.
build_frontend() {
    CI=true NEXT_PUBLIC_API_URL=http://localhost:4999/api NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY:-pk_test_placeholder} npm run build --workspace=jawab24-frontend "$@"
}

if build_frontend > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Frontend builds successfully${NC}"
else
    echo -e "${YELLOW}   ⚠️  Frontend build failed on first attempt — retrying with clean cache${NC}"
    rm -rf frontend/.next
    if build_frontend > /dev/null 2>&1; then
        echo -e "${GREEN}   ✅ Frontend builds successfully (on retry)${NC}"
    else
        echo -e "${RED}   ❌ Frontend build failed after retry!${NC}"
        rm -rf frontend/.next
        build_frontend
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
# SAFETY: This only affects autoreply_test (test DB), never production.
# Integration tests should always start with a fresh database to ensure reproducibility.
echo "   Setting up clean test database (autoreply_test)..."
if [[ "$DATABASE_URL" == *"autoreply_test"* ]] || [[ "$PG_HOST" == "localhost" ]] || [[ "$PG_HOST" == "127.0.0.1" ]]; then
    # Terminate lingering connections (e.g. from a previous test run) so DROP succeeds
    PGPASSWORD=postgres psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='autoreply_test' AND pid <> pg_backend_pid()" > /dev/null 2>&1
    PGPASSWORD=postgres psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c \
        "DROP DATABASE IF EXISTS autoreply_test" > /dev/null 2>&1
    PGPASSWORD=postgres psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c \
        "CREATE DATABASE autoreply_test" > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Test database created${NC}"
else
    echo -e "${RED}   ❌ Safety check failed: Not running on localhost!${NC}"
    echo -e "${RED}   Test database operations are only allowed locally.${NC}"
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

# =============================================
# 7. E2E tests
# =============================================
echo ""
echo "7️⃣  E2E tests..."

# Clean only test artifacts — keep .next from step 2's production build.
# Playwright uses `next start` (CI=true) so .next files are static and stable —
# no HMR/Fast Refresh rewriting files mid-test (eliminates ENOENT race conditions).
rm -rf frontend/test-results frontend/playwright-report frontend/blob-report

# Safety: if .next is missing OR standalone is missing (e.g. last build was mobile/export),
# rebuild with standalone output now.
if [ ! -d "frontend/.next" ] || [ ! -d "frontend/.next/standalone" ]; then
    echo "   ⚠️  No standalone .next build found, building for E2E..."
    if ! (cd frontend && CI=true NEXT_PUBLIC_API_URL=http://localhost:4999/api NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY:-pk_test_placeholder} npx next build) > /dev/null 2>&1; then
        echo -e "${RED}   ❌ E2E build failed!${NC}"
        (cd frontend && CI=true NEXT_PUBLIC_API_URL=http://localhost:4999/api NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${STRIPE_PUBLISHABLE_KEY:-pk_test_placeholder} npx next build)
        exit 1
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

    if docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check . > /dev/null 2>&1; then
        echo -e "${GREEN}   ✅ Docker image builds successfully${NC}"
    else
        echo -e "${RED}   ❌ Docker build failed!${NC}"
        docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check .
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
