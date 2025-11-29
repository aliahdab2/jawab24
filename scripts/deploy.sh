#!/bin/bash
set -e

# Jawab24 Deployment Script
# Usage: ./scripts/deploy.sh [--skip-checks]

echo "🚀 Jawab24 Deployment Script"
echo "============================"

SKIP_CHECKS=false

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --skip-checks) SKIP_CHECKS=true ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Run pre-deploy checks unless skipped
if [ "$SKIP_CHECKS" = false ]; then
    echo ""
    echo "Running pre-deployment checks..."
    ./scripts/pre-deploy.sh
    if [ $? -ne 0 ]; then
        echo "❌ Pre-deployment checks failed. Aborting."
        exit 1
    fi
fi

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo ""
    echo "📝 You have uncommitted changes:"
    git status -s
    echo ""
    read -p "Commit message (or Ctrl+C to cancel): " COMMIT_MSG
    git add -A
    git commit -m "$COMMIT_MSG"
fi

# Push to GitHub
echo ""
echo "📤 Pushing to GitHub..."
git push

echo ""
echo "✅ Code pushed successfully!"
echo ""
echo "To complete deployment, SSH to your server and run:"
echo ""
echo "  cd /var/www/jawab24"
echo "  git pull"
echo "  docker-compose up -d --build"
echo ""
echo "Or run this command from your local machine:"
echo "  ssh root@91.99.95.196 'cd /var/www/jawab24 && git pull && docker-compose up -d --build'"
