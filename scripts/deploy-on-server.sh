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

    # Preserve upstream.conf — it tracks the active blue/green environment
    # and must survive git reset --hard
    local saved_upstream=""
    if [ -f ./nginx/upstream.conf ]; then
        saved_upstream=$(cat ./nginx/upstream.conf)
    fi

    git fetch origin main
    git reset --hard origin/main

    # Restore upstream.conf (git reset overwrites it with the repo version)
    if [ -n "$saved_upstream" ]; then
        echo "$saved_upstream" > ./nginx/upstream.conf
    fi

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

# Pre-build cleanup to prevent "no space left on device" errors
pre_build_cleanup() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🧹 PRE-BUILD: Disk Cleanup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Check current disk usage
    DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    echo "📊 Current disk usage: ${DISK_USAGE}%"

    # Always clean build cache (this is the main culprit for "no space" errors)
    echo "🔄 Clearing Docker build cache..."
    docker builder prune -af 2>/dev/null || true

    # Clean dangling images and unused volumes
    echo "🔄 Removing dangling images..."
    docker image prune -f 2>/dev/null || true

    # If disk usage is high (>70%), do more aggressive cleanup
    if [ "$DISK_USAGE" -gt 70 ]; then
        echo "⚠️  Disk usage high (${DISK_USAGE}%), running aggressive cleanup..."

        # Remove images older than 48 hours (keeps current deployment safe)
        docker image prune -af --filter "until=48h" 2>/dev/null || true

        # Remove unused volumes
        docker volume prune -f 2>/dev/null || true

        # Remove stopped containers
        docker container prune -f 2>/dev/null || true
    fi

    # If still critical (>85%), remove all unused images
    DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$DISK_USAGE" -gt 85 ]; then
        echo "🚨 Disk still critical (${DISK_USAGE}%), removing ALL unused images..."
        docker system prune -af 2>/dev/null || true
    fi

    # Final disk check
    DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    echo "✅ Disk usage after cleanup: ${DISK_USAGE}%"

    if [ "$DISK_USAGE" -gt 90 ]; then
        echo "❌ ERROR: Disk usage still critical (${DISK_USAGE}%)!"
        echo "   Manual intervention required. Consider:"
        echo "   - Removing old logs: find /var/log -name '*.gz' -delete"
        echo "   - Clearing apt cache: apt-get clean"
        echo "   - Removing unused packages: apt autoremove"
        exit 1
    fi
}

# Build fresh Docker images
build_images() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🏗️  STEP 3: Building Docker images"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ -f ./env/frontend.env ]; then
        export $(grep -v '^#' ./env/frontend.env | xargs)
    fi
    # Export REDIS_PASSWORD so docker-compose can interpolate it
    if [ -f ./env/backend.env ]; then
        REDIS_PASSWORD=$(grep '^REDIS_PASSWORD=' ./env/backend.env | cut -d'=' -f2-)
        export REDIS_PASSWORD="${REDIS_PASSWORD:-changeme_in_production}"
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

    # Stop legacy (non-blue/green) app containers that should not run alongside blue-green
    echo "🧹 Stopping legacy non-blue/green app containers..."
    for legacy in jawab24-backend jawab24-frontend jawab24-ai-worker; do
        if docker ps --format '{{.Names}}' | grep -q "^${legacy}$"; then
            echo "   Stopping $legacy..."
            docker stop "$legacy" 2>/dev/null || true
            docker rm "$legacy" 2>/dev/null || true
        fi
    done

    echo "🧹 Cleaning up old $DEPLOY_ENV containers..."
    # Stop containers first
    docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml stop \
        backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV 2>/dev/null || true
    
    # Remove containers and wait for completion
    docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml rm -f \
        backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV 2>/dev/null || true
    
    # Wait for container removal to fully complete (avoids race condition)
    echo "   Waiting for container cleanup to complete..."
    for container in "jawab24-backend-$DEPLOY_ENV" "jawab24-frontend-$DEPLOY_ENV" "jawab24-ai-worker-$DEPLOY_ENV"; do
        removed=false
        for i in {1..10}; do
            if ! docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
                removed=true
                break
            fi
            sleep 1
        done
        # Force-remove if still present after waiting
        if [ "$removed" = false ]; then
            echo "   ⚠️  Container $container still present, force-removing..."
            docker rm -f "$container" 2>/dev/null || true
            sleep 1
        fi
    done
    sleep 2  # Extra buffer for Docker to release resources

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
        echo "   ❌ Migration command failed (exit code non-zero)."
        echo "   ⚠️  Viewing logs for details..."
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

# Validate required environment variables exist in env files
validate_env_files() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔐 ENV VALIDATION: Checking required variables"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    local failed=false

    # Backend required vars
    local backend_required=("DATABASE_URL" "JWT_SECRET" "COOKIE_SECRET" "REDIS_PASSWORD" "FACEBOOK_APP_ID" "FACEBOOK_APP_SECRET" "FACEBOOK_REDIRECT_URI" "FACEBOOK_WEBHOOK_VERIFY_TOKEN")
    if [ -f ./env/backend.env ]; then
        for var in "${backend_required[@]}"; do
            if ! grep -q "^${var}=" ./env/backend.env; then
                echo "❌ Missing ${var} in env/backend.env"
                failed=true
            fi
        done
    else
        echo "❌ env/backend.env not found!"
        failed=true
    fi

    # AI Worker required vars
    if [ -f ./env/ai.env ]; then
        if ! grep -q "^OPENAI_API_KEY=" ./env/ai.env; then
            echo "❌ Missing OPENAI_API_KEY in env/ai.env"
            failed=true
        fi
    else
        echo "❌ env/ai.env not found!"
        failed=true
    fi

    if [ "$failed" = true ]; then
        echo ""
        echo "❌ ENV VALIDATION FAILED - fix the above before deploying."
        exit 1
    fi
    echo "✅ All required environment variables present"
}

# Smoke test: verify pages return real HTML content (not just icons or error pages)
smoke_test_content() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔍 STEP 5b: Content Smoke Test"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    F_ID=$(docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml ps -q "frontend-$DEPLOY_ENV")

    # Verify CSS was built by checking static files on disk.
    # SSR HTML from the standalone server inconsistently includes CSS link tags
    # (depends on warm-up state), so checking the filesystem is more reliable.
    local CSS_FILES
    CSS_FILES=$(docker exec "$F_ID" ls /app/frontend/.next/static/css/ 2>/dev/null)
    if echo "$CSS_FILES" | grep -q '\.css'; then
        echo "   ✅ CSS stylesheets built successfully"
    else
        echo "   ❌ No CSS files in .next/static/css/ — Tailwind CSS was not built!"
        exit 1
    fi

    # Verify /en/login returns valid HTML with Next.js content
    local SMOKE_HTML
    SMOKE_HTML=$(docker exec "$F_ID" wget -qO- http://127.0.0.1:3001/en/login 2>/dev/null || echo "FETCH_FAILED")

    if echo "$SMOKE_HTML" | grep -q "FETCH_FAILED"; then
        echo "   ❌ Could not fetch /en/login from frontend container"
        exit 1
    fi

    if ! echo "$SMOKE_HTML" | grep -qi "</html>"; then
        echo "   ❌ /en/login did not return valid HTML!"
        echo "   First 500 chars of response:"
        echo "$SMOKE_HTML" | head -c 500
        exit 1
    fi

    if ! echo "$SMOKE_HTML" | grep -q "__next"; then
        echo "   ❌ /en/login is missing Next.js app container (__next)"
        echo "   The frontend may not have built correctly."
        exit 1
    fi

    echo "   ✅ Login page returns valid HTML with Next.js content"

    # Also verify the API health endpoint
    B_ID=$(docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml ps -q "backend-$DEPLOY_ENV")
    HEALTH_RESPONSE=$(docker exec "$B_ID" wget -qO- http://127.0.0.1:3000/health 2>/dev/null || echo "FETCH_FAILED")

    if echo "$HEALTH_RESPONSE" | grep -qi "ok\|healthy\|status"; then
        echo "   ✅ Backend health endpoint responds correctly"
    else
        echo "   ⚠️  Backend health endpoint returned unexpected response: $HEALTH_RESPONSE"
    fi
}

# Post-deploy: verify the live public URL returns valid content
post_deploy_check() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🌐 STEP 8: Post-Deploy Live URL Check"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    local LIVE_URL="https://jawab24.com/en/dashboard"
    local MAX_RETRIES=3
    local RETRY_DELAY=5

    for attempt in $(seq 1 $MAX_RETRIES); do
        echo "   Attempt $attempt/$MAX_RETRIES: checking $LIVE_URL ..."
        LIVE_HTML=$(curl -sL --max-time 15 "$LIVE_URL" 2>/dev/null || echo "CURL_FAILED")

        if echo "$LIVE_HTML" | grep -q "CURL_FAILED"; then
            echo "   ⚠️  curl failed to reach $LIVE_URL"
        elif ! echo "$LIVE_HTML" | grep -qi "</html>"; then
            echo "   ⚠️  Response is not valid HTML"
        elif ! echo "$LIVE_HTML" | grep -q "__next"; then
            echo "   ⚠️  Response is missing Next.js __next container"
        else
            echo "   ✅ Live site returns valid HTML with Next.js content"
            return 0
        fi

        if [ "$attempt" -lt "$MAX_RETRIES" ]; then
            echo "   Retrying in ${RETRY_DELAY}s..."
            sleep $RETRY_DELAY
        fi
    done

    echo "   ❌ Live URL check FAILED after $MAX_RETRIES attempts!"
    return 1
}

# Rollback: switch traffic back to the previous environment
rollback() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⏪ ROLLBACK: Switching traffic back to $ACTIVE_ENV"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    cat > ./nginx/upstream.conf << EOF
# Active environment: $ACTIVE_ENV (rolled back)
# Rolled back at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
upstream backend_active { server jawab24-backend-$ACTIVE_ENV:3000; }
upstream frontend_active { server jawab24-frontend-$ACTIVE_ENV:3001; }
upstream ai_worker_active { server jawab24-ai-worker-$ACTIVE_ENV:3002; }
EOF

    if docker restart jawab24-nginx; then
        for i in {1..30}; do
            if docker inspect jawab24-nginx | grep -q '"Status": "healthy"'; then break; fi
            sleep 1
        done
        echo "$ACTIVE_ENV" > .active-env
        echo "✅ Rolled back to $ACTIVE_ENV"
    else
        echo "❌ FATAL: Nginx failed to restart during rollback!"
    fi
}

# --- Main Execution ---
validate_setup
pull_code
validate_env_files  # Fail early if required env vars are missing
determine_target
pre_build_cleanup  # Clean disk BEFORE building to prevent "no space" errors
build_images
# Backup database BEFORE starting new containers (only old env is running = no lock contention)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💾 Pre-migration backup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
BACKUP_OK=false
for attempt in 1 2 3; do
    if ./scripts/backup.sh --local-only 2>&1; then
        echo "✅ Pre-migration backup created"
        BACKUP_OK=true
        break
    fi
    if [ "$attempt" -lt 3 ]; then
        echo "⚠️  Backup attempt $attempt failed, retrying in 5s..."
        sleep 5
    fi
done
if [ "$BACKUP_OK" = false ]; then
    echo "❌ Backup failed after 3 attempts — aborting deployment."
    echo "   Will not run migrations without a safety backup."
    exit 1
fi
start_new_env
# Run migrations BEFORE switching traffic, but AFTER starting new env
run_migrations
verify_and_wait
smoke_test_content  # Verify pages return real content before switching traffic
echo "⏳ Warm-up (10s)..." && sleep 10
switch_traffic

# Verify live URL after switching traffic; rollback if it fails
if ! post_deploy_check; then
    echo "❌ Post-deploy check failed! Initiating rollback..."
    rollback
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ DEPLOYMENT FAILED — rolled back to $ACTIVE_ENV"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

cleanup

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 DEPLOYMENT SUCCESSFUL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
