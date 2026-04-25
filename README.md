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
- Configure Post Replies — per-post keyword triggers that send a DM instantly
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

More details in [Deployment Guide](./docs/deployment.md).

### Versioning (tags-first)
- Human version comes from the latest git tag (e.g., `v2.4.1`). If no tag, shows `untagged`.
- Deploy script passes both the tag (`SEMANTIC_VERSION`) and the commit hash (`GIT_COMMIT`) into the images.
- Frontend displays the tag (`NEXT_PUBLIC_APP_VERSION`); backend `/api/version` still returns the commit hash for traceability.
- Release flow: create/push an annotated tag before deploy:
  ```bash
  git tag -a v2.4.1 -m "Release v2.4.1"
  git push --tags
  ```

---

## Environment variables

⚠️ **CRITICAL**: Missing or incorrect environment variables will cause production failures. The deployment pipeline validates all required variables before deploying.

### Required Variables

Copy the `.env.example` files and fill them in:

#### `env/db.env` (Database)
```bash
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=jawab24
```

#### `env/backend.env` (Backend API)
```bash
# Database - MUST use postgresql:// protocol
DATABASE_URL=postgresql://postgres:your_password@postgres:5432/jawab24

# JWT - MUST be 32+ characters
JWT_SECRET=generate_a_long_random_string_here

# Facebook App Credentials (from developers.facebook.com)
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_REDIRECT_URI=https://your-domain.com/auth/callback
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_webhook_token

# Stripe (optional for payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Frontend URL
FRONTEND_URL=https://your-domain.com
```

#### `env/ai.env` (AI Worker)
```bash
OPENAI_API_KEY=sk-proj-...
```

#### `env/frontend.env` (Frontend)
```bash
NEXT_PUBLIC_API_URL=https://your-domain.com/api
NEXT_PUBLIC_FB_APP_ID=your_facebook_app_id
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable_key
```

### GitHub Secrets

For CI/CD, add these to **Repository Settings → Secrets → Actions**:

- `SERVER_SSH_KEY` — SSH private key for deployment server
- `FACEBOOK_APP_ID` — For build-time embedding

### Validation

Before deploying, run:
```bash
./scripts/check-env.sh
```

This validates all required variables are set correctly.

---

## Testing

```bash
# Run all tests
cd backend && npm test

# Run tests with coverage report
cd backend && npm run test:coverage
```

There are 570+ tests (unit + integration) covering the backend. They run on every push. Coverage reports are generated with V8 via `vitest` and output to `backend/coverage/`.

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

### Integrations
- [Stripe](./docs/integrations/stripe.md)
- [Facebook](./docs/integrations/facebook.md)
- [Instagram](./docs/integrations/instagram.md)

### Technical
- [Architecture](./docs/technical/architecture.md)
- [API Reference](./docs/technical/api.md)
- [Database Schema](./docs/technical/schema.md)
- [Internationalization](./docs/technical/i18n.md)

### Operations
- [Deployment](./docs/deployment.md)
- [Roadmap](./docs/roadmap.md)

---

## Contributing

Fork it, make a branch, open a PR. Standard stuff.

---

## License

MIT
