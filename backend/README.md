# Jawab24 Backend

Backend API service for Jawab24 - part of the monorepo.

## Structure

```
/src
  /routes       - API route definitions
  /controllers  - Request handlers
  /services     - Business logic
  /ai           - AI integration
  /rules        - Rules engine
  /db           - Database schema & migrations
  /utils        - Helper functions
/drizzle        - Generated SQL migrations
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
import { Message, Comment, Page } from '@jawab24/shared';
```

## Production

```bash
npm run build
npm start
```

## Testing

```bash
npm test
```
