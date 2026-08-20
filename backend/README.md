# Jawab24 Backend

Backend API service for Jawab24 - part of the monorepo.

## Tech Stack

- **Runtime:** Node.js 22+
- **Framework:** Fastify
- **Language:** TypeScript
- **Database:** PostgreSQL 15 + Drizzle ORM
- **Cache:** Redis 7

## Structure

```
backend/
├── src/
│   ├── controllers/   # Request handlers
│   ├── services/      # Business logic (45+ root files)
│   ├── routes/        # API route definitions (31 files)
│   ├── db/            # Database schema & connection
│   ├── middleware/    # Auth, CSRF, rate-limit, workspace isolation
│   ├── integrations/  # Shopify, Salla, Zid adapters
│   ├── utils/         # Helpers, email templates, i18n
│   └── types/         # TypeScript types
├── test/              # 189 test files
├── migrations/        # 81 SQL migration files
└── Dockerfile         # Production container
```

## Development

```bash
# From project root (recommended)
npm install                              # Install all dependencies
npm run build --workspace=@jawab24/shared  # Build shared types first
npm run dev --workspace=jawab24-backend    # Start dev server

# Or from this directory
npm run dev
```

## Database

Uses PostgreSQL with Drizzle ORM.

```bash
# Generate migration after schema changes
npm run generate

# Push schema directly (dev only)
npm run migrate

# Run migrations (production)
npm run deploy:migrate
```

## Shared Types

This package uses types from `@jawab24/shared`:

```typescript
import type { Message, Comment, Page, Template, Rule } from '@jawab24/shared';
```

## API Endpoints

**31 route files** covering auth, pages, comments, messages, settings, templates, rules, payments, integrations, admin, waitlist, leads, analytics, subscriptions, notifications, voice, health, SSE, and more.

Key endpoint groups:

| Group | Endpoints | Description |
|-------|-----------|-------------|
| Auth | `/auth/*` | Facebook OAuth, phone OTP, account linking |
| Pages | `/pages/*` | Connected pages, sync, KB gaps |
| Comments | `/comments/*` | Comment listing, resolution, escalation |
| Messages | `/messages/*` | DM listing, media attachments |
| Settings | `/settings/*` | Workspace settings, business hours, reply style |
| Payment | `/payment/*` | Stripe checkout, subscriptions, billing portal, webhooks |
| Webhook | `/webhook` | Facebook/Instagram/WhatsApp incoming events |
| Admin | `/admin/*` | Admin dashboard, playground, waitlist management |
| E-commerce | `/shopify/*`, `/salla/*`, `/zid/*` | Store connect, product sync |
| Leads | `/leads/*` | AI-powered lead extraction |
| Health | `/health` | Health check, metrics, cleanup |

See `docs/technical/api.md` for detailed endpoint documentation.

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- test/services/reply.test.ts
```

**Current Status:** 189 test files ✅

## Production

```bash
npm run build
npm start
```

## Environment Variables

Required in `env/backend.env`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing secret |
| `FACEBOOK_APP_ID` | Facebook App ID |
| `FACEBOOK_APP_SECRET` | Facebook App Secret |
| `FACEBOOK_WEBHOOK_VERIFY_TOKEN` | Webhook verification token |
| `AI_SERVICE_URL` | AI Worker URL (default: http://ai-worker:3002) |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint secret |
| `RESEND_API_KEY` | Resend email API key |
| `RESEND_REPLY_TO` | Reply-To header and the address printed in every email footer. Unset → both fall back to `RESEND_FROM_EMAIL` |
| `SHOPIFY_API_KEY` | Shopify app API key |
| `SHOPIFY_API_SECRET` | Shopify app secret |
| `SALLA_CLIENT_ID` | Salla OAuth client ID |
| `ZID_API_KEY` | Zid integration API key |

## Docker

```bash
# Build image
docker build -t jawab24-backend -f Dockerfile ..

# Run container
docker run -p 3000:3000 --env-file ../env/backend.env jawab24-backend
```
