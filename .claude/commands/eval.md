Run the Jawab24 AI reply quality evaluation (98 test cases).

Arguments: $ARGUMENTS
- If arguments include a number (e.g. "category 3"), set CATEGORY=<number>
- If arguments include "verbose", set VERBOSE=1
- If arguments include a concurrency number, set CONCURRENCY=<number>

Prerequisites — check if these are already running before starting them:
1. Backend on port 3000
2. AI worker on port 3002

If not running, start them in separate terminals:
```bash
# Terminal 1 - Backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/autoreply" npx tsx backend/src/index.ts

# Terminal 2 - AI worker (ask user for OPENAI_API_KEY if not set in env)
PORT=3002 OPENAI_API_KEY="$OPENAI_API_KEY" npx tsx ai-worker/src/index.ts
```

Then get the admin token and run the eval:
```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
ADMIN_TOKEN="$ADMIN_TOKEN" npm run eval
```

After the eval completes, summarize:
- Overall pass rate
- Which categories failed (if any)
- Any patterns in failures worth noting
