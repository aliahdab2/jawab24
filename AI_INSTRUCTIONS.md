# AI Assistant Instructions for Jawab24

> Read this file before making any changes. Applies to all AI tools.

## Quick Summary

| Item | Value |
|------|-------|
| **Node.js** | v22+ |
| **Package Manager** | npm (workspaces monorepo) |
| **Frontend** | Next.js 15 + Tailwind CSS + Capacitor 8 |
| **Backend** | Express + Drizzle ORM + PostgreSQL |
| **Languages** | Arabic (RTL) + English (LTR) |
| **Dev Server** | Frontend: 3001, Backend: 3000 |

## Project Structure

```
frontend/src/{components,pages,styles,i18n,lib,hooks}  — Next.js + Capacitor
backend/src/{routes,controllers,services,db}            — Express API
ai-worker/src/                                          — OpenAI integration
packages/shared/                                        — Shared TypeScript types
```

---

## Critical Rules

### 1. Safe Areas (Mobile)

All values defined in `globals.css` — never hardcode.

- Use `var(--sai-*)` or utility classes (`pt-safe`, `pb-safe`, `bottom-nav-position`)
- Use `landscape:px-6` for side padding
- Use `flex-1 overflow-y-auto` for scrollable content — never `min-h-screen` or `h-[100vh]`
- Never use `env(safe-area-inset-*)` directly in components or inline styles

### 2. RTL — Logical Properties Only

Never use physical directional classes. Always use Tailwind logical equivalents:

`pl-*`→`ps-*`, `pr-*`→`pe-*`, `ml-*`→`ms-*`, `mr-*`→`me-*`, `left-*`→`start-*`, `right-*`→`end-*`, `text-left`→`text-start`, `text-right`→`text-end`, `float-left`→`float-start`, `rounded-l-*`→`rounded-s-*`, `rounded-r-*`→`rounded-e-*`, `border-l-*`→`border-s-*`, `border-r-*`→`border-e-*`

For RTL detection: `isRTLLocale(locale)` from `@/utils/locale` — never `locale === 'ar'`.

Only set `dir` on portals/modals/overlays. Regular containers inherit from `<html dir>` in `_document.tsx`.

### 3. Responsive & Landscape

Every feature must work in portrait AND landscape. Key patterns:
- Modals: scrollable body, fixed header/footer, `landscape:max-w-2xl`
- Use `vh` carefully — test in landscape where height is limited
- Test both orientations AND tablet

### 4. Stripe & Sanctioned Countries (LEGAL)

**Block Stripe API calls for sanctioned countries BEFORE any request.** Check must happen on frontend (before showing payment UI) AND backend (before any Stripe call). Countries: Cuba, Iran, North Korea, Syria, Crimea, and others per Stripe's restricted list.

### 5. Translations

Use `useTranslations('namespace')` from `next-intl`. Never hardcode strings or use `language === 'ar' ? ... : ...` conditionals.

```tsx
const t = useTranslations('settings');
const tc = useTranslations('common');  // shared strings
t('title');  tc('save');
```

**File structure:** `frontend/src/i18n/{en,ar}/<namespace>.json` (39 namespaces). Flat or 1-level nested. Max 2 levels — validator enforces this.

**Page loading:** `makeGetStaticProps(['settings', 'time'])` from `@/i18n/getMessages`

**Pluralization — ICU Message Format required:**
```json
// English: "{count, plural, one {# item} other {# items}}"
// Arabic (all 6 forms): "{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصر} other {# عنصر}}"
```

**Before committing:** run `npm run translation:validate`. See `frontend/docs/TRANSLATION_GUIDE.md` for full rules.

### 6. Product Terminology

| Term | Meaning |
|------|---------|
| **Auto Reply** | Template Replies + Smart Replies |
| **Smart Reply** | AI-powered reply (never say "AI reply" in UI) |
| **Template Reply** | Keyword-matched from user-created templates |
| **Away Message** | Sent when auto-reply is off / outside business hours |
| **Greeting Message** | First message to a new customer |

### 7. Linting

Zero errors AND zero warnings required: `npm run lint` / `npm run lint:fix`

### 8. Lighthouse CI

Runs on every push. Audits `/landing`, `/pricing`, `/login`. **Hard failures:** accessibility < 90, CLS > 0.1. Config: `.lighthouserc.json`.

Rules: never remove `alt` attrs, use semantic HTML, avoid layout-shifting elements, keep `<title>` and `<meta description>` on public pages.

### 9. Accessibility (All Pages, WCAG 2.1 AA)

- Every `<input>` must have a `<label>`, `aria-label`, or `aria-labelledby`
- Color contrast: 4.5:1 normal text, 3:1 large text
- Prefer `<button>`/`<a>` over clickable `<div>` — if unavoidable, add `role`, `tabIndex`, `onKeyDown`
- Never skip heading levels
- Decorative icons: `aria-hidden="true"`. All `<img>` need `alt`
- Loading states: `aria-busy="true"`. Async updates: `aria-live="polite"`

### 10. Code Quality

1. **Single DOM for responsive layouts** — never duplicate content with `md:hidden` / `hidden md:block`
2. **Tailwind utilities over inline styles**
3. **`clsx`** for long className strings with grouped comments
4. **`dir="auto"`** on ALL user-editable inputs/textareas
5. **Check `frontend/src/hooks/`** before writing inline hooks — reuse or create shared hooks
6. **E2E tests import translation JSON** — never hardcode translated strings
7. **`captureError()`** from `sentryHelpers.ts` for errors — never bare `console.error`
8. **Extract shared utilities** — never duplicate logic across files
9. **One file, one responsibility** — shared functions live in their own utility file
10. **Run tests after ANY change** — `npm run test` + relevant E2E specs

### 11. Dark Mode — Semantic CSS Classes

Use semantic classes from `globals.css` (`status-*`, `icon-bg-*`, `alert-*`, `danger-zone-*`, `reply-*`) instead of manual `dark:` overrides. Read `globals.css` `@layer components` for the full list.

**Muted text/icons** (never use `text-surface-300`/`text-surface-400` — invisible in dark mode):
- `text-muted-foreground` — secondary text
- `text-icon-muted` — decorative icons
- `text-subtle` — separators, minor text
- `placeholder:text-muted-foreground` — input placeholders

Landing page is light-only — no `dark:` overrides needed. For theming fixes, use `/style` skill.

### 12. SSR — Never Gate Server HTML

Public pages must render full HTML on the server. Never wrap content in hydration guards in `_app.tsx`. Auth/hydration guards belong in `DashboardLayout` only. Public pages render immediately.

### 13. Multi-Language Translation Service

Away/greeting messages auto-translated on save via `backend/src/services/translation.ts`. Both `*_ar` and `*_en` stored; system picks by customer language.

---

## Common Commands

```bash
npm install                              # Install deps (from root)
cd frontend && npm run dev               # Frontend dev (port 3001)
cd backend && npm run dev                # Backend dev (port 3000)
npm run lint && npm run lint:fix         # Lint (zero errors + warnings)
npm run test                             # Unit tests
cd frontend && npm run test:e2e          # E2E tests (Playwright)
npm run translation:validate             # Check i18n files (from frontend/)
```

For Shopify integration tests, AI eval, and mobile builds — see the `/shopify-dev`, `/eval`, and `/build-mobile` skills.

---

## Testing Strategy

**Tier 1 (CI — must pass):** Backend/frontend/AI-worker unit tests, backend integration tests, E2E (Playwright), SEO regression, Lighthouse CI.

**Tier 2 (Deploy only):** Docker smoke tests, post-deploy health checks, content smoke test.

**Tier 3 (Manual):** `npm run test:ecommerce:shopify`, `npm run test:ecommerce:salla`, `npm run eval` (125 AI test cases). Use skills for setup.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `useTranslation` from `@/i18n` | `useTranslations` from `next-intl` with namespace |
| `t('namespace.key')` | Drop prefix: `t('key')` |
| `locale === 'ar'` | `isRTLLocale(locale)` from `@/utils/locale` |
| `locale === 'ar' ? 'en' : 'ar'` | `getNextLocale(locale)` |
| `locale === 'ar' ? 'rtl' : 'ltr'` | `getLocaleDirection(locale)` |
| `dir` on page containers | Don't — inherits from `<html dir>`. Only portals need it |
| `dir="ltr"` on inputs | `dir="auto"` |
| `console.error(...)` | `captureError()` from `sentryHelpers.ts` |
| `text-surface-300`/`400` | `text-muted-foreground`, `text-icon-muted`, `text-subtle` |
| Hardcoded colors without `dark:` | Semantic classes from `globals.css` |
| `"{count} item(s)"` | ICU plural: `"{count, plural, one {# item} other {# items}}"` |
| Hydration guard in `_app.tsx` | Never — guards belong in `DashboardLayout` |

---

## Commit Messages

Conventional commits. No `Co-Authored-By`, `Signed-off-by`, or any trailers.

```
feat(scope): add new feature
fix(scope): fix bug
refactor(scope): code cleanup
test: add tests
```

## Design Tokens

- `brand-*`: teal/green, `surface-*`: grays, `accent-*`: orange
- `font-display`: Outfit (headings), `font-sans`: DM Sans (body)
- Arabic: Cairo/Tajawal (auto-loaded)
