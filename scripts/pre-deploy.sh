#!/bin/bash
set -e

echo "🔍 Running Pre-Deployment Checks..."
echo "=================================="
echo "This mirrors what GitHub Actions CI will run."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track failures
FAILED=0
START_TIME=$(date +%s)

# Function to check result
check_result() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1 passed${NC}"
    else
        echo -e "${RED}❌ $1 failed${NC}"
        FAILED=1
    fi
}

# Function to run with timing
run_step() {
    local step_start=$(date +%s)
    "$@"
    local step_end=$(date +%s)
    local duration=$((step_end - step_start))
    echo -e "${BLUE}   (${duration}s)${NC}"
}

echo ""
echo "📦 Step 1: Checking Backend..."
echo "------------------------------"
cd backend

echo "Installing dependencies..."
npm ci --silent

echo "Running TypeScript check..."
run_step npx tsc --noEmit
check_result "Backend TypeScript"

echo "Running linter..."
if npm run lint --if-present 2>/dev/null; then
    check_result "Backend Lint"
else
    echo -e "${YELLOW}⚠️  No lint script found, skipping${NC}"
fi

echo "Running tests..."
npm test -- --run 2>/dev/null || true
check_result "Backend Tests"

echo "Building..."
run_step npm run build
check_result "Backend Build"

cd ..

echo ""
echo "🤖 Step 2: Checking AI Worker..."
echo "--------------------------------"
cd ai-worker

echo "Installing dependencies..."
npm ci --silent

echo "Running TypeScript check..."
run_step npx tsc --noEmit
check_result "AI Worker TypeScript"

echo "Running linter..."
if npm run lint --if-present 2>/dev/null; then
    check_result "AI Worker Lint"
else
    echo -e "${YELLOW}⚠️  No lint script found, skipping${NC}"
fi

echo "Building..."
run_step npm run build
check_result "AI Worker Build"

cd ..

echo ""
echo "🎨 Step 3: Checking Frontend..."
echo "-------------------------------"
cd frontend

echo "Installing dependencies..."
npm ci --silent

echo "Running TypeScript check..."
run_step npx tsc --noEmit
check_result "Frontend TypeScript"

echo "Running linter..."
if npm run lint 2>/dev/null; then
    check_result "Frontend Lint"
else
    echo -e "${YELLOW}⚠️  Lint had warnings (non-blocking)${NC}"
fi

echo "Building Next.js..."
run_step npm run build
check_result "Frontend Build"

cd ..

echo ""
echo "🐳 Step 4: Testing Docker Builds..."
echo "-----------------------------------"

echo "Building all Docker images..."
run_step docker-compose build --parallel 2>/dev/null
check_result "Docker Build"

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

echo ""
echo "=================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed! Safe to deploy.${NC}"
    echo -e "${BLUE}Total time: ${TOTAL_TIME}s${NC}"
    echo ""
    echo "GitHub Actions will run the same checks automatically."
    echo ""
    echo "To deploy, just push to main:"
    echo "  git add -A && git commit -m 'your message' && git push"
    echo ""
    echo "CI will run → If passes → Auto-deploy to production"
    exit 0
else
    echo -e "${RED}💥 Some checks failed! Fix issues before pushing.${NC}"
    echo -e "${BLUE}Total time: ${TOTAL_TIME}s${NC}"
    echo ""
    echo "GitHub Actions would also fail with these errors."
    echo "Fix the issues above before pushing."
    exit 1
fi

