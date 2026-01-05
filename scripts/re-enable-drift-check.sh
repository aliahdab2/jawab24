#!/bin/bash
# Re-enable Schema Drift Check
# Run this AFTER fix-migration-tracking.sh completes

set -e

echo "🔄 Re-enabling Schema Drift Check"
echo "=================================="
echo ""

# Update pre-deploy-check.sh to re-enable drift check
cat > scripts/pre-deploy-check-updated.sh << 'EOF'
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
EOF

echo "✅ Created updated pre-deploy-check.sh"
echo ""
echo "To apply:"
echo "  mv scripts/pre-deploy-check-updated.sh scripts/pre-deploy-check.sh"
echo "  chmod +x scripts/pre-deploy-check.sh"
echo "  git add scripts/pre-deploy-check.sh"
echo "  git commit -m 'feat(ci): re-enable schema drift check'"
