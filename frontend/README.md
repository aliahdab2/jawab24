# Jawab24 Frontend

Web dashboard for Jawab24 - part of the monorepo.

## Tech Stack

- **Framework:** Next.js 13
- **Language:** TypeScript
- **Styling:** TailwindCSS
- **State:** Zustand
- **Data Fetching:** TanStack Query

## Structure

```
frontend/
├── src/
│   ├── pages/         # Next.js pages
│   │   ├── dashboard.tsx
│   │   ├── comments.tsx
│   │   ├── messages.tsx
│   │   ├── templates.tsx
│   │   ├── rules.tsx
│   │   ├── pages.tsx
│   │   ├── settings.tsx
│   │   └── login.tsx
│   ├── components/
│   │   ├── layout/    # DashboardLayout, etc.
│   │   ├── ui/        # Reusable UI components
│   │   └── ErrorBoundary.tsx
│   ├── lib/           # Utilities and stores
│   ├── i18n/          # Internationalization (ar/en)
│   └── styles/        # Global CSS
├── public/            # Static assets
└── Dockerfile         # Production container
```

## Features

- 📊 **Dashboard** - Overview stats and recent activity
- 💬 **Comments** - View and manage comment replies
- 📨 **Messages** - View and manage DM replies
- 📝 **Templates** - Create bilingual reply templates
- ⚡ **Rules** - Set up keyword-based automation
- 📄 **Pages** - Manage connected Facebook pages
- ⚙️ **Settings** - Configure auto-reply behavior
- 🌐 **Bilingual** - Full Arabic/English support with RTL
- 📱 **Responsive** - Mobile-optimized with safe area support
- 🛡️ **Error Boundary** - Graceful error handling

## Development

```bash
# From project root (recommended)
npm install                              # Install all dependencies
npm run build --workspace=@jawab24/shared  # Build shared types first
npm run dev --workspace=jawab24-frontend   # Start dev server

# Or from this directory
npm run dev
```

The app will be available at http://localhost:3001

## Shared Types

This package uses types from `@jawab24/shared`:

```typescript
import type { Message, Comment, Page, Template, Rule } from '@jawab24/shared';
```

## Internationalization

The dashboard supports Arabic and English:

```
src/i18n/
├── locales/
│   ├── ar.json    # Arabic translations
│   └── en.json    # English translations
└── index.ts       # i18n configuration
```

Usage in components:
```typescript
import { useTranslation } from '@/i18n';

const { t, language } = useTranslation();
const isRTL = language === 'ar';
```

## Production

```bash
npm run build
npm start
```

## Environment Variables

Required in `env/frontend.env`:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API URL |
| `NEXT_PUBLIC_FB_APP_ID` | Facebook App ID |

## Docker

```bash
# Build image (from project root)
docker build -t jawab24-frontend -f frontend/Dockerfile .

# Run container
docker run -p 3001:3001 jawab24-frontend
```

## Mobile Support

The frontend is fully responsive with:
- Bottom navigation for mobile
- Safe area support for notched devices
- Touch-optimized interactions
- Responsive grids and layouts
