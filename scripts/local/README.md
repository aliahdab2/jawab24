# Local battery — الفريق الدمشقي, on the demo page

A measurement you cannot re-run is not a measurement, so the exact procedure lives here
rather than in a chat log. Everything runs against a throwaway local database and the
DEMO page — the merchant's real page is never touched.

## Why it exists

The reply-path guards added in this branch (`date_not_in_source`, `stale_date`,
`directive_ignored`) were measured two ways:

1. **Offline replay** on 224 real production replies — the guards' precision on real
   traffic, no servers, no cost. Result: caught the one real defect
   («دورة التصوير تبدأ 7/5/2026»), **zero false positives**.
2. **This battery** — live generation at production sampling through the production
   choke point (`/admin/ai/playground` with `source: 'eval'`, which bypasses every
   cache), on questions taken **verbatim from his production inbox**.

Inventing the questions ourselves is the weakness this whole effort exists to avoid: the
headline "35.4% → 7%" number that steered the plan for weeks came from a fixture, not
from production.

## Setup (once)

```bash
createdb jawab24_verbatim_test
cd backend && DATABASE_URL=postgresql://$USER@localhost:5432/jawab24_verbatim_test npx drizzle-kit push --force
DATABASE_URL=... npx tsx src/scripts/seed-plans.ts
```

`backend/.env` in this worktree holds only DUMMY credentials plus the local DATABASE_URL
— the two routes the battery uses (`/auth/demo`, `/admin/ai/playground`) never reach
Facebook or Stripe. The one real secret, `OPENAI_API_KEY`, is loaded by
`start-aiworker.sh` from the main checkout's `ai-worker/.env` and never printed.

## Run

```bash
cd backend && npm run dev &                 # :3100, this worktree's code
./scripts/local/start-aiworker.sh &         # :3005, this worktree's code
curl -s -XPOST localhost:3100/auth/demo -H 'Content-Type: application/json' -d '{}' > /tmp/demo.json
# one-time: the demo user needs platform admin for the playground route
psql -d jawab24_verbatim_test -c "UPDATE users SET is_admin=true WHERE email='demo@jawab24.com';"
REPS=2 ./scripts/local/battery-damascus.sh
```

## Traps already paid for

- `AI_SERVICE_URL` (not `AI_WORKER_URL`) points the backend at the worker; it defaults
  to `:3002`, so a worktree on another port silently talks to whatever is there.
- `DEMO_MODE_ENABLED=true` is required or `/auth/demo` 404s.
- `AI_ENABLED=true` is required or the playground 500s with `AiUnavailableError`.
- `ts-node-dev` watches source, not `.env` — restart the backend after editing it.
- The demo user is not an admin by default; the playground route 403s until it is.
