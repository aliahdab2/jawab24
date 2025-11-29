#!/bin/bash

# Jawab24 Deployment Script
# Usage: ./scripts/deploy.sh [dev|prod]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if docker and docker-compose are installed
check_dependencies() {
    log_info "Checking dependencies..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    log_success "All dependencies are installed."
}

# Setup environment files
setup_env() {
    log_info "Setting up environment files..."
    
    if [ ! -f ./env/backend.env ]; then
        cp ./env/backend.env.example ./env/backend.env
        log_warning "Created backend.env from example. Please update with your values."
    fi
    
    if [ ! -f ./env/frontend.env ]; then
        cp ./env/frontend.env.example ./env/frontend.env
        log_warning "Created frontend.env from example. Please update with your values."
    fi
    
    if [ ! -f ./env/ai.env ]; then
        cp ./env/ai.env.example ./env/ai.env
        log_warning "Created ai.env from example. Please update with your values."
    fi
    
    if [ ! -f ./env/db.env ]; then
        cp ./env/db.env.example ./env/db.env
        log_warning "Created db.env from example. Please update with your values."
    fi
    
    log_success "Environment files are ready."
}

# Create required directories
create_directories() {
    log_info "Creating required directories..."
    
    mkdir -p ./data/postgres
    mkdir -p ./data/redis
    mkdir -p ./nginx/ssl
    
    log_success "Directories created."
}

# Development deployment
deploy_dev() {
    log_info "Starting development deployment..."
    
    # Start only database services
    docker-compose -f docker-compose.dev.yml up -d
    
    log_info "Waiting for services to be healthy..."
    sleep 10
    
    # Check health
    if docker-compose -f docker-compose.dev.yml ps | grep -q "healthy"; then
        log_success "Development services are running!"
        echo ""
        echo "Services:"
        echo "  - PostgreSQL: localhost:5433"
        echo "  - Redis: localhost:6379"
        echo ""
        echo "To start the backend:"
        echo "  cd backend && npm run dev"
        echo ""
        echo "To start the frontend:"
        echo "  cd frontend && npm run dev"
        echo ""
        echo "To start the AI worker:"
        echo "  cd ai-worker && npm run dev"
    else
        log_warning "Some services may not be healthy yet. Check with: docker-compose -f docker-compose.dev.yml ps"
    fi
}

# Production deployment
deploy_prod() {
    log_info "Starting production deployment..."
    
    # Build all images
    log_info "Building Docker images..."
    docker-compose build --no-cache
    
    # Start services
    log_info "Starting services..."
    docker-compose up -d
    
    log_info "Waiting for services to be healthy..."
    sleep 30
    
    # Run database migrations
    log_info "Running database migrations..."
    docker-compose exec -T backend node -e "
        const { execSync } = require('child_process');
        try {
            execSync('node dist/db/migrate.js', { stdio: 'inherit' });
        } catch (e) {
            console.log('Migration script not found, skipping...');
        }
    " || true
    
    # Check health
    log_info "Checking service health..."
    docker-compose ps
    
    log_success "Production deployment complete!"
    echo ""
    echo "Services are running at:"
    echo "  - Frontend: http://localhost (or your domain)"
    echo "  - API: http://localhost/api"
    echo "  - Webhook: http://localhost/webhook"
    echo ""
    echo "To view logs:"
    echo "  docker-compose logs -f"
    echo ""
    echo "To stop services:"
    echo "  docker-compose down"
}

# Stop all services
stop_services() {
    log_info "Stopping all services..."
    docker-compose down
    docker-compose -f docker-compose.dev.yml down 2>/dev/null || true
    log_success "All services stopped."
}

# View logs
view_logs() {
    docker-compose logs -f
}

# Main
main() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║         Jawab24 Deployment              ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    check_dependencies
    
    case "${1:-}" in
        dev)
            setup_env
            create_directories
            deploy_dev
            ;;
        prod)
            setup_env
            create_directories
            deploy_prod
            ;;
        stop)
            stop_services
            ;;
        logs)
            view_logs
            ;;
        *)
            echo "Usage: $0 [dev|prod|stop|logs]"
            echo ""
            echo "Commands:"
            echo "  dev   - Start development environment (database only)"
            echo "  prod  - Build and start production environment"
            echo "  stop  - Stop all services"
            echo "  logs  - View service logs"
            exit 1
            ;;
    esac
}

main "$@"

