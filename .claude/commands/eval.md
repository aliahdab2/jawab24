Run the Jawab24 AI reply quality evaluation (125 test cases).

Arguments: $ARGUMENTS
- If arguments include a number (e.g. "category 3"), set CATEGORY=<number>
- If arguments include "verbose", set VERBOSE=1
- If arguments include a concurrency number, set CONCURRENCY=<number>

Prerequisites — check if ports 3000 and 3002 are already listening. If not, start them automatically (do NOT ask the user):

```bash
# Check and start backend (source env from backend/.env)
# D-111: the content-free gate ships in SHADOW mode (answers as before, only counts).
# The eval pins the ENFORCE behaviour — cases flagged `requiresGateEnforce` are scored
# only when this env is `enforce` on BOTH the backend and the eval process; otherwise
# the harness reports them in the XGAP bucket instead of failing the headline number.
export COMMENT_CTA_GATE_MODE=enforce
if ! lsof -i :3000 -sTCP:LISTEN >/dev/null 2>&1; then
  cd /Users/aliahdab/Documents/AutoReply
  export $(grep -v '^#' backend/.env | xargs)
  nohup npx tsx backend/src/index.ts > /tmp/backend.log 2>&1 &
  sleep 5
fi

# Check and start AI worker (source env from ai-worker/.env)
if ! lsof -i :3002 -sTCP:LISTEN >/dev/null 2>&1; then
  cd /Users/aliahdab/Documents/AutoReply
  export $(grep -v '^#' ai-worker/.env | xargs)
  export PORT=3002
  nohup npx tsx ai-worker/src/index.ts > /tmp/ai-worker.log 2>&1 &
  sleep 3
fi
```

IMPORTANT:
- NEVER ask the user for OPENAI_API_KEY — it is in `ai-worker/.env`
- NEVER ask for confirmation to start services — just start them
- If demo auth returns empty token, check `/tmp/backend.log` — usually a missing DB column. Fix with psql against `postgres://aliahdab@localhost:5432/postgres`

Then get the admin token, clear the AI cache, and run the eval:
```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# Clear AI cache so eval reflects the current prompt, not stale cached responses
curl -s -X DELETE http://localhost:3000/ai/cache -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null

ADMIN_TOKEN="$ADMIN_TOKEN" VERBOSE=1 npm run eval
```

After the eval completes:
- Kill the background services: `pkill -f "tsx backend/src/index.ts"; pkill -f "tsx ai-worker/src/index.ts"`
- Summarize: overall pass rate, which categories failed (if any), patterns in failures

Reliability & determinism notes:
- The script retries transient 429/5xx with backoff and prints a `TRANSIENT RETRIES`
  count in the summary. If that count is high, the run was rate-limited — re-run with
  a lower CONCURRENCY (1-3). Never interpret rate-limit noise as reply regressions.
- Scores are noisy run-to-run (±5 PARTIALs is normal): the model samples at
  OPENAI_TEMPERATURE=0.5 and the graders check stochastic outputs (confidence,
  intent, flags, substrings). A single run is a coarse gate, not a precise measure.
- For A/B REGRESSION comparisons (branch vs main, feature flag on vs off), start the
  AI worker with `OPENAI_TEMPERATURE=0 OPENAI_TOP_P=1` for BOTH runs to minimize
  sampling variance, and clear the AI cache before each run. Temp-0 scores are only
  comparable to other temp-0 scores — not to the historical temp-0.5 baseline.
