#!/bin/bash
#
# Environment Variables Checker
# Run before deployment to ensure all required vars are set
#
# Usage: ./scripts/check-env.sh
#

set -e

echo "🔍 Checking Environment Variables"
echo "=================================="
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

# Determine if we're on the server or local
if [ -d "/var/www/jawab24" ]; then
    ENV_DIR="/var/www/jawab24/env"
    echo "📍 Running on server"
else
    ENV_DIR="./env"
    echo "📍 Running locally"
fi

echo ""

# ==========================================
# Backend Environment
# ==========================================
echo "📦 Backend Environment (backend.env)"
echo "-------------------------------------"

BACKEND_ENV="$ENV_DIR/backend.env"

if [ ! -f "$BACKEND_ENV" ]; then
    echo -e "${RED}❌ $BACKEND_ENV not found!${NC}"
    ERRORS=1
else
    # Required variables
    BACKEND_REQUIRED=(
        "DATABASE_URL"
        "JWT_SECRET"
        "FACEBOOK_APP_ID"
        "FACEBOOK_APP_SECRET"
        "FACEBOOK_REDIRECT_URI"
        "FACEBOOK_WEBHOOK_VERIFY_TOKEN"
    )
    
    # Optional but recommended
    BACKEND_OPTIONAL=(
        "STRIPE_SECRET_KEY"
        "STRIPE_PUBLISHABLE_KEY"
        "STRIPE_WEBHOOK_SECRET"
        "REDIS_HOST"
        "REDIS_PORT"
    )
    
    for var in "${BACKEND_REQUIRED[@]}"; do
        if grep -q "^$var=" "$BACKEND_ENV" 2>/dev/null; then
            value=$(grep "^$var=" "$BACKEND_ENV" | cut -d'=' -f2-)
            if [ -z "$value" ] || [ "$value" = "your_"* ] || [ "$value" = "sk_test_your"* ]; then
                echo -e "${RED}❌ $var is not set properly${NC}"
                ERRORS=1
            else
                # Mask sensitive values
                if [[ "$var" == *"SECRET"* ]] || [[ "$var" == *"PASSWORD"* ]]; then
                    echo -e "${GREEN}✅ $var = ****${NC}"
                else
                    echo -e "${GREEN}✅ $var = ${value:0:30}...${NC}"
                fi
            fi
        else
            echo -e "${RED}❌ $var is MISSING${NC}"
            ERRORS=1
        fi
    done
    
    echo ""
    echo "Optional variables:"
    for var in "${BACKEND_OPTIONAL[@]}"; do
        if grep -q "^$var=" "$BACKEND_ENV" 2>/dev/null; then
            value=$(grep "^$var=" "$BACKEND_ENV" | cut -d'=' -f2-)
            if [ -n "$value" ] && [ "$value" != "your_"* ]; then
                echo -e "${GREEN}✅ $var configured${NC}"
            else
                echo -e "${YELLOW}⚠️  $var not configured (optional)${NC}"
                WARNINGS=1
            fi
        else
            echo -e "${YELLOW}⚠️  $var not set (optional)${NC}"
            WARNINGS=1
        fi
    done
fi

echo ""

# ==========================================
# Frontend Environment
# ==========================================
echo "🎨 Frontend Environment (frontend.env)"
echo "---------------------------------------"

FRONTEND_ENV="$ENV_DIR/frontend.env"

if [ ! -f "$FRONTEND_ENV" ]; then
    echo -e "${RED}❌ $FRONTEND_ENV not found!${NC}"
    ERRORS=1
else
    FRONTEND_REQUIRED=(
        "NEXT_PUBLIC_API_URL"
        "NEXT_PUBLIC_FB_APP_ID"
    )
    
    for var in "${FRONTEND_REQUIRED[@]}"; do
        if grep -q "^$var=" "$FRONTEND_ENV" 2>/dev/null; then
            value=$(grep "^$var=" "$FRONTEND_ENV" | cut -d'=' -f2-)
            if [ -z "$value" ] || [ "$value" = "your_"* ]; then
                echo -e "${RED}❌ $var is not set properly${NC}"
                ERRORS=1
            else
                echo -e "${GREEN}✅ $var = $value${NC}"
            fi
        else
            echo -e "${RED}❌ $var is MISSING${NC}"
            ERRORS=1
        fi
    done
fi

echo ""

# ==========================================
# AI Worker Environment
# ==========================================
echo "🤖 AI Worker Environment (ai.env)"
echo "----------------------------------"

AI_ENV="$ENV_DIR/ai.env"

if [ ! -f "$AI_ENV" ]; then
    echo -e "${RED}❌ $AI_ENV not found!${NC}"
    ERRORS=1
else
    AI_REQUIRED=(
        "OPENAI_API_KEY"
        "AI_WORKER_SECRET"
    )

    for var in "${AI_REQUIRED[@]}"; do
        if grep -q "^$var=" "$AI_ENV" 2>/dev/null; then
            value=$(grep "^$var=" "$AI_ENV" | tail -1 | cut -d'=' -f2-)
            if [ -z "$value" ] || [[ "$value" == your_* ]] || [[ "$value" == sk-your* ]]; then
                echo -e "${RED}❌ $var is not set properly${NC}"
                ERRORS=1
            else
                echo -e "${GREEN}✅ $var = ****${NC}"
            fi
        else
            echo -e "${RED}❌ $var is MISSING${NC}"
            ERRORS=1
        fi
    done

    # AI_WORKER_SECRET contract (required in production since PR #409):
    # must exist in BOTH backend.env and ai.env, be >=16 chars, and be IDENTICAL —
    # the backend presents it as X-AI-Worker-Secret and the worker compares it.
    # A missing secret crash-loops both containers at startup (JAWAB24-AI-WORKER-8);
    # a mismatched one makes the worker 401 every generation request.
    AI_SECRET=$(grep "^AI_WORKER_SECRET=" "$AI_ENV" 2>/dev/null | tail -1 | cut -d'=' -f2-)
    BACKEND_SECRET=$(grep "^AI_WORKER_SECRET=" "$BACKEND_ENV" 2>/dev/null | tail -1 | cut -d'=' -f2-)

    if [ -z "$BACKEND_SECRET" ]; then
        echo -e "${RED}❌ AI_WORKER_SECRET is MISSING from backend.env (backend fails startup validation without it)${NC}"
        ERRORS=1
    fi
    if [ -n "$AI_SECRET" ] && [ ${#AI_SECRET} -lt 16 ]; then
        echo -e "${RED}❌ AI_WORKER_SECRET must be at least 16 characters (got ${#AI_SECRET})${NC}"
        ERRORS=1
    fi
    if [ -n "$AI_SECRET" ] && [ -n "$BACKEND_SECRET" ]; then
        if [ "$AI_SECRET" = "$BACKEND_SECRET" ]; then
            echo -e "${GREEN}✅ AI_WORKER_SECRET matches between backend.env and ai.env${NC}"
        else
            echo -e "${RED}❌ AI_WORKER_SECRET MISMATCH between backend.env and ai.env (worker will 401 every backend request)${NC}"
            ERRORS=1
        fi
    fi
fi

echo ""

# ==========================================
# Database Environment
# ==========================================
echo "🗄️  Database Environment (db.env)"
echo "----------------------------------"

DB_ENV="$ENV_DIR/db.env"

if [ ! -f "$DB_ENV" ]; then
    echo -e "${YELLOW}⚠️  $DB_ENV not found (may use defaults)${NC}"
    WARNINGS=1
else
    echo -e "${GREEN}✅ db.env exists${NC}"
fi

echo ""

# ==========================================
# Summary
# ==========================================
echo "=================================="
if [ $ERRORS -eq 0 ]; then
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Environment check passed with warnings${NC}"
    else
        echo -e "${GREEN}✅ All environment variables are configured!${NC}"
    fi
    echo ""
    echo "Ready for deployment."
    exit 0
else
    echo -e "${RED}❌ Environment check FAILED${NC}"
    echo ""
    echo "Please fix the missing/invalid variables before deploying."
    exit 1
fi

