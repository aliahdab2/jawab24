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

# 3. Run tests
echo ""
echo "3️⃣  Running tests..."
if npm test --workspace=jawab24-backend -- --run > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ All tests pass${NC}"
else
    echo -e "${RED}   ❌ Tests failed!${NC}"
    npm test --workspace=jawab24-backend -- --run
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

# 5. Check Docker build (optional, slower)
echo ""
echo "5️⃣  Building Docker image..."
if docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check . > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Docker image builds successfully${NC}"
else
    echo -e "${RED}   ❌ Docker build failed!${NC}"
    docker build -f backend/Dockerfile -t jawab24-backend:pre-deploy-check .
    exit 1
fi

# 5. Smoke test Docker container
echo ""
echo "6️⃣  Smoke testing Docker container..."
docker run --rm -d --name pre-deploy-test \
    -e DATABASE_URL=postgres://test:test@localhost:5432/test \
    -e JWT_SECRET=test \
    -e NODE_ENV=production \
    -e PORT=3000 \
    jawab24-backend:pre-deploy-check > /dev/null 2>&1 || true

sleep 3

if docker ps | grep -q pre-deploy-test; then
    echo -e "${GREEN}   ✅ Container starts without crashing${NC}"
    docker stop pre-deploy-test > /dev/null 2>&1
else
    echo -e "${RED}   ❌ Container crashed on startup!${NC}"
    echo ""
    echo "Container logs:"
    docker logs pre-deploy-test 2>&1 || echo "No logs available"
    exit 1
fi

# Summary
echo ""
echo "==========================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ All pre-deploy checks passed!${NC}"
    echo "   Safe to deploy to production."
else
    echo -e "${YELLOW}⚠️  Checks completed with warnings${NC}"
    echo "   Review warnings before deploying."
fi
echo ""

