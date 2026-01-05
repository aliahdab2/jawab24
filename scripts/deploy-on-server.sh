#!/bin/bash
set -e  # Exit on error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failure

# Jawab24 Server-Side Deployment Script
# This script is executed ON the production server to deploy the application.
# It can be triggered by:
# 1. Local machine via SSH (scripts/deploy-production.sh)
# 2. GitHub Actions via SSH (.github/workflows/deploy.yml)

# Trap errors and provide helpful context
trap 'echo "❌ ERROR: Deployment failed at line $LINENO. Check logs above for details."; exit 1' ERR

# Validate we're in the correct directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ ERROR: docker-compose.yml not found!"
    echo "This script must be run from the project root directory."
    exit 1
fi

# Validate required files exist
REQUIRED_FILES=(
    "nginx/nginx.conf"
    "nginx/upstream.conf"
    "backend/Dockerfile"
    "frontend/Dockerfile"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ ERROR: Required file missing: $file"
        exit 1
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 STEP 1: Pulling latest code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
git fetch origin main
git reset --hard origin/main

# Save version info
git rev-parse HEAD > VERSION
date -u '+%Y-%m-%dT%H:%M:%SZ' > .deploy-time

echo "✅ Code updated to: $(git rev-parse --short HEAD)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 STEP 2: Determine deployment target"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get current active environment
if [ -f .active-env ]; then
  ACTIVE_ENV=$(cat .active-env)
else
  # Default to blue if no state file
  ACTIVE_ENV="blue"
  echo "blue" > .active-env
fi

# Determine target environment (toggle blue/green)
if [ "$ACTIVE_ENV" == "blue" ]; then
  DEPLOY_ENV="green"
else
  DEPLOY_ENV="blue"
fi

echo "📍 Current active: $ACTIVE_ENV"
echo "🎯 Deploying to: $DEPLOY_ENV"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  STEP 3: Building Docker images"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Load frontend env vars if present
if [ -f ./env/frontend.env ]; then
  export $(grep -v '^#' ./env/frontend.env | xargs)
fi

# Export GIT_COMMIT for Docker build args
export GIT_COMMIT=$(git rev-parse HEAD)
echo "📝 Git commit: $(git rev-parse --short HEAD)"

# Build images with --no-cache to ensure fresh code
# Pass GIT_COMMIT as build arg
# Parallel build for speed
docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml build \
  --no-cache \
  --parallel \
  --build-arg GIT_COMMIT=$GIT_COMMIT

echo "✅ Images built (fresh, no cache)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 STEP 4: Starting $DEPLOY_ENV environment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ensure shared services are running
docker-compose up -d postgres redis nginx

# Cleanup potential conflicting containers
echo "🧹 Cleaning up any existing containers for $DEPLOY_ENV..."

# Step 1: Stop containers gracefully (if running)
echo "  ⏸️  Stopping existing containers..."
docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml stop \
  backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV 2>/dev/null || true

# Step 2: Wait for containers to fully stop
echo "  ⏳ Waiting for containers to stop..."
sleep 3

# Step 3: Remove stopped containers
echo "  🗑️  Removing stopped containers..."
docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml rm -f \
  backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV 2>/dev/null || true

# Also clean up any orphaned containers with the same names
docker rm -f jawab24-backend-$DEPLOY_ENV jawab24-frontend-$DEPLOY_ENV jawab24-ai-worker-$DEPLOY_ENV 2>/dev/null || true

# Step 4: Start new environment
echo "  🚀 Starting new containers..."
docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml up -d \
  backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV

echo "✅ $DEPLOY_ENV containers started"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏳ STEP 5: Container Startup Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

sleep 10
echo "🔍 Checking if containers started without crashing..."

# Check if backend crashed
if ! docker ps | grep -q "jawab24-backend-$DEPLOY_ENV"; then
  echo "❌ Backend container crashed on startup!"
  echo "📋 Last 50 lines of logs:"
  docker logs jawab24-backend-$DEPLOY_ENV --tail 50 2>&1 || echo "No logs"
  exit 1
fi
echo "   ✅ Backend container is running"

# Check if frontend crashed
if ! docker ps | grep -q "jawab24-frontend-$DEPLOY_ENV"; then
  echo "❌ Frontend container crashed on startup!"
  docker logs jawab24-frontend-$DEPLOY_ENV --tail 50 2>&1 || echo "No logs"
  exit 1
fi
echo "   ✅ Frontend container is running"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗄️  STEP 5a: Execute Database Migrations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "   🔄 Running migrations in jawab24-backend-$DEPLOY_ENV..."
# Use the explicit npm script inside the running container (Uses Drizzle ORM)
if docker exec jawab24-backend-$DEPLOY_ENV npm run db:migrate; then
   echo "   ✅ Migrations applied successfully"
else
   echo "   ❌ Migration failed!"
   echo "   📋 Logs:"
   docker logs jawab24-backend-$DEPLOY_ENV --tail 20 2>&1
   exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏳ STEP 5b: Waiting for health checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Wait for containers to be healthy
# Wait for containers to be healthy
MAX_WAIT=120
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
  BACKEND_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' jawab24-backend-$DEPLOY_ENV 2>/dev/null || echo "starting")
  FRONTEND_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' jawab24-frontend-$DEPLOY_ENV 2>/dev/null || echo "starting")
  
  echo "   Backend: $BACKEND_HEALTH, Frontend: $FRONTEND_HEALTH"
  
  if [ "$BACKEND_HEALTH" == "healthy" ] && [ "$FRONTEND_HEALTH" == "healthy" ]; then
    echo "✅ All containers healthy!"
    break
  fi
  
  # Check crash
  if ! docker ps | grep -q "jawab24-backend-$DEPLOY_ENV"; then
    echo "❌ Backend crashed during startup!"
    docker logs jawab24-backend-$DEPLOY_ENV --tail 50 2>&1
    exit 1
  fi
  
  sleep 5
  WAITED=$((WAITED + 5))
done

# Final check after timeout
if [ "$BACKEND_HEALTH" != "healthy" ] || [ "$FRONTEND_HEALTH" != "healthy" ]; then
    echo "❌ Health check timeout! Backend: $BACKEND_HEALTH, Frontend: $FRONTEND_HEALTH"
    echo "📋 Backend Logs:"
    docker logs jawab24-backend-$DEPLOY_ENV --tail 50 2>&1
    echo "📋 Frontend Logs:"
    docker logs jawab24-frontend-$DEPLOY_ENV --tail 20 2>&1
    exit 1
fi

echo "⏳ Allowing containers to settle for 15s (warm-up)..."
sleep 15


echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 STEP 6: Switching traffic to $DEPLOY_ENV"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Update upstream config
echo "📝 Updating nginx config to point to $DEPLOY_ENV..."
echo "Config path: $(pwd)/nginx/upstream.conf"

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

# Verify file write
echo "📄 New config header on host:"
head -n 5 ./nginx/upstream.conf

# Verify container sees the file
echo "📄 Config header inside Nginx container:"
if ! docker exec jawab24-nginx head -n 5 /etc/nginx/upstream.conf; then
    echo "❌ ERROR: Nginx container cannot read the upstream configuration file!"
    echo "⚠️  Attempting to copy file manually into container..."
    docker cp ./nginx/upstream.conf jawab24-nginx:/etc/nginx/upstream.conf
fi

# Since upstream.conf is mounted as read-only, nginx reload won't pick up changes
# We must restart the container to force Docker to re-mount the updated file
echo "🔄 Restarting Nginx to apply new upstream configuration..."

# Verify config syntax before restart
# Verify config syntax before restart
echo "🔍 Verifying Nginx configuration syntax..."
if ! docker exec jawab24-nginx nginx -t; then
    echo "❌ ERROR: Nginx configuration has syntax errors!"
    exit 1
fi

# Restart Nginx container to pick up the new upstream.conf
if docker restart jawab24-nginx; then
    echo "✅ Nginx restarted successfully"
    
    # Wait for Nginx to be healthy
    echo "⏳ Waiting for Nginx to become healthy..."
    for i in {1..30}; do
        if docker inspect jawab24-nginx | grep -q '"Status": "healthy"'; then
            echo "✅ Nginx is healthy"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "⚠️  Warning: Nginx health check timeout (but container is running)"
        fi
        sleep 1
    done
else
    echo "❌ FATAL: Nginx failed to restart!"
    docker logs jawab24-nginx --tail 20 2>&1
    exit 1
fi

# Save new active environment
echo "$DEPLOY_ENV" > .active-env

# Verify the switch actually worked
echo "🔍 Verifying traffic switch..."
ACTUAL_ENV=$(curl -s http://localhost/api/version | grep -o '"environment":"[^"]*"' | cut -d'"' -f4)
if [ "$ACTUAL_ENV" = "$DEPLOY_ENV" ]; then
    echo "✅ Traffic switched to $DEPLOY_ENV (verified)"
else
    echo "⚠️  WARNING: Expected environment '$DEPLOY_ENV' but API reports '$ACTUAL_ENV'"
    echo "📄 Current upstream.conf inside container:"
    docker exec jawab24-nginx cat /etc/nginx/upstream.conf
    echo ""
    echo "⚠️  Traffic switch may not have taken effect properly!"
fi


echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 STEP 7: Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Cleanup old images
docker image prune -f --filter "until=24h" 2>/dev/null || true

echo "✅ Cleanup complete"
echo ""
echo "📊 Container Status:"
docker-compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" | head -20

echo ""
echo "🎉 DEPLOYMENT SUCCESSFUL"
