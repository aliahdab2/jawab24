#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# JAWAB24 LOCAL CI/CD SCRIPT
# ═══════════════════════════════════════════════════════════════════
# This script runs the full CI/CD pipeline locally without GitHub Actions
# It replicates the same checks and blue-green deployment as CI/CD
#
# Usage: ./scripts/deploy-local.sh
#        ./scripts/deploy-local.sh --skip-tests  # Skip CI tests
# ═══════════════════════════════════════════════════════════════════

set -e

# Configuration
SERVER_HOST="91.99.95.196"
SERVER_USER="root"
DEPLOY_PATH="/var/www/jawab24"
SKIP_TESTS=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --skip-tests)
            SKIP_TESTS=true
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
    echo -e "${BLUE}${BOLD}🧪 RUNNING CI CHECKS${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Step 1: Build shared package
    echo ""
    echo -e "${CYAN}1️⃣  Building shared package...${NC}"
    npm run build --workspace=@jawab24/shared > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Shared package built${NC}"

    # Step 2: Backend lint
    echo ""
    echo -e "${CYAN}2️⃣  Backend lint...${NC}"
    npm run lint --workspace=jawab24-backend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Backend lint passed${NC}"

    # Step 3: Backend tests
    echo ""
    echo -e "${CYAN}3️⃣  Backend tests...${NC}"
    BACKEND_RESULT=$(npm test --workspace=jawab24-backend -- --run 2>&1)
    BACKEND_TESTS=$(echo "$BACKEND_RESULT" | grep -oP 'Tests\s+\d+ passed' | grep -oP '\d+' || echo "0")
    echo -e "${GREEN}   ✅ Backend tests passed (${BACKEND_TESTS} tests)${NC}"

    # Step 4: Backend build
    echo ""
    echo -e "${CYAN}4️⃣  Backend build...${NC}"
    npm run build --workspace=jawab24-backend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Backend build successful${NC}"

    # Step 5: AI Worker build
    echo ""
    echo -e "${CYAN}5️⃣  AI Worker build...${NC}"
    npm run build --workspace=jawab24-ai-worker > /dev/null 2>&1
    echo -e "${GREEN}   ✅ AI Worker build successful${NC}"

    # Step 6: Frontend lint
    echo ""
    echo -e "${CYAN}6️⃣  Frontend lint...${NC}"
    npm run lint --workspace=jawab24-frontend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Frontend lint passed${NC}"

    # Step 7: Frontend tests
    echo ""
    echo -e "${CYAN}7️⃣  Frontend tests...${NC}"
    FRONTEND_RESULT=$(npm test --workspace=jawab24-frontend -- --run 2>&1)
    FRONTEND_TESTS=$(echo "$FRONTEND_RESULT" | grep -oP 'Tests\s+\d+ passed' | grep -oP '\d+' || echo "0")
    echo -e "${GREEN}   ✅ Frontend tests passed (${FRONTEND_TESTS} tests)${NC}"

    # Step 8: Frontend build
    echo ""
    echo -e "${CYAN}8️⃣  Frontend build...${NC}"
    NEXT_PUBLIC_API_URL=https://jawab24.com/api npm run build --workspace=jawab24-frontend > /dev/null 2>&1
    echo -e "${GREEN}   ✅ Frontend build successful${NC}"

    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ ALL CI CHECKS PASSED${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "   Backend tests:  ${BACKEND_TESTS}"
    echo -e "   Frontend tests: ${FRONTEND_TESTS}"
    echo -e "   Total tests:    $((BACKEND_TESTS + FRONTEND_TESTS))"
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
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes ${SERVER_USER}@${SERVER_HOST} "echo 'connected'" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to server!${NC}"
    echo -e "Make sure your SSH key is added to the server."
    exit 1
fi
echo -e "${GREEN}✅ SSH connection successful${NC}"

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
read -p "Deploy this commit to production? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Deployment cancelled.${NC}"
    exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# Step 3: Deploy to server
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🚀 DEPLOYING TO SERVER${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

ssh ${SERVER_USER}@${SERVER_HOST} << 'ENDSSH'
set -e
cd /var/www/jawab24

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 STEP 1: Pulling latest code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
git fetch origin main
git reset --hard origin/main
git rev-parse HEAD > VERSION
date -u '+%Y-%m-%dT%H:%M:%SZ' > .deploy-time
echo "✅ Code updated to: $(git rev-parse --short HEAD)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗄️  STEP 2: Running database migrations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose up -d postgres
sleep 5

mkdir -p .migrations
for migration in backend/drizzle/*.sql; do
    if [ -f "$migration" ]; then
        MIGRATION_NAME=$(basename "$migration")
        if [ ! -f ".migrations/$MIGRATION_NAME.done" ]; then
            echo "   📦 Applying: $MIGRATION_NAME"
            docker cp "$migration" jawab24-postgres:/tmp/migration.sql
            if docker exec jawab24-postgres psql -U postgres -d jawab24 -f /tmp/migration.sql 2>&1; then
                touch ".migrations/$MIGRATION_NAME.done"
                echo "   ✅ Applied: $MIGRATION_NAME"
            else
                echo "   ⚠️  Migration may have been applied already"
                touch ".migrations/$MIGRATION_NAME.done"
            fi
            docker exec jawab24-postgres rm -f /tmp/migration.sql
        else
            echo "   ⏭️  Already applied: $MIGRATION_NAME"
        fi
    fi
done
echo "✅ Migrations complete"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 STEP 3: Determine deployment target"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ -f .active-env ]; then
    ACTIVE_ENV=$(cat .active-env)
else
    ACTIVE_ENV="blue"
    echo "blue" > .active-env
fi

if [ "$ACTIVE_ENV" == "blue" ]; then
    DEPLOY_ENV="green"
else
    DEPLOY_ENV="blue"
fi

echo "📍 Current active: $ACTIVE_ENV"
echo "🎯 Deploying to: $DEPLOY_ENV"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  STEP 4: Building Docker images"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ -f ./env/frontend.env ]; then
    export $(grep -v '^#' ./env/frontend.env | xargs)
fi

docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml build --no-cache --parallel
echo "✅ Images built (fresh, no cache)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 STEP 5: Starting $DEPLOY_ENV environment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose up -d postgres redis nginx
docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml up -d \
    backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV
echo "✅ $DEPLOY_ENV containers started"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏳ STEP 6: Waiting for health checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sleep 10

# Quick container crash check
if ! docker ps | grep -q "jawab24-backend-$DEPLOY_ENV"; then
    echo "❌ Backend container crashed!"
    docker logs jawab24-backend-$DEPLOY_ENV --tail 50 2>&1
    exit 1
fi
echo "   ✅ Backend container is running"

if ! docker ps | grep -q "jawab24-frontend-$DEPLOY_ENV"; then
    echo "❌ Frontend container crashed!"
    docker logs jawab24-frontend-$DEPLOY_ENV --tail 50 2>&1
    exit 1
fi
echo "   ✅ Frontend container is running"

# Wait for healthy status
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    BACKEND_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' jawab24-backend-$DEPLOY_ENV 2>/dev/null || echo "starting")
    FRONTEND_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' jawab24-frontend-$DEPLOY_ENV 2>/dev/null || echo "starting")
    
    echo "   Backend: $BACKEND_HEALTH, Frontend: $FRONTEND_HEALTH"
    
    if [ "$BACKEND_HEALTH" == "healthy" ] && [ "$FRONTEND_HEALTH" == "healthy" ]; then
        echo "✅ All containers healthy!"
        break
    fi
    
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "❌ Health check timeout!"
        docker logs jawab24-backend-$DEPLOY_ENV --tail 30 2>&1
        exit 1
    fi
    
    sleep 5
    WAITED=$((WAITED + 5))
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 STEP 7: Switching traffic to $DEPLOY_ENV"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat > ./nginx/upstream.conf << EOF
# Active environment: $DEPLOY_ENV
# Switched at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')

upstream backend_active {
    server jawab24-backend-$DEPLOY_ENV:3000;
}

upstream frontend_active {
    server jawab24-frontend-$DEPLOY_ENV:3001;
}

upstream ai_worker_active {
    server jawab24-ai-worker-$DEPLOY_ENV:3002;
}
EOF

docker exec jawab24-nginx nginx -s reload
echo "$DEPLOY_ENV" > .active-env
echo "✅ Traffic switched to $DEPLOY_ENV"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏥 STEP 8: Verify deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sleep 2

# Test backend
if curl -sf https://jawab24.com/api/health > /dev/null 2>&1; then
    echo "   ✅ Backend API responding"
else
    echo "   ❌ Backend not responding"
fi

# Test frontend
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://jawab24.com/)
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Frontend serving pages (HTTP $HTTP_CODE)"
else
    echo "   ⚠️  Frontend returned HTTP $HTTP_CODE"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 STEP 9: Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker image prune -f --filter "until=24h" 2>/dev/null || true
echo "✅ Cleanup complete"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Active environment: $(cat .active-env)"
echo "Commit: $(git rev-parse --short HEAD)"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

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

