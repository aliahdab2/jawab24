# Jawab24

**Auto-reply to Facebook comments and messages, so you don't have to.**

Running a Facebook page means answering the same questions over and over. "What's the price?" "Do you deliver?" "Are you open today?" Jawab24 handles these automatically, 24/7, in any language.

**Try it:** [jawab24.com](https://jawab24.com)

---

## What it does

Connect your Facebook page, tell it about your business (products, prices, policies), and it replies to comments and DMs for you. It uses GPT-4o-mini under the hood, so replies actually make sense — not just canned responses.

**Works with:**
- Public comments on posts
- Private messages (DMs)
- Multiple languages (Arabic, English, Swedish, etc. — auto-detected)

**You can also:**
- Set business hours (no replies at 3am if you don't want)
- Create template replies for common questions
- See conversation history with each customer
- Export everything as CSV
- Get notified when someone needs human help

---

## Getting started

You'll need Node.js 18+, Docker, a Facebook Developer account, and an OpenAI API key.

```bash
git clone https://github.com/aliahdab2/jawab24.git
cd jawab24
npm install

# Copy the example env files and add your credentials
cp env/backend.env.example env/backend.env
cp env/frontend.env.example env/frontend.env
cp env/ai.env.example env/ai.env
cp env/db.env.example env/db.env

# Start everything
docker-compose up -d
```

Open `http://localhost:3001` and you're good to go.

---

## How it works

```
Facebook comment/message
        ↓
    Webhook hits backend
        ↓
    Check if there's a matching template
        ↓
    No match? Send to AI worker
        ↓
    AI generates reply using your business info
        ↓
    Reply posted back to Facebook
```

The whole thing runs on:
- **Frontend:** Next.js dashboard for managing everything
- **Backend:** Fastify API that handles webhooks and business logic
- **AI Worker:** Separate service that talks to OpenAI (keeps things fast)
- **PostgreSQL** for data, **Redis** for queues
- **Nginx** in front for SSL and routing

---

## Project structure

It's a monorepo with npm workspaces:

```
jawab24/
├── backend/          # API server (Fastify)
├── frontend/         # Dashboard (Next.js)
├── ai-worker/        # OpenAI integration
├── packages/shared/  # Shared TypeScript types
├── nginx/            # Reverse proxy config
├── scripts/          # Deployment scripts
└── env/              # Environment files (not committed)
```

---

## Deployment

Push to `main` and GitHub Actions handles the rest. It uses blue-green deployment, so there's no downtime — the new version spins up, gets health-checked, then traffic switches over instantly.

```bash
# Check what's running
./scripts/deploy-blue-green.sh status

# Manual deploy if needed
./scripts/deploy-blue-green.sh deploy

# Something wrong? Roll back in seconds
./scripts/deploy-blue-green.sh rollback
```

More details in [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Environment variables

Don't commit real credentials. Copy the `.env.example` files and fill them in:

- `db.env` — Postgres password
- `backend.env` — Database URL, JWT secret, Facebook app credentials
- `ai.env` — OpenAI API key
- `frontend.env` — Facebook App ID (public)

For GitHub Actions, add `SERVER_SSH_KEY` as a repository secret.

---

## Testing

```bash
npm test
```

There are ~95 tests covering the backend. They run on every push.

---

## Tech stack

- Next.js, React, TailwindCSS (frontend)
- Fastify, TypeScript (backend)
- PostgreSQL, Drizzle ORM (database)
- Redis (queues)
- OpenAI GPT-4o-mini (AI)
- Docker, Nginx, GitHub Actions (infra)

---

## Docs

- [Deployment Guide](./DEPLOYMENT.md)
- [Facebook Setup](./FACEBOOK_SETUP.md)
- [API Spec](./API_SPEC.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [Language Support](./LANGUAGE_SUPPORT.md)
- [Technical Roadmap](./ROADMAP.md)

---

## Contributing

Fork it, make a branch, open a PR. Standard stuff.

---

## License

MIT
