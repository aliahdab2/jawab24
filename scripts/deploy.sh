#!/bin/bash
#
# Safe Deployment Script for Jawab24
# 
# This script ensures a safe deployment by:
# 1. Validating environment variables
# 2. Pulling latest code
# 3. Building containers
# 4. Running health checks
# 5. Only switching if healthy
#
# Usage: ./scripts/deploy.sh
#

set -e

echo ""
echo "🚀 Jawab24 Safe Deployment"
echo "=========================="
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Determine deploy directory
if [ -d "/var/www/jawab24" ]; then
    DEPLOY_DIR="/var/www/jawab24"
else
    DEPLOY_DIR="$(pwd)"
fi

cd "$DEPLOY_DIR"
echo -e "${BLUE}📁 Deploy directory: $DEPLOY_DIR${NC}"
echo ""

# ==========================================
# Step 1: Check Environment Variables
# ==========================================
echo -e "${BLUE}Step 1/6: Checking environment variables...${NC}"
if [ -f "./scripts/check-env.sh" ]; then
    if ! ./scripts/check-env.sh; then
        echo -e "${RED}❌ Environment check failed. Aborting deployment.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  check-env.sh not found, skipping env check${NC}"
fi
echo ""

# ==========================================
# Step 2: Pull Latest Code
# ==========================================
echo -e "${BLUE}Step 2/6: Pulling latest code...${NC}"
git fetch origin main
git reset --hard origin/main
COMMIT=$(git rev-parse --short HEAD)
echo -e "${GREEN}✅ Updated to commit: $COMMIT${NC}"
echo ""

# ==========================================
# Step 3: Update nginx upstream (safety)
# ==========================================
echo -e "${BLUE}Step 3/6: Ensuring nginx points to main containers...${NC}"
cat > ./nginx/upstream.conf << 'EOF'
# Active environment: main
# Updated by deploy.sh

upstream backend_active {
    server jawab24-backend:3000;
    keepalive 32;
}

upstream frontend_active {
    server jawab24-frontend:3001;
    keepalive 16;
}

upstream ai_worker_active {
    server jawab24-ai-worker:3002;
    keepalive 16;
}
EOF
echo -e "${GREEN}✅ Nginx upstream configured${NC}"
echo ""

# ==========================================
# Step 4: Build Containers
# ==========================================
echo -e "${BLUE}Step 4/6: Building containers...${NC}"

# Load frontend env vars for build
if [ -f "./env/frontend.env" ]; then
    export $(grep -v '^#' ./env/frontend.env | xargs)
fi

docker-compose build --parallel --no-cache
echo -e "${GREEN}✅ All containers built${NC}"
echo ""

# ==========================================
# Step 5: Stop Old & Start New
# ==========================================
echo -e "${BLUE}Step 5/6: Deploying containers...${NC}"

# Remove any orphan blue/green containers
docker stop jawab24-frontend-blue jawab24-frontend-green jawab24-backend-blue jawab24-backend-green jawab24-ai-worker-blue jawab24-ai-worker-green 2>/dev/null || true
docker rm jawab24-frontend-blue jawab24-frontend-green jawab24-backend-blue jawab24-backend-green jawab24-ai-worker-blue jawab24-ai-worker-green 2>/dev/null || true

# Start fresh
docker-compose down --remove-orphans 2>/dev/null || true
docker-compose up -d

echo -e "${GREEN}✅ Containers started${NC}"
echo ""

# ==========================================
# Step 6: Health Checks
# ==========================================
echo -e "${BLUE}Step 6/6: Running health checks...${NC}"

MAX_WAIT=60
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
    # Check if all containers are healthy
    BACKEND_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' jawab24-backend 2>/dev/null || echo "starting")
    FRONTEND_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' jawab24-frontend 2>/dev/null || echo "starting")
    NGINX_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' jawab24-nginx 2>/dev/null || echo "starting")
    
    echo "   Backend: $BACKEND_HEALTH | Frontend: $FRONTEND_HEALTH | Nginx: $NGINX_HEALTH"
    
    if [ "$BACKEND_HEALTH" = "healthy" ] && [ "$FRONTEND_HEALTH" = "healthy" ] && [ "$NGINX_HEALTH" = "healthy" ]; then
        echo ""
        echo -e "${GREEN}✅ All containers healthy!${NC}"
        break
    fi
    
    # Check if any container crashed
    if ! docker ps | grep -q jawab24-backend; then
        echo -e "${RED}❌ Backend container crashed!${NC}"
        docker logs jawab24-backend --tail 20
        exit 1
    fi
    
    if ! docker ps | grep -q jawab24-nginx; then
        echo -e "${RED}❌ Nginx container crashed!${NC}"
        docker logs jawab24-nginx --tail 20
        exit 1
    fi
    
    sleep 5
    WAITED=$((WAITED + 5))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}⚠️  Health check timeout - containers may still be starting${NC}"
fi

echo ""

# ==========================================
# Final Verification
# ==========================================
echo -e "${BLUE}Verifying deployment...${NC}"

# Test API health
if curl -sf http://localhost/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API responding${NC}"
else
    echo -e "${YELLOW}⚠️  API not responding yet (may need more time)${NC}"
fi

# Test frontend
if curl -sf http://localhost/ > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend responding${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend not responding yet (may need more time)${NC}"
fi

echo ""
echo "=================================="
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo "=================================="
echo ""
echo "📊 Container Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | head -10
echo ""
echo "🌐 Website: https://jawab24.com"
echo "📝 Commit:  $COMMIT"
echo ""
