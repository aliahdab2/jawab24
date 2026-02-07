#!/bin/bash
#
# Pre-Deploy Check Script
# Run this before deploying to catch issues early
#
# Usage: ./scripts/pre-deploy-check.sh
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

# 0. Verify critical config files exist (prevents silent CSS/build failures)
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

# 1. Check for ESM-only packages
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

# 2. Check TypeScript compilation
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
    # Clean again — the failed first attempt may leave a corrupted .next
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

# 3. Run tests
echo ""
echo "3️⃣  Running tests..."
# Backend Tests
echo "   Testing Backend..."
if npm test --workspace=jawab24-backend -- --run > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Backend tests pass${NC}"
else
    echo -e "${RED}   ❌ Backend tests failed!${NC}"
    npm test --workspace=jawab24-backend -- --run
    exit 1
fi

# Frontend Tests
echo "   Testing Frontend (Unit)..."
if npm test --workspace=jawab24-frontend -- --run > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Frontend unit tests pass${NC}"
else
    echo -e "${RED}   ❌ Frontend unit tests failed!${NC}"
    npm test --workspace=jawab24-frontend -- --run
    exit 1
fi

# Frontend E2E Tests
echo "   Testing Frontend (E2E)..."
# Clean production build artifacts — the standalone output conflicts with the dev server
rm -rf frontend/.next
# Use subshell to avoid changing directory main script
# Set CI=true to force Playwright to use 'npm start' (production build) instead of 'next dev'
if (cd frontend && CI=true npx playwright test); then
    echo -e "${GREEN}   ✅ Frontend E2E tests pass${NC}"
else
    echo -e "${RED}   ❌ Frontend E2E tests failed!${NC}"
    echo "   Check playwright report for details."
    exit 1
fi

# AI Worker Tests
echo "   Testing AI Worker..."
if npm test --workspace=jawab24-ai-worker -- --run > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ AI Worker tests pass${NC}"
else
    echo -e "${RED}   ❌ AI Worker tests failed!${NC}"
    npm test --workspace=jawab24-ai-worker -- --run
    exit 1
fi

# 4. Check for schema drift
echo ""
echo "4️⃣  Checking for schema drift..."
if ./scripts/check-schema-drift.sh; then
    echo -e "${GREEN}   ✅ No schema drift detected${NC}"
else
    echo -e "${RED}   ❌ Schema drift detected!${NC}"
    echo ""
    echo "Run: npm run db:generate --workspace=jawab24-backend"
    exit 1
fi

# 5. Check Docker build
echo ""
echo "5️⃣  Building Docker image..."
if docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check . > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Docker image builds successfully${NC}"
else
    echo -e "${RED}   ❌ Docker build failed!${NC}"
    docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check .
    exit 1
fi

# Summary
echo ""
echo "==========================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All pre-deploy checks passed!${NC}"
    echo "   Safe to deploy to production."
    echo ""
    echo "   Note: Container smoke tests run in:"
    echo "   - GitHub Actions CI (with full services)"
    echo "   - Production deployment (with real env)"
else
    echo -e "${YELLOW}⚠️  Checks completed with warnings${NC}"
    echo "   Review warnings before deploying."
fi
echo ""
