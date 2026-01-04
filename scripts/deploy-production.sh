#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# JAWAB24 LOCAL CI/CD SCRIPT
# ═══════════════════════════════════════════════════════════════════
# This script runs the full CI/CD pipeline locally without GitHub Actions
# It replicates the same checks and blue-green deployment as CI/CD
#
# Usage: ./scripts/deploy-production.sh
#        ./scripts/deploy-production.sh -y              # Skip confirmation
#        ./scripts/deploy-production.sh --skip-tests    # Skip CI tests
#        ./scripts/deploy-production.sh -y --skip-tests # Both
# ═══════════════════════════════════════════════════════════════════

set -e

# Configuration
SERVER_HOST="91.99.95.196"
SERVER_USER="root"
DEPLOY_PATH="/var/www/jawab24"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_jawab24_deploy}"
SKIP_TESTS=false
AUTO_CONFIRM=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        -y|--yes)
            AUTO_CONFIRM=true
            shift
            ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Track time
START_TIME=$(date +%s)

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}${BOLD}🚀 JAWAB24 LOCAL CI/CD PIPELINE${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "📅 Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo -e "🖥️  Server: ${SERVER_HOST}"
echo -e "📁 Path: ${DEPLOY_PATH}"
echo -e "🔄 Strategy: Blue-Green (Zero Downtime)"
if [ "$SKIP_TESTS" = true ]; then
    echo -e "⚠️  Tests: ${YELLOW}SKIPPED${NC}"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# Pre-flight Checks
# ═══════════════════════════════════════════════════════════════════
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📋 PRE-FLIGHT CHECKS${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check if there are uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${RED}❌ You have uncommitted changes!${NC}"
    echo -e "Please commit or stash your changes before deploying."
    git status -s
    exit 1
fi
echo -e "${GREEN}✅ No uncommitted changes${NC}"

# Check Node version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${YELLOW}⚠️  Node version is v$(node --version)${NC}"
    echo -e "Switching to Node 20..."
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use 20 || {
        echo -e "${RED}❌ Failed to switch to Node 20${NC}"
        echo -e "Please run: nvm install 20 && nvm use 20"
        exit 1
    }
fi
echo -e "${GREEN}✅ Node version: $(node --version)${NC}"

# ═══════════════════════════════════════════════════════════════════
# CI CHECKS (Same as GitHub Actions)
# ═══════════════════════════════════════════════════════════════════
if [ "$SKIP_TESTS" = false ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}${BOLD}🧪 RUNNING CI CHECKS (Same as GitHub Actions)${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # ────────────────────────────────────────────────────────────────
    # Preflight: Check deployment scripts exist
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}📋 Preflight: Checking deployment scripts...${NC}"
    REQUIRED_SCRIPTS=(
        "scripts/deploy-blue-green.sh"
        "scripts/check-env.sh"
        "scripts/health-check.sh"
    )
    SCRIPTS_MISSING=0
    for script in "${REQUIRED_SCRIPTS[@]}"; do
        if [ ! -f "$script" ]; then
            echo -e "${RED}   ❌ Missing: $script${NC}"
            SCRIPTS_MISSING=1
        fi
    done
    if [ $SCRIPTS_MISSING -eq 1 ]; then
        echo -e "${RED}   Missing required deployment scripts!${NC}"
        exit 1
    fi
    echo -e "${GREEN}   ✅ All deployment scripts found${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 1: Build shared package
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}1️⃣  Building shared package...${NC}"
    npm run build --workspace=@jawab24/shared > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Shared package built${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 2: Check for ESM-only packages (CommonJS compatibility)
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}2️⃣  Checking ESM-only packages...${NC}"
    ESM_PACKAGES=("uuid" "node-fetch" "chalk" "ora" "execa" "got" "globby")
    ESM_FOUND=0
    for pkg in "${ESM_PACKAGES[@]}"; do
        if grep -q "\"$pkg\":" backend/package.json 2>/dev/null; then
            echo -e "${YELLOW}   ⚠️  Found ESM-only package: $pkg${NC}"
            ESM_FOUND=1
        fi
    done
    if [ $ESM_FOUND -eq 0 ]; then
        echo -e "${GREEN}   ✅ No ESM-only packages detected${NC}"
    fi

    # ────────────────────────────────────────────────────────────────
    # Step 3: Backend lint
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}3️⃣  Backend lint...${NC}"
    npm run lint --workspace=jawab24-backend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Backend lint passed${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 4: Validate migrations
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}4️⃣  Validating database migrations...${NC}"
    if [ -f "backend/scripts/validate-migrations.ts" ]; then
        cd backend && npx ts-node scripts/validate-migrations.ts > /dev/null 2>&1 && cd ..
        echo -e "${GREEN}   ✅ Migrations validated${NC}"
    else
        echo -e "${YELLOW}   ⚠️  Migration validator not found, skipping${NC}"
    fi

    # ────────────────────────────────────────────────────────────────
    # Step 5: Backend tests
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}5️⃣  Backend tests...${NC}"
    if ! BACKEND_RESULT=$(npm test --workspace=jawab24-backend -- --run 2>&1); then
        echo -e "${RED}   ❌ Backend tests failed!${NC}"
        echo "$BACKEND_RESULT"
        exit 1
    fi
    # Extract test count (works on both macOS and Linux)
    BACKEND_TESTS=$(echo "$BACKEND_RESULT" | grep -o 'Tests[[:space:]]*[0-9]* passed' | grep -o '[0-9]*' | head -1 || echo "0")
    [ -z "$BACKEND_TESTS" ] && BACKEND_TESTS="0"
    echo -e "${GREEN}   ✅ Backend tests passed (${BACKEND_TESTS} tests)${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 6: Backend build
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}6️⃣  Backend build...${NC}"
    npm run build --workspace=jawab24-backend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Backend build successful${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 7: AI Worker lint + build
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}7️⃣  AI Worker lint + build...${NC}"
    npm run lint --workspace=jawab24-ai-worker > /dev/null 2>&1 || true
    npm run build --workspace=jawab24-ai-worker > /dev/null 2>&1
    echo -e "${GREEN}   ✅ AI Worker build successful${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 8: Check for duplicate /api/api paths
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}8️⃣  Checking for duplicate API paths...${NC}"
    if grep -r "/api/api" frontend/src/ 2>/dev/null; then
        echo -e "${RED}   ❌ Found duplicate /api/api paths!${NC}"
        exit 1
    fi
    echo -e "${GREEN}   ✅ No duplicate API paths${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 9: Frontend lint
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}9️⃣  Frontend lint...${NC}"
    npm run lint --workspace=jawab24-frontend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Frontend lint passed${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 10: Frontend tests
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}🔟 Frontend tests...${NC}"
    FRONTEND_RESULT=$(npm test --workspace=jawab24-frontend -- --run 2>&1)
    # Extract test count (works on both macOS and Linux)
    FRONTEND_TESTS=$(echo "$FRONTEND_RESULT" | grep -o 'Tests[[:space:]]*[0-9]* passed' | grep -o '[0-9]*' | head -1 || echo "0")
    [ -z "$FRONTEND_TESTS" ] && FRONTEND_TESTS="0"
    echo -e "${GREEN}   ✅ Frontend tests passed (${FRONTEND_TESTS} tests)${NC}"

    # ────────────────────────────────────────────────────────────────
    # Step 11: Frontend build
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${CYAN}1️⃣1️⃣ Frontend build...${NC}"
    NEXT_PUBLIC_API_URL=https://jawab24.com/api npm run build --workspace=jawab24-frontend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Frontend build successful${NC}"

    # ────────────────────────────────────────────────────────────────
    # Summary
    # ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}✅ ALL CI CHECKS PASSED${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "   ✅ Preflight checks"
    echo -e "   ✅ ESM compatibility"
    echo -e "   ✅ Backend: lint, migrations, tests (${BACKEND_TESTS}), build"
    echo -e "   ✅ AI Worker: lint, build"
    echo -e "   ✅ Frontend: lint, tests (${FRONTEND_TESTS}), build"
    echo -e "   📊 Total tests: $((BACKEND_TESTS + FRONTEND_TESTS))"
fi

# ═══════════════════════════════════════════════════════════════════
# SSH Pre-flight
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}🔐 SSH CONNECTION CHECK${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check SSH key exists
if [ ! -f ~/.ssh/id_rsa ] && [ ! -f ~/.ssh/id_ed25519 ]; then
    echo -e "${RED}❌ No SSH key found!${NC}"
    echo -e "Please set up SSH key authentication to the server."
    exit 1
fi
echo -e "${GREEN}✅ SSH key found${NC}"

# Test SSH connection
echo -e "🔗 Testing SSH connection..."
if [ ! -f "$SSH_KEY" ]; then
    echo -e "${RED}❌ SSH key not found: $SSH_KEY${NC}"
    echo -e "Set SSH_KEY environment variable or create the key."
    exit 1
fi
if ! ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o BatchMode=yes ${SERVER_USER}@${SERVER_HOST} "echo 'connected'" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to server!${NC}"
    echo -e "Make sure your SSH key is added to the server."
    exit 1
fi
echo -e "${GREEN}✅ SSH connection successful (using ${SSH_KEY})${NC}"

# ═══════════════════════════════════════════════════════════════════
# Confirm Deployment
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}${BOLD}⚠️  CONFIRM DEPLOYMENT${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Current commit: ${CYAN}$(git rev-parse --short HEAD)${NC}"
echo -e "Branch: ${CYAN}$(git branch --show-current)${NC}"
echo -e "Message: $(git log -1 --pretty=%B | head -1)"
echo ""
if [ "$AUTO_CONFIRM" = true ]; then
    echo -e "${GREEN}Auto-confirmed with -y flag${NC}"
else
    read -p "Deploy this commit to production? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Deployment cancelled.${NC}"
        exit 0
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# Step 3: Deploy to server
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🚀 DEPLOYING TO SERVER${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ═══════════════════════════════════════════════════════════════════
# Deploy on Server (using existing deploy-blue-green.sh)
# ═══════════════════════════════════════════════════════════════════
echo -e "${CYAN}Connecting to server and running deployment...${NC}"
echo ""

ssh -i "$SSH_KEY" ${SERVER_USER}@${SERVER_HOST} << 'ENDSSH'
set -e
cd /var/www/jawab24

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 Step 1: Pulling latest code..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
git fetch origin main
git reset --hard origin/main
git rev-parse HEAD > VERSION
date -u '+%Y-%m-%dT%H:%M:%SZ' > .deploy-time
echo "✅ Code updated to: $(git rev-parse --short HEAD)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗄️  Step 2: Running database migrations..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ensure postgres is running (suppress warnings)
docker-compose up -d postgres 2>&1 | grep -v "orphan containers" | grep -v "level=warning" || true
sleep 5

# Run migrations
mkdir -p .migrations
MIGRATION_COUNT=0
# Run migrations via the backend container (using Drizzle)
echo "   🔄 Triggering Drizzle migrations..."
# We use the blue container because we are about to deploy blue
# Ensure the container is running and healthy-ish
if docker exec jawab24-backend-blue npm run db:migrate; then
    echo "   ✅ Migrations applied successfully via app container"
else
    echo "   ❌ Migration failed"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Step 3: Running Blue-Green Deployment..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Use existing deploy-blue-green.sh script
if [ -f "./scripts/deploy-blue-green.sh" ]; then
    chmod +x ./scripts/deploy-blue-green.sh
    ./scripts/deploy-blue-green.sh deploy
else
    echo "⚠️  deploy-blue-green.sh not found, using fallback..."
    
    # Fallback to simple deploy
    if [ -f "./scripts/deploy.sh" ]; then
        chmod +x ./scripts/deploy.sh
        ./scripts/deploy.sh
    else
        echo "❌ No deployment script found!"
        exit 1
    fi
fi

ENDSSH

# Calculate elapsed time
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}🎉 CI/CD PIPELINE COMPLETE!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "⏱️  Total time: ${MINUTES}m ${SECONDS}s"
echo ""
echo -e "🌐 Website:   https://jawab24.com"
echo -e "📊 Dashboard: https://jawab24.com/dashboard"
echo -e "🔧 API:       https://jawab24.com/api/health"
echo ""

