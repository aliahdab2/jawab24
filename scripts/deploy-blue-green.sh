#!/bin/bash
# Blue-Green Deployment Script for Jawab24
# This script enables zero-downtime deployments by:
# 1. Deploying to the inactive environment (blue or green)
# 2. Health checking the new deployment
# 3. Switching traffic to the new environment
# 4. Keeping the old environment as fallback

set -e

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/jawab24}"
cd "$DEPLOY_PATH"

# Get git info for versioning
export GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
export GIT_COMMIT_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Semantic version comes from git tags (fallback to 'untagged' if none)
export SEMANTIC_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "untagged")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Determine current active environment
get_active_env() {
    if [ -f "$DEPLOY_PATH/.active-env" ]; then
        cat "$DEPLOY_PATH/.active-env"
    else
        echo "blue"  # Default to blue
    fi
}

# Get the inactive environment
get_inactive_env() {
    if [ "$(get_active_env)" == "blue" ]; then
        echo "green"
    else
        echo "blue"
    fi
}

# Wait for Docker DNS to resolve container names in nginx
wait_for_dns() {
    local env=$1
    local max_wait=10
    log "Waiting for Docker DNS to resolve $env containers..."
    for i in $(seq 1 $max_wait); do
        if docker exec jawab24-nginx getent hosts jawab24-backend-$env > /dev/null 2>&1; then
            log "✅ DNS resolution ready for $env"
            return 0
        fi
        warn "⏳ DNS not ready yet... attempt $i/$max_wait"
        sleep 1
    done
    warn "⚠️  DNS resolution may not be fully ready"
    return 1
}

# Health check function - checks containers directly to avoid nginx redirect issues
health_check() {
    local env=$1
    local max_attempts=30
    local attempt=1
    
    log "Running health checks for $env environment..."
    
    # Wait for containers to be fully up
    sleep 5
    
    # Check backend health directly via container (avoids nginx HTTP->HTTPS redirect)
    while [ $attempt -le $max_attempts ]; do
        # Check container health directly - avoids nginx HTTP->HTTPS redirect issues
        local health_response=$(docker exec jawab24-backend-$env wget -q -O- http://localhost:3000/health 2>/dev/null || echo "")
        if [ -n "$health_response" ]; then
            # Get only the FIRST status (root level), not nested service statuses
            local health_status=$(echo "$health_response" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
            if [ "$health_status" = "healthy" ] || [ "$health_status" = "degraded" ]; then
                log "✅ Backend ($env) is healthy (status: $health_status)"
                break
            fi
        fi
        if [ $attempt -eq $max_attempts ]; then
            error "❌ Backend ($env) health check failed after $max_attempts attempts"
            return 1
        fi
        warn "⏳ Waiting for backend ($env)... attempt $attempt/$max_attempts"
        sleep 2
        ((attempt++))
    done
    
    # Check frontend health directly via container
    attempt=1
    while [ $attempt -le $max_attempts ]; do
        # Check if frontend responds on port 3001
        if docker exec jawab24-frontend-$env wget -q --spider http://localhost:3001/ 2>/dev/null; then
            log "✅ Frontend ($env) is healthy"
            break
        fi
        if [ $attempt -eq $max_attempts ]; then
            error "❌ Frontend ($env) health check failed after $max_attempts attempts"
            return 1
        fi
        warn "⏳ Waiting for frontend ($env)... attempt $attempt/$max_attempts"
        sleep 2
        ((attempt++))
    done
    
    log "✅ All health checks passed for $env environment"
    return 0
}

# Switch traffic to the specified environment
switch_traffic() {
    local new_env=$1
    log "Switching traffic to $new_env environment..."
    
    # Update nginx upstream configuration
    cat > "$DEPLOY_PATH/nginx/upstream.conf" << EOF
# Active environment: $new_env
# Generated at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')

upstream backend_active {
    server jawab24-backend-$new_env:3000;
    keepalive 32;
}

upstream frontend_active {
    server jawab24-frontend-$new_env:3001;
    keepalive 32;
}

upstream ai_worker_active {
    server jawab24-ai-worker-$new_env:3002;
    keepalive 16;
}
EOF
    
    # Test nginx config before reloading
    if ! docker exec jawab24-nginx nginx -t > /dev/null 2>&1; then
        error "❌ Nginx config test failed!"
        return 1
    fi
    
    # Graceful reload (zero-downtime)
    # This tells nginx to:
    # 1. Keep old workers handling existing requests
    # 2. Start new workers with new config
    # 3. Gradually shut down old workers as requests complete
    docker exec jawab24-nginx nginx -s reload 2>&1 | grep -v "http2.*deprecated" || true
    
    # Wait for reload to complete
    sleep 1
    
    # Verify nginx is still running
    if ! docker exec jawab24-nginx nginx -v > /dev/null 2>&1; then
        error "❌ Nginx is not running after reload!"
        return 1
    fi
    
    # Save active environment
    echo "$new_env" > "$DEPLOY_PATH/.active-env"
    
    log "✅ Traffic switched to $new_env"
}

# Deploy to specified environment
deploy_env() {
    local env=$1
    log "Deploying to $env environment..."
    
    # Write deploy time (used by backend /api/version)
    log "📝 Recording deploy time..."
    date -u '+%Y-%m-%dT%H:%M:%SZ' > .deploy-time
    log "   Version: $SEMANTIC_VERSION ($GIT_COMMIT_SHORT)"
    
    # Load frontend env vars
    if [ -f ./env/frontend.env ]; then
        export $(grep -v '^#' ./env/frontend.env | xargs)
    fi
    
    # Build images (quiet mode, no cache - only show errors and final summary)
    # Pass GIT_COMMIT and SEMANTIC_VERSION as build args for versioning
    log "📦 Building Docker images..."
    if GIT_COMMIT="$GIT_COMMIT" SEMANTIC_VERSION="$SEMANTIC_VERSION" docker-compose -f docker-compose.yml -f docker-compose.$env.yml build --parallel --quiet --no-cache --build-arg GIT_COMMIT="$GIT_COMMIT" --build-arg SEMANTIC_VERSION="$SEMANTIC_VERSION" 2>&1; then
        log "✅ Images built successfully"
    else
        error "❌ Image build failed!"
        return 1
    fi
    
    # Start the new environment (suppress orphan warnings)
    log "🚀 Starting $env containers..."
    docker-compose -f docker-compose.yml -f docker-compose.$env.yml up -d backend-$env frontend-$env ai-worker-$env 2>&1 | grep -v "orphan containers" || true
    
    log "✅ $env environment deployed"
}

# Stop old environment (after successful switch)
stop_old_env() {
    local env=$1
    log "Stopping old $env environment..."
    docker-compose -f docker-compose.yml -f docker-compose.$env.yml stop backend-$env frontend-$env ai-worker-$env 2>/dev/null || true
    log "✅ Old $env environment stopped"
}

# Main deployment
main() {
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "🚀 BLUE-GREEN DEPLOYMENT"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Step 0: Validate environment variables before starting
    log "Step 0: Validating environment variables..."
    if [ -f "$DEPLOY_PATH/scripts/check-env.sh" ]; then
        if ! bash "$DEPLOY_PATH/scripts/check-env.sh"; then
            error "❌ Environment validation failed! Fix missing variables before deploying."
            exit 1
        fi
    else
        warn "⚠️  check-env.sh not found, skipping validation"
    fi
    
    ACTIVE_ENV=$(get_active_env)
    DEPLOY_ENV=$(get_inactive_env)
    
    log "📍 Current active: $ACTIVE_ENV"
    log "🎯 Deploying to: $DEPLOY_ENV"
    
    # Step 1: Deploy to inactive environment
    deploy_env "$DEPLOY_ENV"
    
    # Step 2: Health check
    if ! health_check "$DEPLOY_ENV"; then
        error "Health checks failed! Aborting deployment."
        error "Rolling back..."
        docker-compose -f docker-compose.yml -f docker-compose.$DEPLOY_ENV.yml stop backend-$DEPLOY_ENV frontend-$DEPLOY_ENV ai-worker-$DEPLOY_ENV 2>/dev/null || true
        exit 1
    fi
    
    # Step 3: Switch traffic
    switch_traffic "$DEPLOY_ENV"
    
    # Step 4: Verify nginx can reach the new containers via Docker network
    log "Verifying traffic switch..."
    
    # Wait for Docker DNS to propagate to nginx
    wait_for_dns "$DEPLOY_ENV" || true
    
    # Give nginx time to pick up new upstream config
    sleep 2
    
    VERIFY_SUCCESS=0
    for i in {1..10}; do
        # Verify nginx can reach backend through Docker network (not localhost)
        # This tests the actual path nginx uses to reach the containers
        BACKEND_OK=0
        FRONTEND_OK=0
        
        # Check backend via nginx container using Docker DNS
        if docker exec jawab24-nginx wget -q -O- --timeout=5 http://jawab24-backend-$DEPLOY_ENV:3000/health 2>/dev/null | grep -q '"status"'; then
            BACKEND_OK=1
        fi
        
        # Check frontend via nginx container using Docker DNS
        if docker exec jawab24-nginx wget -q --spider --timeout=5 http://jawab24-frontend-$DEPLOY_ENV:3001/ 2>/dev/null; then
            FRONTEND_OK=1
        fi
        
        if [ $BACKEND_OK -eq 1 ] && [ $FRONTEND_OK -eq 1 ]; then
            VERIFY_SUCCESS=1
            log "✅ Nginx can reach backend ($DEPLOY_ENV) via Docker network"
            log "✅ Nginx can reach frontend ($DEPLOY_ENV) via Docker network"
            break
        fi
        
        warn "Retry $i/10 - Backend: $([ $BACKEND_OK -eq 1 ] && echo 'OK' || echo 'waiting'), Frontend: $([ $FRONTEND_OK -eq 1 ] && echo 'OK' || echo 'waiting')"
        sleep 2
    done
    
    if [ $VERIFY_SUCCESS -eq 1 ]; then
        log "✅ Traffic switch verified - nginx can reach all $DEPLOY_ENV containers"
        
        # Final external verification (informational only, doesn't block deployment)
        log "Running external health check..."
        if curl -sf --max-time 5 https://jawab24.com/api/health > /dev/null 2>&1; then
            log "✅ External API health check passed"
        else
            warn "⚠️  External API check failed (may be DNS/SSL caching, services are working)"
        fi
    else
        error "❌ Traffic switch verification failed after 10 attempts!"
        error "Nginx cannot reach $DEPLOY_ENV containers through Docker network"
        
        # Debug info
        error "Debug: Container status..."
        docker ps --filter "name=jawab24-backend-$DEPLOY_ENV" --format "{{.Status}}"
        docker ps --filter "name=jawab24-frontend-$DEPLOY_ENV" --format "{{.Status}}"
        
        warn "Rolling back to $ACTIVE_ENV..."
        switch_traffic "$ACTIVE_ENV"
        exit 1
    fi
    
    # Step 5: Stop old environment (optional - keep for quick rollback)
    # Uncomment the next line to stop old containers after successful deploy
    # stop_old_env "$ACTIVE_ENV"
    
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "🎉 DEPLOYMENT SUCCESSFUL"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "Active environment: $DEPLOY_ENV"
    log "Rollback available: $ACTIVE_ENV"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Rollback command
rollback() {
    ACTIVE_ENV=$(get_active_env)
    ROLLBACK_ENV=$(get_inactive_env)
    
    log "🔄 Rolling back from $ACTIVE_ENV to $ROLLBACK_ENV..."
    
    # Check if rollback environment is running
    if ! docker ps | grep -q "jawab24-backend-$ROLLBACK_ENV"; then
        error "Rollback environment ($ROLLBACK_ENV) is not running!"
        exit 1
    fi
    
    switch_traffic "$ROLLBACK_ENV"
    log "✅ Rolled back to $ROLLBACK_ENV"
}

# Command handling
case "${1:-deploy}" in
    deploy)
        main
        ;;
    rollback)
        rollback
        ;;
    status)
        log "Active environment: $(get_active_env)"
        docker-compose ps
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|status}"
        exit 1
        ;;
esac








