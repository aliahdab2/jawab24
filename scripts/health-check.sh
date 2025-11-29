#!/bin/bash

# Jawab24 Health Check Script
# Usage: ./scripts/health-check.sh

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "╔════════════════════════════════════════╗"
echo "║       Jawab24 Health Check             ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check Docker services
echo -e "${BLUE}[Docker Services]${NC}"
docker-compose ps
echo ""

# Check PostgreSQL
echo -e "${BLUE}[PostgreSQL]${NC}"
if docker-compose exec -T postgres pg_isready -U postgres -d autoreply > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} PostgreSQL is healthy"
else
    echo -e "${RED}✗${NC} PostgreSQL is not responding"
fi

# Check Redis
echo -e "${BLUE}[Redis]${NC}"
if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Redis is healthy"
else
    echo -e "${RED}✗${NC} Redis is not responding"
fi

# Check Backend API
echo -e "${BLUE}[Backend API]${NC}"
if curl -s http://localhost/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost/health)
    echo -e "${GREEN}✓${NC} Backend is healthy: $HEALTH"
else
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        HEALTH=$(curl -s http://localhost:3000/health)
        echo -e "${GREEN}✓${NC} Backend is healthy (direct): $HEALTH"
    else
        echo -e "${RED}✗${NC} Backend is not responding"
    fi
fi

# Check Frontend
echo -e "${BLUE}[Frontend]${NC}"
if curl -s http://localhost > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Frontend is healthy"
else
    if curl -s http://localhost:3001 > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Frontend is healthy (direct)"
    else
        echo -e "${RED}✗${NC} Frontend is not responding"
    fi
fi

# Check AI Worker
echo -e "${BLUE}[AI Worker]${NC}"
if curl -s http://localhost/ai/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost/ai/health)
    echo -e "${GREEN}✓${NC} AI Worker is healthy: $HEALTH"
else
    if curl -s http://localhost:3002/health > /dev/null 2>&1; then
        HEALTH=$(curl -s http://localhost:3002/health)
        echo -e "${GREEN}✓${NC} AI Worker is healthy (direct): $HEALTH"
    else
        echo -e "${YELLOW}⚠${NC} AI Worker is not responding (may be normal if not running)"
    fi
fi

# Check Nginx
echo -e "${BLUE}[Nginx]${NC}"
if curl -s http://localhost/nginx-health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Nginx is healthy"
else
    echo -e "${YELLOW}⚠${NC} Nginx health endpoint not responding"
fi

echo ""
echo -e "${BLUE}[Resource Usage]${NC}"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || echo "Unable to get stats"

echo ""

