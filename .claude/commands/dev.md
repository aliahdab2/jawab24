Start the Jawab24 local development environment (backend + AI worker + frontend).

Arguments: $ARGUMENTS
- If arguments include "backend" or "be", start only the backend
- If arguments include "ai" or "worker", start only the AI worker
- If arguments include "frontend" or "fe", start only the frontend
- If arguments include "no-frontend" or "no-fe", start backend + AI worker only
- Default (no arguments): start all three services

Prerequisites:
1. PostgreSQL must be running on port 5433 (Docker: `docker compose up -d db`)
2. Each service has a `.env` file with secrets (`backend/.env`, `ai-worker/.env`)

Steps:

1. **Check which services are already running** before starting anything:
```bash
curl -s http://localhost:3000/health 2>/dev/null && echo "Backend: UP" || echo "Backend: DOWN"
curl -s http://localhost:3002/health 2>/dev/null && echo "AI Worker: UP" || echo "AI Worker: DOWN"
curl -s http://localhost:3001 2>/dev/null && echo "Frontend: UP" || echo "Frontend: DOWN"
```

2. **Start services that are down** (skip any that are already running):

Backend (port 3000) — run from the `backend/` directory so dotenv picks up `backend/.env`:
```bash
cd backend && npx tsx src/index.ts
```

AI Worker (port 3002) — run from the `ai-worker/` directory so dotenv picks up `ai-worker/.env`:
```bash
cd ai-worker && npx tsx src/index.ts
```

Frontend (port 3001):
```bash
cd frontend && npm run dev
```

Start each service in the background using `run_in_background`. Do NOT use `&` — use the Bash tool's `run_in_background` parameter instead.

3. **Wait ~5 seconds**, then health-check each started service to confirm it's running.

4. **Report** which services are running and on which ports:
- Backend: http://localhost:3000
- AI Worker: http://localhost:3002
- Frontend: http://localhost:3001

If any service fails to start, show the last 20 lines of its log output so the user can diagnose the issue.
