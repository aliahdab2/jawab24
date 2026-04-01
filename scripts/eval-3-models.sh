#!/bin/bash
# Run eval against 3 models with cache flush between each
set -e

cd /Users/aliahdab/Documents/AutoReply

MODELS=("gpt-4.1-mini" "gpt-5.4-nano" "gpt-5.4-mini")
SHARED_FILE="packages/shared/src/index.ts"
DB_URL="postgres://aliahdab@localhost:5432/postgres"
RESULTS_DIR="/tmp/eval-results"
mkdir -p "$RESULTS_DIR"

for MODEL in "${MODELS[@]}"; do
  echo ""
  echo "============================================================"
  echo "  TESTING: $MODEL"
  echo "============================================================"

  # 1. Set model
  sed -i '' "s/export const DEFAULT_AI_MODEL = '.*'/export const DEFAULT_AI_MODEL = '$MODEL'/" "$SHARED_FILE"
  echo "  Model set to: $MODEL"

  # 2. Rebuild shared
  echo "  Rebuilding shared package..."
  cd packages/shared && npm run build > /dev/null 2>&1 && cd ../..

  # 3. Flush cache
  psql "$DB_URL" -c "TRUNCATE ai_cache, semantic_cache;" > /dev/null 2>&1
  echo "  Cache flushed"

  # 4. Kill any running services
  pkill -f "tsx backend/src/index.ts" 2>/dev/null || true
  pkill -f "tsx ai-worker/src/index.ts" 2>/dev/null || true
  sleep 2

  # 5. Start services
  export $(grep -v '^#' backend/.env | xargs)
  nohup npx tsx backend/src/index.ts > /tmp/backend.log 2>&1 &
  BACKEND_PID=$!

  (export $(grep -v '^#' ai-worker/.env | xargs) && export PORT=3002 && nohup npx tsx ai-worker/src/index.ts > /tmp/ai-worker.log 2>&1 &)

  echo "  Waiting for services..."
  sleep 6

  # Verify services
  if ! lsof -i :3000 -sTCP:LISTEN > /dev/null 2>&1; then
    echo "  ERROR: Backend not ready. Check /tmp/backend.log"
    cat /tmp/backend.log | tail -20
    exit 1
  fi
  if ! lsof -i :3002 -sTCP:LISTEN > /dev/null 2>&1; then
    echo "  ERROR: AI Worker not ready. Check /tmp/ai-worker.log"
    cat /tmp/ai-worker.log | tail -20
    exit 1
  fi
  echo "  Services ready"

  # 6. Get token and run eval
  ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

  echo "  Running eval..."
  ADMIN_TOKEN="$ADMIN_TOKEN" npx tsx scripts/playground-eval.ts 2>&1 | tee "$RESULTS_DIR/$MODEL.txt"

  # 7. Kill services
  pkill -f "tsx backend/src/index.ts" 2>/dev/null || true
  pkill -f "tsx ai-worker/src/index.ts" 2>/dev/null || true
  sleep 2
done

# Restore original model
sed -i '' "s/export const DEFAULT_AI_MODEL = '.*'/export const DEFAULT_AI_MODEL = 'gpt-4.1-mini'/" "$SHARED_FILE"
cd packages/shared && npm run build > /dev/null 2>&1 && cd ../..
echo ""
echo "  Restored DEFAULT_AI_MODEL to gpt-4.1-mini"

# Print comparison
echo ""
echo "============================================================"
echo "  COMPARISON SUMMARY"
echo "============================================================"
for MODEL in "${MODELS[@]}"; do
  echo ""
  echo "--- $MODEL ---"
  grep -E "TOTAL:|SCORE:|AVG LATENCY:" "$RESULTS_DIR/$MODEL.txt" || echo "  (no results)"
done
