Start the Jawab24 local Shopify dev environment (ngrok tunnel + backend + frontend).

Use this when you need to test Shopify integration locally — OAuth connect flow or integration tests.

Arguments: $ARGUMENTS
- If arguments include "test", skip environment setup and run integration tests + eval immediately (assumes backend is already running)
- If arguments include "reconnect", remind user to update Shopify Partners redirect URL with new ngrok URL
- Default: start everything and print connect instructions

## One-time setup (only needed once per machine)
- ngrok authtoken saved in `~/.config/ngrok/ngrok.yml` — if missing, find it at `dashboard.ngrok.com/get-started/your-authtoken` and run `ngrok config add-authtoken <token>`
- All Shopify credentials are in `backend/.env` (gitignored) — read them from there at runtime, never hardcode in this file
- Dev store: user's Shopify development store at `*.myshopify.com` (create at partners.shopify.com → Stores → Create store → Development store)

## Steps

### 1. Kill existing backend + ngrok
```bash
pkill -f "ngrok http 3000" 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1
```

### 2. Start ngrok tunnel on port 3000
Run in background:
```bash
ngrok http 3000 --log=stdout
```
Wait up to 10 seconds for tunnel to be ready, then get the public URL:
```bash
curl -s http://localhost:4040/api/tunnels | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; [print(x['public_url']) for x in t if 'https' in x['public_url']]"
```
If this fails, tell the user to run `ngrok config add-authtoken <token>` and check `dashboard.ngrok.com`.

### 3. Update SHOPIFY_HOST_NAME in backend/.env
Extract just the hostname (no https://):
```bash
sed -i '' "s|^SHOPIFY_HOST_NAME=.*|SHOPIFY_HOST_NAME=<ngrok-hostname>|" backend/.env
```

### 4. Start backend with updated env
Run from the repo root in background — load `backend/.env` explicitly:
```bash
cd backend && npx tsx src/index.ts
```
Wait up to 15 seconds, then verify:
```bash
curl -s http://localhost:3000/health
```

**IMPORTANT**: If you restart the backend after ngrok is running, ngrok will show "ERR_NGROK_3200 (tunnel endpoint offline)". You must also restart ngrok when restarting the backend.

### 5. Start frontend (if not already running)
```bash
curl -s http://localhost:3001 > /dev/null 2>&1 || (cd frontend && npm run dev)
```

### 6. Get admin token (for running tests)
```bash
curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))"
```

**IMPORTANT**: `POST /auth/demo` reseeds ALL demo data (e-commerce stores, KB chunks, messages, rules). Call it ONCE per session and reuse the token. Calling it again wipes and recreates everything.

### 7. Report status and next steps

Print a clear summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Shopify dev environment ready

  ngrok URL: https://<hostname>

  ⚠️  If ngrok URL changed from last session, update
     redirect URL in Shopify Partners → Jawab24-Dev app:
     https://<hostname>/shopify/auth/callback

  Connect your dev store (OAuth):
  → http://localhost:3001/en/integrations

  Run integration tests:
  → ADMIN_TOKEN=<token> npm run test:ecommerce:shopify

  Run e-commerce eval tests:
  → ADMIN_TOKEN=<token> CATEGORY=13 VERBOSE=1 npm run eval
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If arguments include "test", run tests automatically (see "Running tests" section below).

## Running tests (when arguments include "test")

Skip steps 1-5 (ngrok + frontend). But DO ensure backend and AI worker are running:

1. Check if backend is healthy: `curl -s http://localhost:3000/health`
   If NOT running, start it:
   ```bash
   export $(grep -v '^#' backend/.env | xargs) && nohup npx tsx backend/src/index.ts > /tmp/backend.log 2>&1 &
   ```
   Wait up to 15 seconds, then verify health again. If still not healthy, check `/tmp/backend.log` for errors.

2. Check if AI worker is healthy: `curl -s http://localhost:3002/health`
   If NOT running, start it:
   ```bash
   export $(grep -v '^#' ai-worker/.env | xargs) && export PORT=3002 && nohup npx tsx ai-worker/src/index.ts > /tmp/ai-worker.log 2>&1 &
   ```
   Wait up to 10 seconds, then verify health again. If still not healthy, check `/tmp/ai-worker.log` for errors (usually missing OPENAI_API_KEY).

3. Get admin token — call `POST /auth/demo` ONCE:
   ```bash
   curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))"
   ```
   **IMPORTANT**: This reseeds ALL demo data. Call ONCE and reuse the token.

4. Clear AI caches before eval:
   ```bash
   psql "postgres://aliahdab@localhost:5432/postgres" -c "DELETE FROM ai_cache; DELETE FROM semantic_cache;" 2>/dev/null || true
   ```

5. Run integration test:
   ```bash
   ADMIN_TOKEN=<token> PLATFORM=shopify npx tsx scripts/ecommerce-integration-test.ts
   ```

6. If AI worker is running (verified in step 2), also run e-commerce eval:
   ```bash
   ADMIN_TOKEN=<token> CATEGORY=13 VERBOSE=1 npx tsx scripts/playground-eval.ts
   ```
   If AI worker failed to start, skip eval and tell the user:
   "AI worker not running on port 3002 — skipping eval tests. Check `/tmp/ai-worker.log` for errors."

7. Report results summary (pass/fail counts for both test suites)

## Troubleshooting (common issues from past sessions)

### "geoip.lookup is not a function"
- Dynamic import of `geoip-lite` returns module with `.default` export
- Already fixed in `backend/src/middleware/geo.ts` — if it reappears, check the import pattern

### ngrok ERR_NGROK_3200 (tunnel endpoint offline)
- Happens when backend restarts but ngrok keeps running
- Fix: restart ngrok too, then update `SHOPIFY_HOST_NAME` in `backend/.env`

### OAuth redirects to login page with `?shopify_pending=true`
- This is EXPECTED when installing from Shopify Partners (user not logged into Jawab24)
- The store is saved as "pending install" and gets claimed on next login
- For testing: it's easier to connect via the integrations page while already logged in at `http://localhost:3001/en/integrations`

### Cookie cross-domain issues during OAuth
- OAuth starts at `localhost:3000` but Shopify callback comes through ngrok domain
- Cookies set on localhost don't carry to ngrok domain
- This affects `pendingShopifyId` cookie flow
- Workaround: use demo mode (`POST /auth/demo`) which seeds a pre-connected store — no OAuth needed for tests

### Demo mode wipes real connected store
- `POST /auth/demo` deletes and recreates demo e-commerce stores every time
- If you connected a real dev store via OAuth, calling `/auth/demo` will overwrite it with demo data
- Workaround: get token once, don't call `/auth/demo` again in the same session

### Integration test says "no store connected"
- Demo store is seeded automatically by `POST /auth/demo`
- If the store has no products, it means KB ingestion hasn't completed — wait a few seconds and retry
- Check backend logs for ingestion errors

### Eval test fails due to template rule conflict
- Demo workspace has template rules with keywords like "سعر" that catch questions before AI/RAG runs
- Test messages must avoid triggering template keywords
- If adding new eval tests about products, check demo rules first:
  ```sql
  SELECT name, keywords FROM rules WHERE user_id IN (SELECT id FROM users WHERE email='demo@jawab24.com');
  ```

### KB chunks duplicating (hundreds of rows per page)
- Fixed in `pgvector-store.ts` — `upsertChunks` now deletes old chunks before inserting
- If you see >100 chunks per page, check: `SELECT COUNT(*), page_id FROM kb_chunks GROUP BY page_id;`

## What the tests cover

### Integration test (`scripts/ecommerce-integration-test.ts`)
Tests against demo-seeded data (no real Shopify API calls):
- Store connection status (GET /shopify/store)
- Product sync trigger (POST /shopify/store/sync)
- Product data returned (GET /shopify/store/products)
- Product data quality (required fields present)
- Store info consistency (productCount matches actual)
- Page linking / unlinking
- KB enrichment (AI reply includes product data)

### Eval Category 13 (`scripts/playground-eval.ts`, 19 tests)
Tests AI reply quality with e-commerce context:
- Shopify (8 tests): warranty, shipping, return policy, product catalog, variants, payment methods, product not found
- Salla (11 tests): same patterns for Salla stores (require "fashion" demo page — only available when Salla is configured)

### Automated tests (run in CI, no manual setup needed)
- 16+ unit test files for Shopify services, controllers, routes, crypto
- `frontend/e2e/integrations.spec.ts` — UI states with mocked APIs
- See "Testing Strategy" section in `AI_INSTRUCTIONS.md` for full list

## Important notes
- ngrok URL changes every session on the free plan — if you need to re-do OAuth (reconnect the store), update the redirect URL in Shopify Partners → Jawab24-Dev → Versions → Create version
- Once a store is connected (OAuth done), the token is stored in the local DB — integration tests work without re-doing OAuth
- To switch back to production credentials after testing: restore `SHOPIFY_API_KEY=93c86e8524610bbf5353d5fc5ce27eca`, `SHOPIFY_API_SECRET=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`, `SHOPIFY_HOST_NAME=jawab24.com` in `backend/.env`
