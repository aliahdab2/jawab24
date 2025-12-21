#!/bin/bash

# =====================================================
# Pre-deployment check script for Jawab24
# Run this before pushing to ensure no build errors
# =====================================================

set -e

echo "🔍 Running pre-deployment checks..."

# Check backend TypeScript
echo ""
echo "📦 Checking Backend TypeScript..."
cd backend
npx tsc --noEmit
echo "✅ Backend TypeScript OK"

# Check frontend TypeScript
echo ""
echo "📦 Checking Frontend TypeScript..."
cd ../frontend
npx tsc --noEmit
echo "✅ Frontend TypeScript OK"

# Check AI worker TypeScript
echo ""
echo "📦 Checking AI Worker TypeScript..."
cd ../ai-worker
npx tsc --noEmit
echo "✅ AI Worker TypeScript OK"

cd ..

echo ""
echo "🎉 All checks passed! Safe to deploy."
echo ""
echo "To deploy, run:"
echo "  git add -A && git commit -m 'Your message' && git push"
echo ""
echo "Then on server:"
echo "  cd /var/www/jawab24 && git pull && docker-compose up -d --build"









