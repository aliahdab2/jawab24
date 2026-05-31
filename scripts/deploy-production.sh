#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# JAWAB24 LOCAL CI/CD SCRIPT
# ═══════════════════════════════════════════════════════════════════
# This script runs the full CI/CD pipeline locally without GitHub Actions
# It replicates the same checks and blue-green deployment as CI/CD
#
# Usage: ./scripts/deploy-production.sh
#        ./scripts/deploy-production.sh -y              # Skip confirmation
#        ./scripts/deploy-production.sh --skip-tests    # Skip CI tests
#        ./scripts/deploy-production.sh -y --skip-tests # Both
# ═══════════════════════════════════════════════════════════════════

set -e

# Configuration
SERVER_HOST="91.99.95.196"
SERVER_USER="root"
DEPLOY_PATH="/var/www/jawab24"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_jawab24_deploy}"
SKIP_TESTS=false
AUTO_CONFIRM=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        -y|--yes)
            AUTO_CONFIRM=true
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
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${CYAN}🧪 RUNNING CI CHECKS (Same as GitHub Actions)${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Run the shared pre-deploy check script
    # This ensures local deploys and GitHub Actions use the same validation
    if ! ./scripts/pre-deploy-check.sh; then
        echo ""
        echo -e "${RED}❌ Pre-deploy checks failed!${NC}"
        echo "Fix the issues above before deploying."
        exit 1
    fi

    echo ""
    echo -e "${GREEN}✅ All CI checks passed!${NC}"
    echo ""
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
if [ ! -f "$SSH_KEY" ]; then
    echo -e "${RED}❌ SSH key not found: $SSH_KEY${NC}"
    echo -e "Set SSH_KEY environment variable or create the key."
    exit 1
fi
if ! ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o BatchMode=yes ${SERVER_USER}@${SERVER_HOST} "echo 'connected'" > /tmp/ssh_error.log 2>&1; then
    echo -e "${RED}❌ Cannot connect to server!${NC}"
    echo -e "${RED}   Error Details: $(cat /tmp/ssh_error.log)${NC}"
    echo -e "Make sure your SSH key is added to the server."
    exit 1
fi
rm -f /tmp/ssh_error.log
echo -e "${GREEN}✅ SSH connection successful (using ${SSH_KEY})${NC}"

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
if [ "$AUTO_CONFIRM" = true ]; then
    echo -e "${GREEN}Auto-confirmed with -y flag${NC}"
else
    read -p "Deploy this commit to production? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Deployment cancelled.${NC}"
        exit 0
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# Step 3: Deploy to server
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🚀 DEPLOYING TO SERVER${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ═══════════════════════════════════════════════════════════════════
# Deploy on Server (using existing deploy-blue-green.sh)
# ═══════════════════════════════════════════════════════════════════
echo -e "${CYAN}Connecting to server and running deployment...${NC}"
echo ""

ssh -i "$SSH_KEY" ${SERVER_USER}@${SERVER_HOST} << 'ENDSSH'
set -e
cd /var/www/jawab24

# Ensure deployment script is updated and executable
echo "🔄 Updating deployment scripts..."
git fetch origin main > /dev/null
git checkout origin/main -- scripts/deploy-on-server.sh
chmod +x scripts/deploy-on-server.sh

# Run the unified deployment script
./scripts/deploy-on-server.sh
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

# Notify IndexNow (Bing / Copilot / ChatGPT Search / Yandex) of the live URL set.
# Non-blocking: skipped when INDEXNOW_KEY is unset, and can never fail the deploy
# (the deploy already succeeded by this point).
if [ -n "${INDEXNOW_KEY:-}" ]; then
  echo -e "🔔 Pinging IndexNow…"
  npx tsx scripts/indexnow-ping.ts || echo "⚠️  IndexNow ping failed (non-fatal)"
  echo ""
fi

