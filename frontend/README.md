# Jawab24 Frontend

Web dashboard for Jawab24 - part of the monorepo.

## Structure

```
/src
  /pages       - Next.js pages
  /components  - React components
  /lib         - Utilities and stores
  /i18n        - Internationalization
```

## Development

```bash
# From project root (recommended)
npm install                              # Install all dependencies
npm run build --workspace=@jawab24/shared  # Build shared types first
npm run dev --workspace=jawab24-frontend   # Start dev server

# Or from this directory
npm run dev
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

## Environment Variables

Required in `env/frontend.env`:
- `NEXT_PUBLIC_API_URL` - Backend API URL
- `NEXT_PUBLIC_FACEBOOK_APP_ID` - Facebook App ID
