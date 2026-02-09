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
# 0.7. Dependency security audit
# =============================================
echo ""
echo "🔒 Running dependency security audit..."

AUDIT_FAILED=false

# Backend audit
if npm audit --workspace=jawab24-backend --audit-level=high --omit=dev > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Backend: no high/critical vulnerabilities${NC}"
else
    echo -e "${RED}   ❌ Backend: high/critical vulnerabilities found!${NC}"
    npm audit --workspace=jawab24-backend --audit-level=high --omit=dev 2>&1 | tail -20
    AUDIT_FAILED=true
fi

# Frontend audit
if npm audit --workspace=jawab24-frontend --audit-level=high --omit=dev > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Frontend: no high/critical vulnerabilities${NC}"
else
    echo -e "${RED}   ❌ Frontend: high/critical vulnerabilities found!${NC}"
    npm audit --workspace=jawab24-frontend --audit-level=high --omit=dev 2>&1 | tail -20
    AUDIT_FAILED=true
fi

# AI Worker audit
if npm audit --workspace=jawab24-ai-worker --audit-level=high --omit=dev > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ AI Worker: no high/critical vulnerabilities${NC}"
else
    echo -e "${RED}   ❌ AI Worker: high/critical vulnerabilities found!${NC}"
    npm audit --workspace=jawab24-ai-worker --audit-level=high --omit=dev 2>&1 | tail -20
    AUDIT_FAILED=true
fi

if [ "$AUDIT_FAILED" = true ]; then
    echo ""
    echo -e "${RED}   High/critical vulnerabilities detected in production dependencies!${NC}"
    echo -e "${RED}   Run 'npm audit' for details and 'npm audit fix' to attempt auto-fix.${NC}"
    exit 1
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

# Clean frontend cache to prevent conflicts with mobile build artifacts
rm -rf frontend/.next

if npm run build --workspace=jawab24-frontend > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Frontend builds successfully${NC}"
else
    echo -e "${RED}   ❌ Frontend build failed!${NC}"
    rm -rf frontend/.next
    npm run build --workspace=jawab24-frontend
    exit 1
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

echo "   Testing Backend (Unit)..."
if npm test --workspace=jawab24-backend -- --run > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Backend tests pass${NC}"
else
    echo -e "${RED}   ❌ Backend tests failed!${NC}"
    npm test --workspace=jawab24-backend -- --run
    exit 1
fi

echo "   Testing Frontend (Unit)..."
if npm test --workspace=jawab24-frontend -- --run > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Frontend unit tests pass${NC}"
else
    echo -e "${RED}   ❌ Frontend unit tests failed!${NC}"
    npm test --workspace=jawab24-frontend -- --run
    exit 1
fi

echo "   Testing AI Worker..."
if npm test --workspace=jawab24-ai-worker -- --run > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ AI Worker tests pass${NC}"
else
    echo -e "${RED}   ❌ AI Worker tests failed!${NC}"
    npm test --workspace=jawab24-ai-worker -- --run
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

# Ensure the autoreply_test database exists (dev compose creates 'autoreply', not 'autoreply_test')
PGPASSWORD=postgres psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname = 'autoreply_test'" 2>/dev/null | grep -q 1 \
    || PGPASSWORD=postgres psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -c \
    "CREATE DATABASE autoreply_test" 2>/dev/null

echo "   Testing Backend (Integration)..."
if (cd backend && npm run test:integration) > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Backend integration tests pass${NC}"
else
    echo -e "${RED}   ❌ Backend integration tests failed!${NC}"
    (cd backend && npm run test:integration)
    exit 1
fi

# =============================================
# 7. E2E tests
# =============================================
echo ""
echo "7️⃣  E2E tests..."

# Clean frontend build (E2E rebuilds via Playwright webServer)
rm -rf frontend/.next

# Ensure Playwright browsers are installed
echo "   Ensuring Playwright browsers are available..."
if [ "$CI" = "true" ]; then
    (cd frontend && npx playwright install --with-deps chromium) > /dev/null 2>&1
else
    (cd frontend && npx playwright install chromium) > /dev/null 2>&1 || true
fi

if (cd frontend && CI=true npx playwright test); then
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
