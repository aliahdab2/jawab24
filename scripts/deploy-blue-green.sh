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
    docker exec jawab24-nginx nginx -s reload
    
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
    
    # Load frontend env vars
    if [ -f ./env/frontend.env ]; then
        export $(grep -v '^#' ./env/frontend.env | xargs)
    fi
    
    # Build images
    log "Building Docker images..."
    docker-compose -f docker-compose.yml -f docker-compose.$env.yml build --parallel
    
    # Start the new environment
    log "Starting $env containers..."
    docker-compose -f docker-compose.yml -f docker-compose.$env.yml up -d backend-$env frontend-$env ai-worker-$env
    
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
    
    # Step 4: Verify via nginx (multiple checks for reliability)
    log "Verifying traffic switch..."
    VERIFY_SUCCESS=0
    for i in {1..5}; do
        sleep 1
        if curl -sf http://localhost/api/health > /dev/null 2>&1 && \
           curl -sf http://localhost/ > /dev/null 2>&1; then
            VERIFY_SUCCESS=1
            break
        fi
        log "Retry $i/5..."
    done
    
    if [ $VERIFY_SUCCESS -eq 1 ]; then
        log "✅ Traffic switch verified - services responding"
    else
        error "❌ Traffic switch verification failed after 5 attempts!"
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








