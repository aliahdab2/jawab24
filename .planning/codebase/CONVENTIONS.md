# Code Conventions — Jawab24 Codebase

This document describes the coding patterns, naming conventions, and architectural decisions used across the Jawab24 monorepo (frontend, backend, ai-worker, packages/shared).

---

## TypeScript Patterns

### Strict Mode & Type Safety
- **Strict mode enabled** on all packages (`strict: true` in tsconfig.json)
  - Frontend: `frontend/tsconfig.json`
  - Backend: `backend/tsconfig.json`
  - AI Worker: `ai-worker/tsconfig.json`
  - Shared: `packages/shared/tsconfig.json`
- **No `any` policy**: Every variable and parameter must have a proper type
- **Generic constraints** used for type-safe abstractions
- **Union types** preferred over optional booleans

### Interface Patterns
```typescript
// Service DTO interfaces — define request/response shapes
interface CreateMessageDTO {
  pageId: string;
  facebookMessageId: string;
  senderId: string;
  senderName?: string;
  message: string;
  direction?: 'incoming' | 'outgoing';
}

// Component prop interfaces with optional props clearly marked
interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

// Type union for discriminated unions
type DbConn = typeof db;  // Reusable DB connection type for transaction support
```

### Generics in API Responses
```typescript
// Type-safe API responses with generics
api.get<CommentsPaginatedResponse>('/comments', { params })
api.get<CommentStats>('/comments/stats')
```

---

## Naming Conventions

### Files & Folders

**Components:**
- PascalCase: `Card.tsx`, `Button.tsx`, `CommentDetailModal.tsx`
- Organized by feature: `frontend/src/components/<feature>/`
- UI components: `frontend/src/components/ui/`
- Shared layout components: `frontend/src/components/layout/`

**Hooks:**
- camelCase with `use` prefix: `useAiGeneration.ts`, `useBodyScrollLock.ts`, `useTheme.ts`
- Location: `frontend/src/hooks/`
- Barrel export: `frontend/src/hooks/index.ts`

**Services:**
- camelCase: `messages.ts`, `comments.ts`, `templates.ts`
- Location: `backend/src/services/`
- Export as singleton: `export const messagesService = new MessagesService()`

**Controllers:**
- camelCase: `messages.ts`, `comments.ts`
- Location: `backend/src/controllers/`
- Class-based (not functions): `export class MessagesController { ... }`

**Routes:**
- camelCase: `messages.ts`, `auth.ts`
- Location: `backend/src/routes/`
- Default export: `export default async function(fastify: FastifyInstance) { ... }`

**Utilities & Helpers:**
- camelCase: `axiosRetry.ts`, `sentryHelpers.ts`, `formatDuration.ts`
- Location: `frontend/src/lib/` or `backend/src/lib/`

**Types & Interfaces:**
- File: `types/` folder or co-located in feature
- PascalCase: `Message`, `Comment`, `WorkspaceSummary`
- File: `types.ts` (feature-scoped) or `types/<domain>.ts` (global)

**Tests:**
- Suffix: `.test.ts` or `.spec.ts`
- Location: same folder as source file or `test/` folder
- E2E: `e2e/<feature>.spec.ts`

### Variables & Constants

**Constants:**
- SCREAMING_SNAKE_CASE: `DEFAULT_HANDOFF_PAUSE_MINUTES`, `MAX_MESSAGE_LENGTH`

**Booleans:**
- Prefix with `is`, `has`, `can`: `isGenerating`, `hasHydrated`, `canDelete`
- Avoid: `active` → use `isActive`, `enabled` → use `isEnabled`

**React state:**
- camelCase: `generatingStatus`, `selectedTemplate`, `commentsList`
- Suffix with Type when clear: `isLoading`, `errorMessage`, `userList`

**Function parameters:**
- camelCase: `workspaceId`, `pageId`, `templateId`
- Avoid single letters except in `.map((item) => ...)` lambdas

---

## Import Patterns

### Path Aliases
- **Frontend**: `@/*` → `src/`
  ```typescript
  import { Card } from '@/components/ui';
  import { useAiGeneration } from '@/hooks';
  import { api } from '@/lib/api';
  import { useAuthStore } from '@/lib/store';
  ```
- **Backend**: No alias, relative imports preferred
  ```typescript
  import { messagesService } from '../services/messages';
  import { db } from '../db';
  ```

### Barrel Exports
- **UI components**: `frontend/src/components/ui/index.ts` exports all components
  ```typescript
  export { Button } from './Button';
  export { Card } from './Card';
  export { Modal } from './Modal';
  // Import: import { Button, Card } from '@/components/ui';
  ```

- **Hooks**: `frontend/src/hooks/index.ts` exports all hooks
  ```typescript
  export { useAiGeneration } from './useAiGeneration';
  export { useTheme } from './useTheme';
  ```

- **i18n**: `frontend/src/i18n/hooks.ts` exports `useLanguage()` (not from barrel)

### Import Ordering
1. External packages: `react`, `next`, `@fastify/...`
2. Type imports: `import type { WorkspaceSummary } from '@jawab24/shared'`
3. Internal utilities: `@/lib/api`, `@/lib/store`
4. Components: `@/components/ui`, `@/components/layout`
5. Hooks: `@/hooks`, `@/i18n/hooks`
6. Relative imports: `../services/`, `./utils`

```typescript
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { WorkspaceSummary } from '@jawab24/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Button } from '@/components/ui';
import { useAiGeneration } from '@/hooks';
import { captureError } from './sentryHelpers';
```

### Type vs Value Imports
- Use `import type` for types only (no runtime value)
  ```typescript
  import type { Message, Comment } from '@jawab24/shared';
  import type { CommentData } from '@/lib/api';
  ```
- Use `import` for values + types
  ```typescript
  import { useAuthStore } from '@/lib/store';
  ```

---

## Component Patterns

### Functional Components
- All components are functional (no class components except error boundaries)
- Use TypeScript props interface explicitly
- Export named function (not default)

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({ variant = 'primary', size = 'md', children, ...props }: ButtonProps) {
  // Implementation
}

Button.displayName = 'Button';  // For debugging
```

### forwardRef for UI Components
- Input, Textarea, and other form-control wrappers use `forwardRef`
- Auto-generate `id` with `useId()` for accessibility

```typescript
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    return (
      <div>
        {label && <label htmlFor={inputId}>{label}</label>}
        <input ref={ref} id={inputId} className={className} {...props} />
      </div>
    );
  }
);
Input.displayName = 'Input';
```

### Props Spreading
- Spread remaining HTML attributes: `{...props}`
- Allows consumers to add `className`, `aria-label`, `data-testid`, etc.

```typescript
export function Card({ children, className, ...props }: CardProps & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('card', className)} {...props}>{children}</div>;
}
```

### Conditional Rendering
- Prefer early returns and conditional rendering
- Avoid deeply nested ternaries

```typescript
// Good
if (!isAuthenticated) return <LoginPage />;
if (isLoading) return <Skeleton />;
return <Dashboard />;

// OK
{isOpen && <Modal />}
{error && <ErrorAlert message={error} />}
```

---

## State Management

### Zustand Stores (Frontend)

**Structure:**
- Located in `frontend/src/lib/store.ts` (currently monolithic, split planned)
- Persisted state via `persist` middleware
- `_hasHydrated` flag to prevent SSR mismatches

```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;  // True after rehydration from storage
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      _hasHydrated: false,
      setAuth: (user, token) => set({ user, token, isAuthenticated: true }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => getPersistStorage()),
    }
  )
);
```

**Hydration Pattern:**
- Stores initialize with SSR-safe defaults
- After mount, `_hasHydrated` flips to `true`
- Layouts check `_hasHydrated` before rendering sensitive content

```typescript
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  if (!hasHydrated) return null;  // Render nothing until rehydration
  return <>{children}</>;
}
```

**Storage:**
- Web: localStorage (via `createJSONStorage`)
- Mobile: Capacitor Preferences (via `getPersistStorage()`)

### React Hooks
- Standard hooks: `useState`, `useEffect`, `useCallback`, `useRef`, `useId`
- Custom hooks in `frontend/src/hooks/` with barrel export
- Hooks document dependencies in comments

```typescript
export function useAiGeneration(options: UseAiGenerationOptions = {}) {
  const { fetchLimitsOnMount = true } = options;
  const [isGenerating, setIsGenerating] = useState(false);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  return { isGenerating, generate, /* ... */ };
}
```

---

## Error Handling

### Frontend

**Error Reporting:**
- **Primary**: `captureError()` helper from `frontend/src/lib/sentryHelpers.ts`
- Sends structured errors to Sentry with tags and context

```typescript
import { captureError } from '@/lib/sentryHelpers';

try {
  const { data } = await subscriptionApi.checkAiLimit();
  setAiLimit(data);
} catch (error) {
  captureError(error, 'Failed to fetch AI limits', {
    tags: { hook: 'useAiGeneration' },
    extra: { userId: currentUser?.id }
  });
}
```

**Toast Notifications:**
- Use `sonner` toast for user-facing errors
- Short, user-friendly messages
- No error details (use Sentry for those)

```typescript
import { toast } from 'sonner';

try {
  await api.post('/templates', { name, message });
} catch (error) {
  toast.error(t('common.errorTryAgain'));
  captureError(error, 'Failed to create template', { tags: { action: 'create' } });
}
```

**Error Boundaries:**
- Page-level error boundaries in `components/layout/ErrorBoundary.tsx`
- Fallback UI displays friendly message
- Logs to Sentry via `Sentry.captureException()`

```typescript
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, { extra: errorInfo });
  }
  render() {
    return <ErrorFallback />;
  }
}
```

### Backend

**Error Middleware:**
- Centralized `middleware/errorHandler.ts`
- Logs errors to Sentry (only in production)
- Returns structured JSON error responses

```typescript
// backend/src/middleware/errorHandler.ts
export async function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  request.log.error({ error: String(error) }, 'Unhandled error');

  if (process.env.NODE_ENV === 'production') {
    Sentry.captureException(error, { extra: { url: request.url } });
  }

  if (error instanceof CustomAppError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }

  return reply.status(500).send({ error: 'Internal server error' });
}
```

**Try-Catch in Controllers:**
- Catch and log errors immediately
- Return proper HTTP status codes

```typescript
async getAll(request: FastifyRequest, reply: FastifyReply) {
  try {
    const result = await messagesService.getMessages(req.workspaceId);
    return reply.send(result);
  } catch (error) {
    request.log.error({ error: String(error) }, 'Error getting messages');
    return reply.status(500).send({ error: 'Failed to get messages' });
  }
}
```

**Service-Level Error Handling:**
- Services return structured results (data + error) or throw
- No HTTP context in services (they don't know about requests)

```typescript
async createMessage(dto: CreateMessageDTO): Promise<Message> {
  // Validate input first
  if (!dto.pageId || !dto.message) {
    throw new Error('Missing required fields');
  }

  // DB operation — let exceptions bubble to controller
  return db.insert(messages).values(dto).returning();
}
```

---

## i18n Patterns

### next-intl Integration
- **Version**: `next-intl` v4+ with per-namespace JSON files
- **Namespaces**: 39 namespaces split by feature (e.g., `common.json`, `dashboard.json`, `settings.json`)
- **Locations**:
  - English: `frontend/src/i18n/en/<namespace>.json`
  - Arabic: `frontend/src/i18n/ar/<namespace>.json`

### Using Translations in Components

**Basic Usage:**
```typescript
import { useTranslations } from 'next-intl';

export function SettingsPage() {
  const t = useTranslations('settings');     // Scoped to 'settings' namespace
  const tc = useTranslations('common');      // For shared strings

  return (
    <div>
      <h1>{t('title')}</h1>                  // "Settings"
      <button>{tc('save')}</button>          // "Save"
      <p>{t('businessHours.label')}</p>      // Nested key
    </div>
  );
}
```

**Never Use Language Conditionals:**
```typescript
// ❌ WRONG — breaks translation system
{language === 'ar' ? 'حفظ' : 'Save'}
const title = language === 'ar' ? 'عنوان' : 'Title';

// ✅ CORRECT
const t = useTranslations('common');
<button>{t('save')}</button>
const title = t('title');
```

### Language & Locale Helpers

**For RTL Detection & Language Switching:**
```typescript
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';

export function SettingsPage() {
  const { language, setLanguage, dateLocale, intlLocale } = useLanguage();
  const isRTL = isRTLLocale(language);  // Utility handles 'ar', 'he', 'fa', 'ur'

  return (
    <div>
      <button onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}>
        {language === 'ar' ? 'English' : 'العربية'}
      </button>
    </div>
  );
}
```

**Never Hardcode Locale Checks:**
```typescript
// ❌ WRONG — breaks for other RTL languages
if (locale === 'ar') { dir = 'rtl'; }

// ✅ CORRECT — works for all RTL locales
import { isRTLLocale } from '@/utils/locale';
const isRTL = isRTLLocale(locale);
dir = isRTL ? 'rtl' : 'ltr';
```

### Pluralization (ICU Format)
- Translation files use ICU Message Format for plural forms
- Grammar handles 6 forms in Arabic (zero, one, two, few, many, other)

**In Translation Files:**
```json
{
  "itemCount": "{count, plural, one {# item} other {# items}}",
  "pageLimit": "{count, plural, zero {لا صفحات} one {صفحة واحدة} two {صفحتان} few {# صفحات} many {# صفحة} other {# صفحة}}"
}
```

**In Components:**
```typescript
const t = useTranslations('common');
t('itemCount', { count: 1 })  // → "1 item" / "عنصر واحد"
t('itemCount', { count: 3 })  // → "3 items" / "3 عناصر"
```

---

## RTL/LTR Support

### Logical Properties (Tailwind CSS)
- **NEVER** use physical directions: `left`, `right`, `pl-*`, `pr-*`, `ml-*`, `mr-*`
- **ALWAYS** use logical properties: `start`, `end`, `ps-*`, `pe-*`, `ms-*`, `me-*`

```typescript
// ❌ WRONG — breaks in RTL
className="pl-4 pr-8 ml-auto text-left float-left"

// ✅ CORRECT — works in LTR and RTL
className="ps-4 pe-8 ms-auto text-start float-start"
```

**Common Mappings:**
| Physical | Logical | Meaning |
|----------|---------|---------|
| `left-*` / `right-*` | `start-*` / `end-*` | Position |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` | Padding |
| `ml-*` / `mr-*` | `ms-*` / `me-*` | Margin |
| `border-l-*` / `border-r-*` | `border-s-*` / `border-e-*` | Border |
| `rounded-l-*` / `rounded-r-*` | `rounded-s-*` / `rounded-e-*` | Radius |
| `text-left` / `text-right` | `text-start` / `text-end` | Text align |

### Direction Attribute (`dir`)
- **Set on root `<html>` tag** via `_document.tsx` (inherited by all descendants)
- **Only set `dir` on portals/overlays** that render outside the DOM tree

```typescript
// _document.tsx
export default function Document() {
  const isRTL = isRTLLocale(locale);
  return (
    <Html lang={locale} dir={isRTL ? 'rtl' : 'ltr'}>
      <Head />
      <body>
        <Main />
      </body>
    </Html>
  );
}
```

**For User Inputs (Always Use `dir="auto"`):**
- Allows browser to auto-detect direction from typed content
- Bilingual users typing in both Arabic and English get correct behavior

```typescript
// ✅ CORRECT — browser detects direction
<input dir="auto" placeholder="Search..." />
<textarea dir="auto" />

// ❌ WRONG — forces one direction
<input dir={isRTL ? 'rtl' : 'ltr'} />
```

---

## CSS Patterns

### Tailwind CSS Utility Classes
- Prefer utilities over custom CSS
- Use responsive prefixes: `md:`, `lg:`, `landscape:`
- Use dark mode: `dark:bg-surface-900` (auto-handled by globals.css)

```typescript
className={clsx(
  // Base styles
  'rounded-lg border border-border p-4 transition-colors',
  // Responsive
  'md:p-6 lg:p-8',
  // Dark mode (semantic classes handle this)
  'bg-card text-foreground',
  // Conditional
  isHovered && 'shadow-lg',
  // User classes
  className
)}
```

### Semantic CSS Classes (Dark Mode)
- **Source**: `frontend/src/styles/globals.css` (`:root` and `.dark {}`)
- **Pattern**: Use semantic classes instead of hardcoded colors

```typescript
// ❌ WRONG — hardcoded color, looks bad in dark mode
className="bg-amber-50 text-amber-700"

// ✅ CORRECT — semantic class auto-switches in dark mode
className="status-warning"  // Defined in globals.css

// ✅ CORRECT — if no semantic class exists, add dark: override
className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
```

**Common Semantic Classes:**
- `text-foreground` — primary text
- `text-muted-foreground` — secondary text (descriptions, timestamps)
- `text-icon-muted` — decorative icons, chevrons
- `text-subtle` — very light text (separators)
- `bg-card` — card background (white in light, dark gray in dark)
- `bg-background` — page background
- `border-theme-border` — theme-aware border color
- `status-warning`, `status-success`, `status-error` — status colors
- `icon-bg-*` — background + icon color together

#### ⚠️ The scales INVERT in dark mode — never pair one with a fixed foreground

`surface-*`, `brand-*` and `accent-*` are **not** the same colors in both themes.
The scale is deliberately inverted: `--surface-800` is `33 44 43` (near-black) in
light and `210 218 230` (near-white) in dark. That inversion is *load-bearing* —
`text-surface-800` has to be near-white in dark mode — and it must not be undone.

It is also a trap. **If the background flips and the foreground does not, the text
disappears in exactly one theme.**

```tsx
// ❌ WRONG — background flips, `text-white` does not.
className="bg-surface-800 text-white"   // 14.39:1 light → 1.41:1 dark
className="bg-surface-200 text-white"   // 18.08:1 dark  →  1.23:1 LIGHT
className="bg-brand-100 text-brand-700" //  4.63:1 light →  2.57:1 dark

// ✅ CORRECT — pin the half that would otherwise stay put.
className="bg-surface-800 text-white dark:bg-surface-500"
className="bg-brand-100 text-brand-700 dark:text-brand-400"
```

Two of these shipped, in opposite directions — `.offline-banner` was unreadable in
dark, the collapsed-sidebar tooltips were invisible in **light**, i.e. on the
default theme, and neither was caught by review. Reading a class string tells you
nothing about what it resolves to in the other theme; only measuring does.

Rules:

1. A `bg-{surface,brand,accent}-*` in the same class string as `text-white`,
   `text-black` or a literal color **needs a `dark:` counterpart**.
2. Same-family scale pairs (`bg-surface-200 text-surface-700`) are fine — both
   flip together.
3. **Cross-shade pairs within one family are not.** The brand scale *compresses*
   in dark mode (`--brand-200` and `--brand-800` are nearly the same color there,
   1.16:1). Measure before assuming.
4. Prefer an existing semantic class over a hand-rolled pairing — that is what
   they are for.

Pinned by `frontend/src/__tests__/styles/scaleTokenContrast.test.ts`, which
resolves both palettes out of `globals.css` and fails on any pairing that passes
in one theme and fails in the other. It reports `file:line` and both ratios.

> Separately, and **not** what that gate covers: several pairings fail in *both*
> themes (`bg-brand-500 text-white` is 2.71:1 light / 3.27:1 dark across ~30 CTAs).
> Those are a brand-palette question, not an inversion bug — see the open item in
> `DECISIONS.md`.

#### Amber vs orange — which warning hue

Both exist and they are **not** interchangeable. The split (settled 2026-08):

| Hue | Means | Used by |
|-----|-------|---------|
| **orange** | brand accent, and **commercial** state — billing, quota, trial, "coming soon" | `--accent-*` (CTA, notification count badge, body radial tint), `status-orange`, `icon-bg-orange`, `notif-ring-orange` → `subscription_expiring`, `trial_ending`, `page_trial_used` |
| **amber** | **operational** warning — something in the product needs the merchant's attention | `status-warning`, `alert-warning`, `icon-bg-amber`, `notif-ring-amber` → `stale_comment`, `stale_message`, `skipped_reply`, `kb_gap`, `post_reply_orphaned` |

Rule of thumb: if it is about **money or time left on the plan**, orange. If it is
about **work waiting to be done**, amber.

The audit that produced this rule found exactly one violation — `stale_comment`
was amber while `stale_message` was orange, so the same state rendered in two
colors depending on whether it arrived as a comment or a message. Fixed in the
same commit. That is the failure mode an undocumented near-duplicate produces:
nobody chooses wrongly on purpose, they just have nothing to choose by.

`emerald`/`green` and `violet`/`purple` were the other two near-duplicate pairs.
Those had no defensible distinction at all, so green and purple were removed —
emerald and violet survive because they are anchored to an identity (delivered /
Smart Reply). Do not reintroduce a hue without writing down what distinguishes it.

**`reply-source-*` is exempt from all consolidation.** Violet = Smart Reply,
sky = Post Reply, emerald = template, slate = manual. The merchant reads the
colour before the label, so there the hue is load-bearing, not decorative.

### Safe Areas (Mobile)
- **Single source of truth**: CSS variables in `globals.css`
- **Never hardcode** safe area values

```css
/* globals.css */
:root {
  --sai-top: env(safe-area-inset-top, 24px);
  --sai-bottom: env(safe-area-inset-bottom, 28px);
  --sai-left: env(safe-area-inset-left, 0px);
  --sai-right: env(safe-area-inset-right, 0px);
  --sai-side-landscape: 24px;
}
```

**Utility Classes:**
- `pt-safe` — padding-top with safe area
- `pb-safe` — padding-bottom with safe area
- `bottom-nav-position` — fixed nav positioning
- `landscape:px-6` — side padding in landscape

```typescript
// Fixed header
<nav className="fixed top-0 w-full pt-safe">

// Fixed bottom nav
<nav className="fixed left-0 right-0 bottom-nav-position landscape:px-6">

// Page content (scrollable)
<div className="flex-1 overflow-y-auto landscape:px-6">
```

---

## API Patterns

### Frontend API Client

**Structure**: `frontend/src/lib/api.ts`
- Two Axios instances: `api` (authenticated), `publicApi` (public)
- Interceptors handle auth tokens, CSRF, and workspace scoping
- Centralized token refresh via `AuthManager`

```typescript
import { api, publicApi, commentsApi, authApi } from '@/lib/api';

// Authenticated request (auto-includes Bearer token or CSRF)
const { data } = await commentsApi.getAll({ cursor, limit });

// Public request (no auth)
const { data } = await publicApi.get('/pricing');
```

**Token Strategy:**
- **Web**: HttpOnly cookies (auto-sent), CSRF token in header for mutations
- **Mobile**: Bearer token from localStorage, no CSRF needed

### API Endpoint Objects
- Grouped by feature: `authApi`, `commentsApi`, `templatesApi`, `rulesApi`
- Each function returns an Axios promise with typed response

```typescript
export const commentsApi = {
  getAll: (params?: CommentsQueryParams) =>
    api.get<CommentsPaginatedResponse>('/comments', { params }),

  getStats: () => api.get<CommentStats>('/comments/stats'),

  reply: (id: string, text: string) =>
    api.post(`/comments/${id}/reply`, { replyText: text }),
};
```

### Backend Routes

**Pattern**: `backend/src/routes/<feature>.ts` (Fastify)
```typescript
import { FastifyInstance } from 'fastify';
import { MessagesController } from '../controllers/messages';

const controller = new MessagesController();

export default async function(fastify: FastifyInstance) {
  fastify.get(
    '/messages',
    { preHandler: [authenticate, resolveWorkspace] },
    (req, reply) => controller.getAll(req, reply)
  );

  fastify.post(
    '/messages/:id/reply',
    { preHandler: [authenticate, resolveWorkspace] },
    (req, reply) => controller.reply(req, reply)
  );
}
```

**Middleware Chain:**
1. `authenticate` — verify JWT or CSRF token
2. `resolveWorkspace` — look up workspace from header, attach to request
3. `requireRole` (optional) — check permission level
4. `requireAdmin` (optional) — admin-only endpoints

### Backend Controllers

**Pattern**: Class-based, method per endpoint
```typescript
export class MessagesController {
  async getAll(request: FastifyRequest, reply: FastifyReply) {
    try {
      const req = request as WorkspaceRequest;
      const result = await messagesService.getMessages(req.workspaceId);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error: String(error) }, 'Error getting messages');
      return reply.status(500).send({ error: 'Failed to get messages' });
    }
  }
}
```

### Backend Services

**Pattern**: Class-based, business logic only (no HTTP context)
```typescript
export class MessagesService {
  async getMessages(workspaceId: string, options?: FilterOptions) {
    const workspacePages = await db.query.pages.findMany({
      where: eq(pages.workspaceId, workspaceId),
    });

    // ... filter logic ...

    const result = await db.query.messages.findMany({ where, orderBy });
    return { data: result, pagination: { hasMore, nextCursor, limit } };
  }

  async createMessage(dto: CreateMessageDTO): Promise<Message> {
    return db.insert(messages).values(dto).returning().then(r => r[0]);
  }
}

export const messagesService = new MessagesService();
```

### Shared Types

**Location**: `packages/shared/src/index.ts`
```typescript
// Exported types used by frontend, backend, and AI worker
export interface Message {
  id: string;
  pageId: string;
  message: string;
  direction: 'incoming' | 'outgoing';
  replied: boolean;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | null;
  // ... rest of fields
}

export interface Comment {
  id: string;
  message: string;
  fromName: string | null;
  replied: boolean | null;
  // ... rest of fields
}
```

---

## Database Patterns (Backend)

### Drizzle ORM
- Schema: `backend/src/db/schema.ts`
- Connection: `backend/src/db/index.ts`
- Queries: Type-safe, compile-time checked

```typescript
// Schema definition
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id').notNull().references(() => pages.id),
  message: text('message').notNull(),
  direction: varchar('direction', { length: 20 }).notNull(),
  replied: boolean('replied').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Query
const result = await db.query.messages.findMany({
  where: and(
    eq(messages.pageId, pageId),
    eq(messages.replied, false)
  ),
  orderBy: [desc(messages.createdAt)],
  limit: 50,
});
```

### Transactions
- Services accept `DbConn` parameter (default to `db`, can be transaction)
- Allows reusing logic inside transactions

```typescript
type DbConn = typeof db;

async createMessage(dbConn: DbConn, dto: CreateMessageDTO): Promise<Message> {
  return dbConn.insert(messages).values(dto).returning().then(r => r[0]);
}

// In controller, use transaction for multi-operation consistency
await db.transaction(async (tx) => {
  const msg = await messagesService.createMessage(tx, dto);
  await notificationsService.send(tx, msg.id);
});
```

---

## Project Structure Summary

```
frontend/
├── src/
│   ├── components/
│   │   ├── ui/              # Button, Card, Input, Modal, etc. + index.ts
│   │   ├── layout/          # DashboardLayout, PublicLayout, ErrorBoundary
│   │   └── <feature>/       # Feature-specific components
│   ├── hooks/
│   │   ├── useAiGeneration.ts
│   │   ├── useBodyScrollLock.ts
│   │   └── index.ts         # Barrel export
│   ├── lib/
│   │   ├── api.ts           # Axios clients + endpoint objects
│   │   ├── store.ts         # Zustand stores
│   │   ├── sentryHelpers.ts # Error reporting
│   │   └── ...
│   ├── pages/               # Next.js pages (routed files)
│   ├── i18n/
│   │   ├── en/              # English namespace files
│   │   ├── ar/              # Arabic namespace files
│   │   ├── hooks.ts         # useLanguage(), getDateLocale()
│   │   └── getMessages.ts   # getStaticProps helper
│   ├── styles/
│   │   └── globals.css      # Tailwind config + semantic classes + safe areas
│   └── utils/
│       └── locale.ts        # isRTLLocale(), getLocaleDirection()
├── e2e/                     # Playwright tests
├── test/                    # Vitest setup
└── vitest.config.ts

backend/
├── src/
│   ├── controllers/         # HTTP handlers (class-based)
│   ├── services/            # Business logic (singletons)
│   ├── routes/              # Fastify route definitions
│   ├── middleware/          # Auth, validation, error handling
│   ├── db/
│   │   ├── schema.ts        # Drizzle table definitions
│   │   └── index.ts         # DB connection
│   ├── lib/                 # Utilities, Sentry, Redis, etc.
│   └── types/               # Type definitions
├── test/                    # Unit + integration tests
└── vitest.config.ts

ai-worker/
├── src/
│   ├── index.ts             # Entry point
│   ├── services/            # AI logic, prompt building
│   ├── types.ts             # Shared types with backend
│   └── lib/                 # Utilities
└── vitest.config.ts

packages/shared/
├── src/
│   ├── index.ts             # Exported types + utilities
│   ├── types/               # Message, Comment, Page, etc.
│   └── utils/               # sanitizeUserInput(), normalizeArabic()
└── vitest.config.ts
```

---

## Code Quality Checklist

Before committing:
- [ ] Strict TypeScript — no `any`, proper types everywhere
- [ ] No hardcoded strings — use `t('key')` for user-facing text
- [ ] No language conditionals — use utilities from `@/utils/locale`
- [ ] Logical CSS properties — `ps-*`, `pe-*`, `text-start`, never `pl-*`, `pr-*`
- [ ] Semantic CSS classes — use `status-warning`, `text-muted-foreground`, not hardcoded colors
- [ ] Error handling — use `captureError()` for frontend, Sentry for backend
- [ ] Tests pass — `npm run test` (unit) + E2E coverage
- [ ] Linting passes — `npm run lint` (0 errors, 0 warnings)
- [ ] SSR safe — no `typeof window` in server render path (guards in layouts, not `_app.tsx`)
