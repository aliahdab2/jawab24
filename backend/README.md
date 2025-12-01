# Jawab24 Backend

Backend API service for Jawab24 - part of the monorepo.

## Tech Stack

- **Runtime:** Node.js 18
- **Framework:** Fastify
- **Language:** TypeScript
- **Database:** PostgreSQL 15 + Drizzle ORM
- **Cache:** Redis 7

## Structure

```
backend/
├── src/
│   ├── controllers/   # Request handlers
│   ├── services/      # Business logic
│   ├── routes/        # API route definitions
│   ├── db/            # Database schema & connection
│   ├── middleware/    # Auth middleware
│   └── types/         # TypeScript types
├── test/              # 95 test files
├── migrations/        # SQL migration files
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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/auth/facebook` | Facebook OAuth login |
| GET | `/pages` | List connected pages |
| POST | `/pages/sync` | Sync pages from Facebook |
| GET | `/templates` | List templates |
| POST | `/templates` | Create template |
| GET | `/rules` | List rules |
| POST | `/rules` | Create rule |
| GET | `/comments` | List comments |
| GET | `/messages` | List messages |
| GET | `/settings` | Get user settings |
| PUT | `/settings` | Update settings |
| GET/POST | `/webhook` | Facebook webhooks |

See [API_SPEC.md](../API_SPEC.md) for full documentation.

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- test/services/reply.test.ts
```

**Current Status:** 95 tests passing ✅

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

## Docker

```bash
# Build image
docker build -t jawab24-backend -f Dockerfile ..

# Run container
docker run -p 3000:3000 --env-file ../env/backend.env jawab24-backend
```
