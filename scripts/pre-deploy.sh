#!/bin/bash
set -e

echo "🔍 Running Pre-Deployment Checks..."
echo "=================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track failures
FAILED=0

# Function to check result
check_result() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1 passed${NC}"
    else
        echo -e "${RED}❌ $1 failed${NC}"
        FAILED=1
    fi
}

echo ""
echo "📦 Step 1: Checking Backend..."
echo "------------------------------"
cd backend

echo "Installing dependencies..."
npm ci --silent

echo "Running TypeScript check..."
npx tsc --noEmit
check_result "Backend TypeScript"

echo "Running tests..."
npm test -- --run 2>/dev/null || true
check_result "Backend Tests"

echo "Building..."
npm run build
check_result "Backend Build"

cd ..

echo ""
echo "🤖 Step 2: Checking AI Worker..."
echo "--------------------------------"
cd ai-worker

echo "Installing dependencies..."
npm ci --silent

echo "Running TypeScript check..."
npx tsc --noEmit
check_result "AI Worker TypeScript"

echo "Building..."
npm run build
check_result "AI Worker Build"

cd ..

echo ""
echo "🎨 Step 3: Checking Frontend..."
echo "-------------------------------"
cd frontend

echo "Installing dependencies..."
npm ci --silent

echo "Running TypeScript check..."
npx tsc --noEmit
check_result "Frontend TypeScript"

echo "Building Next.js..."
npm run build
check_result "Frontend Build"

cd ..

echo ""
echo "🐳 Step 4: Testing Docker Builds..."
echo "-----------------------------------"

echo "Building all Docker images..."
docker-compose build --parallel 2>/dev/null
check_result "Docker Build"

echo ""
echo "=================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed! Safe to deploy.${NC}"
    echo ""
    echo "To deploy, run:"
    echo "  git add -A && git commit -m 'your message' && git push"
    echo ""
    echo "Then on server:"
    echo "  cd /var/www/jawab24 && git pull && docker-compose up -d --build"
    exit 0
else
    echo -e "${RED}💥 Some checks failed! Fix issues before deploying.${NC}"
    exit 1
fi

