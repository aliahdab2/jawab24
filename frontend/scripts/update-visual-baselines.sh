#!/bin/bash
#
# Generate Linux visual regression baselines using Docker.
#
# Playwright renders fonts differently per OS. CI runs on Ubuntu (Linux),
# so baselines must be generated on Linux too. This script runs Playwright
# inside the official mcr.microsoft.com/playwright container to produce
# *-chromium-linux.png snapshots that match CI exactly.
#
# Usage:
#   1. Start the frontend dev server: cd frontend && npm run dev
#   2. Run this script: ./frontend/scripts/update-visual-baselines.sh
#   3. Commit the new *-chromium-linux.png files
#
# Prerequisites: Docker running, frontend dev server on port 3001

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"

# Match the installed Playwright version
PW_VERSION=$(node -e "console.log(require('$FRONTEND_DIR/node_modules/@playwright/test/package.json').version)")
echo "Playwright v${PW_VERSION} — generating Linux baselines..."

# Verify dev server is running
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/en/login 2>/dev/null | grep -q "200"; then
  echo "ERROR: Frontend dev server not running on port 3001."
  echo "Start it first: cd frontend && npm run dev"
  exit 1
fi

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$FRONTEND_DIR/e2e":/work/e2e \
  -v "$FRONTEND_DIR/playwright.docker.config.ts":/work/playwright.config.ts \
  -w /work \
  -e PLAYWRIGHT_BASE_URL=http://host.docker.internal:3001 \
  "mcr.microsoft.com/playwright:v${PW_VERSION}" \
  bash -c "npm init -y > /dev/null 2>&1 && npm install @playwright/test@${PW_VERSION} > /dev/null 2>&1 && npx playwright test e2e/visual.spec.ts --update-snapshots"

echo ""
echo "Done. Linux baselines in frontend/e2e/visual.spec.ts-snapshots/"
echo "Commit the new *-chromium-linux.png files."
