#!/bin/bash
set -e  # Exit on error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failure

# Jawab24 Server-Side Deployment Script (Refactored)
# Handles blue-green deployment with zero downtime.

# --- Global Configuration ---
REQUIRED_FILES=(
    "nginx/nginx.conf"
    "nginx/upstream.conf"
    "backend/Dockerfile"
    "frontend/Dockerfile"
)

# Trap errors
trap 'echo "❌ ERROR: Deployment failed at line $LINENO. Check logs above for details."; exit 1' ERR

# --- Helper Functions ---

# Validate current directory and required files
validate_setup() {
    if [ ! -f "docker-compose.yml" ]; then
        echo "❌ ERROR: docker-compose.yml not found! Run from project root."
        exit 1
    fi
    for file in "${REQUIRED_FILES[@]}"; do
        if [ ! -f "$file" ]; then
            echo "❌ ERROR: Required file missing: $file"
            exit 1
        fi
    done
}

# Pull latest code from main
pull_code() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📥 STEP 1: Pulling latest code"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    git fetch origin main
    git reset --hard origin/main
    git rev-parse HEAD > VERSION
    date -u '+%Y-%m-%dT%H:%M:%SZ' > .deploy-time
    echo "✅ Code updated to: $(git rev-parse --short HEAD)"
}

# Decide whether to deploy to blue or green
determine_target() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔍 STEP 2: Determine deployment target"
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
}

# Build fresh Docker images
build_images() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🏗️  STEP 3: Building Docker images"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ -f ./env/frontend.env ]; then
        export $(grep -v '^#' ./env/frontend.env | xargs)
    fi
    export GIT_COMMIT=$(git rev-parse HEAD)
    echo "📝 Git commit: $(git rev-parse --short HEAD)"

    docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml build \
        --no-cache \
        --parallel \
        --build-arg GIT_COMMIT=$GIT_COMMIT
    echo "✅ Images built successfully"
}

# Start the new environment containers
start_new_env() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🚀 STEP 4: Starting $DEPLOY_ENV environment"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    docker-compose up -d postgres redis nginx

    echo "🧹 Cleaning up old $DEPLOY_ENV containers..."
    docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml stop \
        backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV 2>/dev/null || true
    sleep 3
    docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml rm -f \
        backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV 2>/dev/null || true

    echo "🚀 Starting new containers..."
    docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml up -d \
        backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV
    echo "✅ $DEPLOY_ENV containers started"
}

# Verify containers and wait for health
verify_and_wait() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⏳ STEP 5: Health Check Verification"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Give containers a few seconds to at least show up in stats
    sleep 5
    
    MAX_WAIT=120
    WAITED=0
    
    while [ $WAITED -lt $MAX_WAIT ]; do
        # Check if containers are still running (not crashed)
        services=("backend" "frontend" "ai-worker")
        ALL_RUNNING=true
        for s in "${services[@]}"; do
            service_name="$s-$DEPLOY_ENV"
            # Get Container ID using docker-compose
            container_id=$(docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml ps -q "$service_name")
            
            if [ -z "$container_id" ]; then
                echo "❌ Service $service_name is NOT running!"
                # try to get logs if possible
                docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml logs --tail 20 "$service_name" 2>&1 || echo "No logs"
                exit 1
            fi
            
            # Check if container process is actually running
            if ! docker ps -q --no-trunc | grep -q "^$container_id$"; then
                 echo "❌ Container $container_id ($service_name) died!"
                 docker logs "$container_id" --tail 50 2>&1 || echo "No logs"
                 exit 1
            fi
        done

        # Check health status
        # We need the IDs for inspection
        B_ID=$(docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml ps -q "backend-$DEPLOY_ENV")
        F_ID=$(docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml ps -q "frontend-$DEPLOY_ENV")
        
        B_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$B_ID" 2>/dev/null || echo "starting")
        F_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$F_ID" 2>/dev/null || echo "starting")
        
        echo "   Backend: $B_HEALTH, Frontend: $F_HEALTH ($WAITED/$MAX_WAIT s)"
        
        if [ "$B_HEALTH" == "healthy" ] && [ "$F_HEALTH" == "healthy" ]; then
            echo "✅ All containers healthy!"
            return 0
        fi
        
        sleep 5
        WAITED=$((WAITED + 5))
    done
    
    echo "❌ Health check timeout!"
    exit 1
}

# Run database migrations
run_migrations() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🗄️  STEP 5a: Execute Database Migrations"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Find container ID via docker-compose
    container_id=$(docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml ps -q "backend-$DEPLOY_ENV")
    
    if [ -z "$container_id" ]; then
        echo "❌ Could not find backend container for migrations!"
        exit 1
    fi

    echo "   🔄 Running migrations in container $container_id..."
    if docker exec "$container_id" npm run db:migrate; then
        echo "   ✅ Migrations applied successfully"
    else
        echo "   ❌ Migration failed!"
        docker logs "$container_id" --tail 20 2>&1
        exit 1
    fi
}

# Switch traffic by updating Nginx
switch_traffic() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔄 STEP 6: Switching traffic to $DEPLOY_ENV"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Update upstream configuration file
    cat > ./nginx/upstream.conf << EOF
# Active environment: $DEPLOY_ENV
# Switched at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
upstream backend_active { server jawab24-backend-$DEPLOY_ENV:3000; }
upstream frontend_active { server jawab24-frontend-$DEPLOY_ENV:3001; }
upstream ai_worker_active { server jawab24-ai-worker-$DEPLOY_ENV:3002; }
EOF

    echo "🔄 Restarting Nginx to apply changes..."
    if docker restart jawab24-nginx; then
        echo "✅ Nginx restarted"
        # Wait for Nginx to be healthy again
        for i in {1..30}; do
            if docker inspect jawab24-nginx | grep -q '"Status": "healthy"'; then break; fi
            sleep 1
        done
    else
        echo "❌ FATAL: Nginx failed to restart!"
        exit 1
    fi

    echo "$DEPLOY_ENV" > .active-env
    echo "✅ Verified: Traffic switched to $DEPLOY_ENV"
}

# Final cleanup
cleanup() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🧹 STEP 7: Cleanup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    docker image prune -f --filter "until=24h" 2>/dev/null || true
    echo "✅ Cleanup complete"
}

# --- Main Execution ---
validate_setup
pull_code
determine_target
build_images
start_new_env
# Run migrations BEFORE switching traffic, but AFTER starting new env
run_migrations
verify_and_wait
echo "⏳ Warm-up (10s)..." && sleep 10
switch_traffic
cleanup

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 DEPLOYMENT SUCCESSFUL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
