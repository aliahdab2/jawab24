# AI Assistant Instructions for Jawab24

> **For AI Assistants**: Read this file before making any changes to the codebase.
> This applies to: Cursor, GitHub Copilot, Claude, Gemini, ChatGPT, and any other AI tools.

---

## Quick Summary

| Item | Value |
|------|-------|
| **Node.js** | v22+ required |
| **Package Manager** | npm (workspaces monorepo) |
| **Frontend** | Next.js 15 + Tailwind CSS + Capacitor 8 |
| **Backend** | Express + Drizzle ORM + PostgreSQL |
| **Languages** | Arabic (RTL) + English (LTR) |
| **Dev Server** | Frontend: 3001, Backend: 3000 |

---

## 🚨 Critical Rules

### 1. Safe Areas (Mobile App) - CRITICAL

**Single Source of Truth** - All safe area values defined in `globals.css`:

```css
:root {
  /* Change fallback values HERE - they apply everywhere */
  --sai-top: env(safe-area-inset-top, 24px);
  --sai-bottom: env(safe-area-inset-bottom, 28px);
  --sai-left: env(safe-area-inset-left, 0px);
  --sai-right: env(safe-area-inset-right, 0px);
  --sai-side-landscape: 24px;
}
```

**Rules:**
1. **NEVER hardcode safe area values** - use `var(--sai-*)` or utility classes
2. **Use CSS classes** for positioning, not inline styles
3. **Use `landscape:px-6`** for side padding in landscape (24px)
4. **Portrait**: Bottom safe area = 28px
5. **Landscape**: Bottom = 0, sides = 24px

```tsx
// ✅ CORRECT patterns:

// Fixed header - use pt-safe class
<nav className="fixed top-0 w-full pt-safe">

// Fixed bottom nav - use bottom-nav-position class
<nav className="fixed left-0 right-0 bottom-nav-position landscape:px-6">

// Page content - use flex-1, NOT min-h-screen
<div className="flex-1 overflow-y-auto landscape:px-6">
```

**DO NOT:**
- ❌ Use `env(safe-area-inset-*, fallback)` directly in components
- ❌ Use inline styles for safe area positioning  
- ❌ Add `min-h-screen` or `h-[100vh]` to page content
- ❌ Hardcode pixel values for safe areas

**DO:**
- ✅ Use `var(--sai-*)` CSS variables
- ✅ Use utility classes: `pt-safe`, `pb-safe`, `bottom-nav-position`
- ✅ Use `landscape:px-6` for consistent side padding
- ✅ Use `flex-1 overflow-y-auto` for scrollable content

### 2. RTL Support & Tailwind for Translations

**Always use Tailwind CSS logical properties for ALL styling - never use physical left/right directions.**

This ensures the UI works correctly in both English (LTR) and Arabic (RTL).

```tsx
// ❌ WRONG - breaks Arabic
className="pl-4 pr-2 ml-auto text-left float-left"

// ✅ CORRECT - works for both RTL and LTR
className="ps-4 pe-2 ms-auto text-start float-start"
```

**Tailwind Logical Property Mapping:**

| ❌ Physical (Don't Use) | ✅ Logical (Always Use) | Description |
|------------------------|------------------------|-------------|
| `pl-*` | `ps-*` | Padding start (left in LTR, right in RTL) |
| `pr-*` | `pe-*` | Padding end (right in LTR, left in RTL) |
| `ml-*` | `ms-*` | Margin start |
| `mr-*` | `me-*` | Margin end |
| `left-*` | `start-*` | Positioning start |
| `right-*` | `end-*` | Positioning end |
| `text-left` | `text-start` | Text alignment start |
| `text-right` | `text-end` | Text alignment end |
| `float-left` | `float-start` | Float start |
| `float-right` | `float-end` | Float end |
| `rounded-l-*` | `rounded-s-*` | Border radius start |
| `rounded-r-*` | `rounded-e-*` | Border radius end |
| `border-l-*` | `border-s-*` | Border start |
| `border-r-*` | `border-e-*` | Border end |

**Critical Rules:**
1. **NEVER** use physical directional properties (`left`, `right`, `pl-*`, `pr-*`, etc.)
2. **ALWAYS** use Tailwind's logical properties (`start`, `end`, `ps-*`, `pe-*`, etc.)
3. **Set `dir` attribute** on containers when switching languages
4. **Use `dir="auto"` on inputs with translated placeholders** — never `dir="ltr"`. Email/URL inputs still need LTR text direction for typed values, but `dir="auto"` lets the browser show RTL placeholders correctly and switches to LTR once the user types Latin characters.
5. **Use Tailwind classes** for all styling - avoid inline styles that use left/right
6. **Test in both languages** before committing

```tsx
// ✅ CORRECT - Complete example
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';
const t = useTranslations('settings');   // scoped to 'settings' namespace
const locale = useLocale();
const isRTL = isRTLLocale(locale);       // use utility — never locale === 'ar' directly

return (
  <div dir={isRTL ? 'rtl' : 'ltr'} className="ps-4 pe-6">
    <div className="flex items-center gap-3">
      <Icon className="me-2" />
      <span className="text-start">{t('title')}</span>
    </div>
  </div>
);
```

### 3. Responsive & Landscape Mode

**Every feature must work beautifully in portrait AND landscape.**

```tsx
// ❌ WRONG - only works in portrait
<div className="h-screen overflow-hidden">
  <div className="h-[400px]">Fixed height content</div>
</div>

// ✅ CORRECT - adapts to orientation
<div className="h-screen overflow-auto">
  <div className="max-h-[50vh] landscape:max-h-[70vh]">
    Flexible content
  </div>
</div>
```

**Key patterns:**
- Use `vh` units carefully - test in landscape where height is limited
- Modals: scrollable body, fixed header/footer, wider in landscape
- Forms: stack vertically in portrait, can go horizontal in landscape
- Hide non-essential text in landscape to save vertical space
- Test on both phone orientations AND tablet

```tsx
// Landscape-aware modal
<div className="max-h-[85vh] sm:max-h-[90vh] landscape:max-w-2xl">
  <header className="flex-shrink-0">Title</header>
  <main className="flex-1 overflow-y-auto">Scrollable</main>
  <footer className="flex-shrink-0">Buttons</footer>
</div>
```

### 4. Stripe & Sanctioned Countries (LEGAL REQUIREMENT)

**Block Stripe API calls for users from sanctioned countries BEFORE making any request.**

```tsx
// ❌ WRONG - calling Stripe then checking country
const paymentIntent = await stripe.paymentIntents.create({...});
if (isSanctionedCountry(user.country)) throw new Error();

// ✅ CORRECT - check BEFORE any Stripe call
if (isSanctionedCountry(user.country)) {
  throw new Error('Service not available in your region');
}
const paymentIntent = await stripe.paymentIntents.create({...});
```

**Sanctioned countries include**: Cuba, Iran, North Korea, Syria, Crimea region, and others per Stripe's restricted list.

This check must happen:
- On frontend before showing payment UI
- On backend before ANY Stripe API call
- Never bypass or delay this check

### 5. Translations - NEVER Use Conditionals

**Never hardcode user-facing strings OR use language conditionals.**

```tsx
// ❌ WRONG - Hardcoded string
<button>Save</button>

// ❌ WRONG - Language conditional (anti-pattern!)
{language === 'ar' ? 'حفظ' : 'Save'}
{language === 'ar' ? 'New Section' : 'قسم جديد'}
const title = language === 'ar' ? 'عنوان' : 'Title';

// ✅ CORRECT - Use translation function
<button>{t('common.save')}</button>
{t('sections.defaultTitle')}
const title = t('common.title');
```

**Critical Rules:**
1. **NEVER** use `language === 'ar' ? ... : ...` conditionals for strings
2. **ALWAYS** use `t('key')` from `useTranslations('namespace')` for all user-facing text
3. **ALWAYS** add new keys to **both** `en/<namespace>.json` and `ar/<namespace>.json`
4. For RTL detection, use `isRTLLocale(locale)` from `@/utils/locale` — never hardcode `locale === 'ar'`:
   ```tsx
   // ✅ CORRECT — extensible, works for all RTL locales (ar, he, fa, ur)
   import { isRTLLocale } from '@/utils/locale';
   const locale = useLocale();
   const isRTL = isRTLLocale(locale);
   ```
   - Only set `dir` on elements that render **outside the normal DOM** (portals, modals, floating widgets)
   - Regular page containers do NOT need `dir` — they inherit it from `<html dir>` set in `_document.tsx`

**Why this matters:**
- Language conditionals bypass translation validation
- They break when adding new languages
- They make translation management impossible
- They violate single-source-of-truth principle

**Translation file structure:**

Translations live in per-namespace JSON files under `frontend/src/i18n/en/` and `frontend/src/i18n/ar/`:
```
src/i18n/en/common.json   src/i18n/ar/common.json
src/i18n/en/settings.json src/i18n/ar/settings.json
src/i18n/en/dashboard.json ...
... (39 namespace files per language)
```

Each namespace file is a flat-or-1-level-nested JSON:
```json
// en/common.json
{ "save": "Save", "cancel": "Cancel" }

// en/settings.json
{ "title": "Settings", "businessHours": { "label": "Business Hours" } }
```

In components, call `useTranslations('namespace')` and use just the local key (no namespace prefix):
```tsx
const t = useTranslations('settings');
t('title');                    // → "Settings"
t('businessHours.label');      // → "Business Hours"

// For shared strings use a second hook:
const tc = useTranslations('common');
tc('save');                    // → "Save"
```

**Page loading** — each page declares which namespaces it needs:
```typescript
import { makeGetStaticProps } from '@/i18n/getMessages';
export const getStaticProps = makeGetStaticProps(['settings', 'time']);
```

- **NEVER** go deeper than 2 levels inside a namespace file — the validator enforces this
- **NEVER** create a key that is both a value and a parent (e.g., `businessHours` cannot be both a string and an object)
- Shared keys go in `common.json` (e.g., `save`, `loading`, `cancel`)
- For `language`/`setLanguage`/`dateLocale`, use `useLanguage()` from `@/i18n/hooks` (not `useTranslations`)

**Pluralization — use ICU Message Format (REQUIRED)**

Never use `(s)` workarounds or hardcoded plural strings. next-intl supports ICU format natively — use it for any count/quantity.

```json
// ❌ WRONG — ugly, grammatically wrong in Arabic
"itemCount": "{count} item(s)"
"pageLimit": "Up to {limit} page(s)"

// ✅ CORRECT — English (2 forms: one, other)
"itemCount": "{count, plural, one {# item} other {# items}}"
"pageLimit": "Up to {limit, plural, one {# page} other {# pages}}"

// ✅ CORRECT — Arabic (6 forms: zero, one, two, few, many, other)
"itemCount": "{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصر} other {# عنصر}}"
```

In components, pass the variable — no other changes needed:
```tsx
t('itemCount', { count: 3 })   // → "3 items" / "3 عناصر"
t('itemCount', { count: 1 })   // → "1 item" / "عنصر واحد"
```

Arabic plural rules (CLDR):
- `one`: exactly 1
- `two`: exactly 2
- `few`: 3–10
- `many`: 11–99 (and larger multiples of 100)
- `other`: 0, 100, 101, 102... (fractional numbers, other cases)

Always include all 6 forms for Arabic keys.

**Before committing:**
- Run `npm run translation:validate` to check for missing keys, nesting depth, and language integrity
- See `frontend/docs/TRANSLATION_GUIDE.md` for full rules (key naming, RTL, interpolation, brand terms)

### 6. Product Terminology

Use these terms consistently in UI text, code comments, and translations:

| Term | Meaning |
|------|---------|
| **Auto Reply** | Umbrella term for all automatic replies (= template replies + smart replies) |
| **Smart Reply** | AI-powered reply (OpenAI-generated) — a type of auto reply |
| **Template Reply** | Rule/keyword-matched reply from user-created templates — a type of auto reply |
| **Away Message** | Sent when auto-reply is inactive (outside business hours or when auto-reply is off) |
| **Greeting Message** | First message to a new customer (separate concept from away message) |

- Auto Reply = Template Reply + Smart Reply
- Never say "AI reply" in user-facing text — use "Smart Reply"
- Business Hours controls when auto-reply is active; Away Message is what's sent during the off period

### 7. Multi-Language Translation Service

Away messages and greeting messages are auto-translated on save (not per-message). Service at `backend/src/services/translation.ts`. Both `*_ar` and `*_en` versions are stored; the system picks the right one based on the customer's language.

### 8. Linting

**Always check for lint errors AND warnings after editing files. The codebase must have zero warnings and zero errors.**

```bash
# Check linting (must produce 0 errors AND 0 warnings)
npm run lint

# Auto-fix
npm run lint:fix
```

### 9. Lighthouse CI — Performance & Accessibility Gates

Lighthouse CI runs automatically on every push/PR via GitHub Actions. It audits 3 public pages:
`/landing`, `/pricing`, `/login`

**Hard failures (block CI and deploy):**
- `categories:accessibility` < 90 — every UI change must preserve accessibility
- `cumulative-layout-shift` > 0.1 — no layout jumps allowed

**Soft warnings (visible in CI, do not block):**
- `categories:performance` < 70
- `categories:best-practices` < 80
- `categories:seo` < 80
- `largest-contentful-paint` > 5s
- `first-contentful-paint` > 3s

**Config file:** `.lighthouserc.json` at repo root — edit thresholds there.

**Rules for AI assistants:**
1. **Never remove `alt` attributes** from `<img>` tags — breaks accessibility score
2. **Never use `role` incorrectly** (e.g. `role="button"` on a `<div>` without keyboard handler)
3. **Always use semantic HTML** (`<button>`, `<nav>`, `<main>`, `<h1>`–`<h6>`) — ARIA landmarks matter
4. **Avoid adding elements that shift layout** after initial paint (lazy-loaded images need `width`/`height` attributes or `aspect-ratio` CSS)
5. **Do not add `display:none` toggling** that causes layout reflow on public pages
6. **Meta tags**: keep `<title>` and `<meta name="description">` on every public page for SEO score

### 10. Accessibility (All Pages) - CRITICAL

**Every page must be accessible — not just the public pages audited by Lighthouse CI.**

Dashboard pages (`/settings`, `/comments`, `/messages`, etc.) are used daily and must meet WCAG 2.1 AA.

**Rules:**

1. **Every form input MUST have an associated `<label>`** (or `aria-label` / `aria-labelledby`)
   ```tsx
   // ❌ WRONG - input without label
   <input type="text" placeholder="Search..." />

   // ✅ CORRECT - visible label
   <label htmlFor="search">{t('common.search')}</label>
   <input id="search" type="text" />

   // ✅ CORRECT - visually hidden label (for icon-only inputs)
   <label htmlFor="search" className="sr-only">{t('common.search')}</label>
   <input id="search" type="text" placeholder="Search..." />

   // ✅ CORRECT - aria-label (when no visible label needed)
   <input type="text" aria-label={t('common.search')} />
   ```

2. **Color contrast must meet 4.5:1** for normal text, 3:1 for large text
   - Don't use `text-surface-300` or lighter on white backgrounds
   - Placeholder text (`text-surface-400`) is exempt but keep it readable

3. **Interactive elements must be keyboard accessible**
   - Clickable `<div>`/`<span>` must have `role="button"`, `tabIndex={0}`, and `onKeyDown` handler
   - Prefer `<button>` and `<a>` — they get keyboard support for free
   - Custom toggles/switches need `role="switch"` and `aria-checked`

4. **Heading hierarchy must be logical** — never skip levels
   ```tsx
   // ❌ WRONG - skips h2
   <h1>Settings</h1>
   <h3>Notifications</h3>

   // ✅ CORRECT
   <h1>Settings</h1>
   <h2>Notifications</h2>
   ```

5. **Images and icons**
   - Decorative icons: `aria-hidden="true"` (lucide icons in buttons with text)
   - Meaningful icons: add `aria-label` or adjacent screen-reader text
   - All `<img>` tags must have `alt` attribute

6. **Dynamic content** — notify screen readers of updates
   - Toast notifications: handled by `sonner` (already accessible)
   - Loading states: use `aria-busy="true"` on the container
   - Live regions: use `aria-live="polite"` for async updates

**Before committing, spot-check accessibility:**
```bash
# Quick audit (works for any page, not just public ones)
npx lighthouse http://localhost:3001/en/settings --only-categories=accessibility --output=json --chrome-flags="--headless" | jq '.categories.accessibility.score'
```

### 11. Code Quality & Clean Patterns

**Every change must be clean, minimal, and idiomatic. No "quick hacks" that create tech debt.**

**Rules:**

1. **Never duplicate DOM for responsive layouts** — Use a single container with responsive CSS classes, not two separate DOM trees with `md:hidden` / `hidden md:block`.
   ```tsx
   // ❌ WRONG - duplicates content, doubles DOM size, breaks tests
   <div className="md:hidden">
     {plans.map(p => <PlanCard key={p.id} {...p} />)}
   </div>
   <div className="hidden md:grid md:grid-cols-3">
     {plans.map(p => <PlanCard key={p.id} {...p} />)}
   </div>

   // ✅ CORRECT - single DOM, responsive CSS on the container
   <div className="flex snap-x snap-mandatory overflow-x-auto md:grid md:grid-cols-3 md:snap-none md:overflow-visible">
     {plans.map(p => <PlanCard key={p.id} {...p} />)}
   </div>
   ```

2. **Prefer Tailwind utilities over inline styles** — Use `snap-x snap-mandatory` instead of `style={{ scrollSnapType: 'x mandatory' }}`. Inline styles bypass Tailwind's responsive system.
   ```tsx
   // ❌ WRONG
   <div style={{ scrollSnapType: 'x mandatory' }}>

   // ✅ CORRECT
   <div className="snap-x snap-mandatory">
   ```

3. **Use `clsx` for long className strings** — When a className has more than ~4 responsive states, use `clsx()` with grouped comments for readability.
   ```tsx
   // ❌ WRONG - unreadable wall of classes
   className={`flex gap-4 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 md:overflow-visible md:snap-none md:grid md:grid-cols-3`}

   // ✅ CORRECT - grouped and commented
   className={clsx(
     // Mobile: horizontal scroll carousel
     'flex gap-4 overflow-x-auto snap-x snap-mandatory -mx-4 px-4',
     // Desktop: standard grid
     'md:overflow-visible md:snap-none md:grid md:grid-cols-3',
   )}
   ```

4. **Don't add CSS classes that have no effect** — e.g., `flex-shrink` on grid items, `z-index` on static elements, or responsive overrides for properties that don't apply in that layout context.

5. **Don't use `useCallback`/`useMemo` unnecessarily** — Only memoize when:
   - Passing callbacks to memoized child components (`React.memo`)
   - The function is in a dependency array of another hook
   - Expensive computation in `useMemo`

   Don't memoize inline event handlers on a few elements.

6. **Browser API mocks belong in test setup, not individual tests** — When using browser APIs not available in jsdom (`IntersectionObserver`, `ResizeObserver`, `scrollIntoView`), add mocks to `frontend/test/setup.ts` so all tests benefit.

7. **Verify all tests pass after ANY change** — Run `npm run test` (unit) and relevant E2E specs. Never commit code that breaks existing tests.

8. **Check for existing hooks before writing inline ones** — Before defining a local `useX()` function in a page/component, check `frontend/src/hooks/` for an existing implementation. If one exists, import it. If not, create a shared hook in `frontend/src/hooks/` and export it from the barrel (`index.ts`) instead of defining it inline. Inline hooks lead to duplication.

9. **Use `dir="auto"` on ALL user-editable inputs and textareas** — Not just those with translated placeholders. `dir="auto"` lets the browser detect text direction from what the user types, which is correct for bilingual users. The only exception is inputs that are **always** a specific direction by nature (e.g., code editors).
   ```tsx
   // ❌ WRONG - forces one direction
   <textarea dir={language === 'ar' ? 'rtl' : 'ltr'} />
   <input dir="ltr" />

   // ✅ CORRECT - browser detects direction from typed content
   <textarea dir="auto" />
   <input dir="auto" />
   ```

10. **UI components must enforce accessibility by default** — The `Input` and `Textarea` components in `components/ui/` auto-generate `id` via `useId()` and link `<label htmlFor>`. When creating or modifying UI wrapper components for form elements, always include this pattern so consumers get accessibility for free without remembering to pass `id`.

11. **E2E tests must import translation JSON files — never hardcode translated strings** — Import namespace JSON files in E2E tests and use the values for all UI text assertions. This prevents tests from breaking when translations change.
   ```typescript
   // ❌ WRONG - hardcoded strings break when translations change
   await expect(page.locator('h1').filter({ hasText: 'Reply Rules' })).toBeVisible();
   await expect(page.locator('h1').filter({ hasText: /Auto Rules|قواعد الرد/i })).toBeVisible();

   // ✅ CORRECT - import from namespace translation files
   import enRules from '../src/i18n/en/rules.json';
   import arRules from '../src/i18n/ar/rules.json';

   await expect(page.locator('h1').filter({ hasText: enRules.title })).toBeVisible();
   ```

12. **Never use `console.error` for error reporting — use `captureError()` or Sentry directly** — All error logging must go through Sentry so errors are tracked in production. The only acceptable patterns are:
    - `captureError(error, 'fallback message', { tags: {...} })` from `lib/sentryHelpers.ts`
    - `Sentry.captureException(error, { extra, tags })` for error boundaries (class components can't use helpers easily)
    - Infrastructure errors (Redis disconnect, graceful shutdown) may use DUAL logging: `console.error()` AND `captureError()` together

    ```tsx
    // ❌ WRONG - error only visible in browser console, lost in production
    console.error('Failed to save settings:', error);

    // ✅ CORRECT - tracked in Sentry with context
    captureError(error, 'Failed to save settings', {
      tags: { page: 'settings', action: 'save' },
    });
    ```

13. **Never duplicate logic across files — extract shared utilities** — When the same decision logic (e.g., fallback chains, selection algorithms, formatting rules) appears in more than one place, extract it into a shared function. Import it everywhere instead of copy-pasting. This applies to both frontend hooks and backend services.
    ```typescript
    // ❌ WRONG - same fallback chain duplicated in adapter + admin route + sender
    const variations = variationsMulti[lang]
        || Object.values(variationsMulti).find(v => v.length > 0)
        || DEFAULTS[lang];
    const pick = variations[Math.floor(Math.random() * variations.length)];

    // ✅ CORRECT - shared function, single source of truth
    import { pickNudgeVariation } from '../services/reply/nudge';
    const pick = pickNudgeVariation(variationsMulti, lang);
    ```

14. **Keep services focused — one file, one responsibility** — When adding new behavior to an existing service file, check if it belongs there or deserves its own file. If a function is used by multiple callers (adapter, controller, route), it should live in its own utility file, not buried inside one caller's service.

### 12. Dark Mode — Use Semantic CSS Classes - CRITICAL

**Use the semantic CSS classes defined in `globals.css` instead of writing `dark:` overrides inline.**

The app supports light/dark/system themes. The dark mode palette is defined via CSS variables in `globals.css` (`.dark {}` block). Semantic tokens (`bg-card`, `text-foreground`, `bg-muted`, `border-theme-border`) auto-switch — but **hardcoded Tailwind colors do NOT**.

**Preferred approach — use semantic classes from `globals.css`:**

```tsx
// ❌ WRONG — hardcoded colors without dark: overrides
className="bg-amber-50 text-amber-700 border border-amber-100"

// ❌ AVOID — manual dark: overrides (verbose, error-prone)
className="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-800"

// ✅ BEST — semantic class (dark mode built in, single source of truth)
className="status-warning border"
```

**Available semantic classes** are defined in `globals.css` `@layer components` — read that file to discover the full list (status-*, icon-bg-*, alert-*, danger-zone-*, notif-ring-*, reply-*).

**Muted text & icon classes** (use instead of `text-surface-300`/`text-surface-400` which are invisible in dark mode):
- `text-icon-muted` → decorative icons, chevrons, empty state icons
- `text-subtle` → separators, minor decorative text
- `bg-dot-muted` → inactive status dots
- `text-muted-foreground` → secondary/muted text (descriptions, timestamps, char counts)
- For action buttons with hover states: `text-surface-400 dark:text-surface-600`
- For placeholders: `placeholder:text-muted-foreground`

**Key notes:**
- Status and alert classes set `border-color` but you must add `border` yourself
- Icon-bg classes set both `background` and `text` color
- **NEVER use `text-surface-300` or `text-surface-400` for text/icons** — in dark mode, surface-300 = `rgb(20,30,48)` and surface-400 = `rgb(30,42,62)`, both invisible on dark backgrounds
- Landing page (`/landing`, `components/landing/*`) is light-only — no `dark:` overrides needed

**For dark mode / theming fixes, use `/style`** — it has the full workflow, color mapping tables, and class creation conventions.

### 13. SSR Content — Never Gate Server HTML Behind Client-Only State - CRITICAL

**Public pages must render full HTML on the server. Never wrap page content in a client-only hydration guard in `_app.tsx`.**

Google, AI tools (ChatGPT, Perplexity, Gemini), and `curl` all read the server-rendered HTML. If the HTML is empty, the site is invisible to search engines and AI crawlers — regardless of how good the client-side experience is.

**The rule:**
- `_app.tsx` must ALWAYS render `<Component {...pageProps} />` on the server — no conditional skeleton
- Auth/hydration guards belong in **layout components** (`DashboardLayout`), NOT in `_app.tsx`
- `DashboardLayout` already returns `null` until Zustand stores hydrate — this protects dashboard pages
- Public pages (landing, pricing, login, blog, what-is, contact, terms, privacy) render immediately

```tsx
// ❌ WRONG — blocks ALL pages from rendering on the server (localStorage doesn't exist on server)
{!hasHydrated ? (
  <AppSkeleton />
) : (
  <Component {...pageProps} />
)}

// ❌ WRONG — same problem with typeof window check
{typeof window === 'undefined' ? (
  <Loading />
) : (
  <Component {...pageProps} />
)}

// ✅ CORRECT — always render the page, let layouts handle their own guards
<Component {...pageProps} />
// DashboardLayout internally: if (!_hasHydrated) return null;
// Public pages: render immediately, no guard needed
```

**Why this matters:**
- Server HTML is what Google indexes and AI tools read
- `localStorage`, Zustand hydration, and `window` don't exist during SSR/SSG
- A hydration guard in `_app.tsx` turns every page into a blank skeleton in the HTML
- This kills SEO, AI discoverability, and social link previews (Open Graph)

**When adding new pages:**
- Public pages: no hydration guard needed — content renders immediately
- Dashboard pages: use `DashboardLayout` which has built-in auth + hydration protection
- Never add `if (!hasHydrated) return <Skeleton />` at the `_app.tsx` level

---

## 📁 Project Structure

```
/
├── frontend/           # Next.js + Capacitor app
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/    # DashboardLayout, PublicLayout
│   │   │   └── ui/        # Button, Modal, Card, etc.
│   │   ├── pages/         # Next.js pages
│   │   ├── styles/        # globals.css (CSS variables)
│   │   ├── i18n/          # en/ and ar/ namespace files, getMessages.ts, hooks.ts
│   │   └── lib/           # api.ts, store.ts
│   └── android/           # Capacitor Android project
│
├── backend/            # Express API server
│   └── src/
│       ├── routes/
│       ├── controllers/
│       ├── services/
│       └── db/            # Drizzle schema
│
├── ai-worker/          # OpenAI integration
│
└── packages/
    └── shared/         # Shared TypeScript types
```

---

## 🔧 Common Commands

```bash
# Install dependencies (from root)
npm install

# Start development servers
cd frontend && npm run dev    # Port 3001
cd backend && npm run dev     # Port 3000

# Linting (ALWAYS run after changes)
npm run lint
npm run lint:fix

# Run unit tests (REQUIRED after ANY code change)
npm run test
# Or for frontend only:
cd frontend && npm run test

# Run E2E tests with Playwright CLI (from frontend/)
cd frontend
npm run test:e2e                        # Run all E2E specs
npm run test:e2e -- e2e/landing.spec.ts # Run a single spec
npm run test:e2e -- -g "login"          # Run tests matching name
npm run test:e2e:ui                     # Interactive UI mode (best for debugging)
npm run test:e2e:headed                 # Watch browser run tests
npm run test:e2e:report                 # Open last HTML report
npm run test:e2e -- --update-snapshots  # Update visual baselines

# Build mobile app
cd frontend
npm run build:mobile
npx cap sync android
cd android && ./gradlew assembleDebug

# Shopify Integration Tests (local dev)
# Use the /shopify-dev skill or run manually:
# Prerequisites: ngrok authtoken configured, Jawab24-Dev Shopify app credentials in backend/.env
# 1. Start environment (ngrok + backend + frontend):
/shopify-dev
# Or manually:
#   ngrok http 3000  →  update SHOPIFY_HOST_NAME in backend/.env  →  restart backend
# 2. Connect dev store via UI (one-time OAuth):
#   http://localhost:3001/en/integrations  →  enter your-store.myshopify.com
# 3. Run tests (no OAuth needed after first connect):
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
ADMIN_TOKEN="$ADMIN_TOKEN" npm run test:ecommerce:shopify
# Dev app credentials: in backend/.env (Jawab24-Dev app in Shopify Partners — never commit keys here)
# Prod: restore SHOPIFY_HOST_NAME=jawab24.com in backend/.env before deploying!

# AI Reply Quality Eval (125 test cases)
# Prerequisites: backend (port 3000) + ai-worker (port 3002) running, demo mode enabled
# 1. Start services:
DATABASE_URL="postgres://postgres:postgres@localhost:5433/autoreply" npx tsx backend/src/index.ts
PORT=3002 OPENAI_API_KEY="<key>" npx tsx ai-worker/src/index.ts
# 2. Get admin token:
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
# 3. Run eval:
ADMIN_TOKEN="$ADMIN_TOKEN" npm run eval
# Options: VERBOSE=1 (detailed output), CATEGORY=3 (run single category), CONCURRENCY=5
```

---

## 🚀 CI/CD Pipeline

GitHub Actions workflows live in `.github/workflows/` (ci, deploy, rollback, smoke-tests, validate-deployment). Run `./scripts/pre-deploy-check.sh` locally to check before pushing.

---

## 🧪 Testing Strategy

The project has **three tiers** of testing. Tier 1 and 2 run automatically in CI and deploy. Tier 3 is manual — run it before releasing changes to integrations or AI.

### Tier 1 — Automatic (CI + `pre-deploy-check.sh`)

These run on every push, PR, and deploy. All must pass to merge or deploy.

| Test Suite | Command | What It Covers |
|-----------|---------|---------------|
| **Backend unit tests** | `npm run test:coverage -w jawab24-backend` | All services, controllers, routes (mocked DB/APIs). 80% coverage threshold. |
| **Frontend unit tests** | `npm run test -w jawab24-frontend` | Components, hooks, utils. Real English translations loaded in mocks. |
| **AI worker unit tests** | `npm run test -w jawab24-ai-worker` | AI pipeline, prompt building, caching logic. |
| **Backend integration tests** | `npm run test:integration -w jawab24-backend` | Real Postgres (CI service container). Messages, payments, pages, adapters, workspace. |
| **E2E tests (Playwright)** | `cd frontend && npx playwright test` | All pages: comments, dashboard, landing, login, messages, pages, payment, pricing, rules, settings, templates, integrations. APIs mocked. |
| **SEO regression tests** | `cd frontend && npx playwright test e2e/seo.spec.ts` | 39 tests: canonical URLs, hreflang, OG/Twitter tags, noindex on protected routes, JSON-LD, sitemap, robots.txt. JS disabled. |
| **Lighthouse CI** | `.lighthouserc.json` | Accessibility (>90), SEO (>90), CLS (<0.1) on `/landing`, `/pricing`, `/login`, `/blog`, `/what-is-jawab24`. |

### Tier 2 — Automatic (deploy only)

| Check | Where |
|-------|-------|
| **Docker smoke tests** | CI builds all 3 images, verifies each container starts |
| **Post-deploy health checks** | 6-point verification (backend, frontend, DB, API, HTTPS, containers) |
| **Content smoke test** | Verifies HTML response contains expected content before switching traffic |

### Tier 3 — Manual (before releasing integration or AI changes)

These require real running services and can't run in CI (need API keys, connected stores, or live AI).

| Test | Command | When to Run | Prerequisites |
|------|---------|-------------|---------------|
| **E-commerce integration test** | `npm run test:ecommerce:shopify` | Before releasing Shopify changes | Backend running, demo store in DB |
| **E-commerce integration test (Salla)** | `npm run test:ecommerce:salla` | Before releasing Salla changes | Backend running, Salla store in DB |
| **AI eval (full — 125 cases)** | `npm run eval` | Before releasing AI/prompt changes | Backend + AI worker running |
| **AI eval (e-commerce only)** | `CATEGORY=13 npm run eval` | Before releasing e-commerce KB/RAG changes | Backend + AI worker running |

See **Common Commands** above for exact commands. Use `/shopify-dev` skill for the easiest workflow.

---

## ⚠️ Known Issues & Technical Debt

1. **No visual regression testing**
   - Status: No visual regression tests configured
   - Impact: UI-heavy mobile app with RTL can easily have visual regressions
   - Impact: Safe area, landscape mode, RTL layout issues may slip through

---

## 📱 Mobile App Patterns

### Layout Pattern
```tsx
// Dashboard pages
export default function MyPage() {
  return (
    <DashboardLayout>
      {/* Content here - no safe area classes needed */}
    </DashboardLayout>
  );
}
```

### Modal Pattern
```tsx
// Use the Modal component - has built-in safe areas
<Modal isOpen={isOpen} onClose={onClose} title="My Modal">
  {/* Content */}
</Modal>
```

### Translation Pattern
```tsx
import { useTranslations, useLocale } from 'next-intl';
import { useLanguage } from '@/i18n/hooks';  // only when you need language switching
import { isRTLLocale } from '@/utils/locale'; // for RTL detection

// For UI text (most components):
const t = useTranslations('dashboard');   // scoped to 'dashboard' namespace
const tc = useTranslations('common');     // for shared strings

// For locale/direction (only when needed — e.g. icon rotation, portal components):
const locale = useLocale();
const isRTL = isRTLLocale(locale);       // use utility — never locale === 'ar' directly

// For language switching or date locale:
const { language, setLanguage, dateLocale } = useLanguage();

// NOTE: Most page containers do NOT need dir= — they inherit from <html dir> in _document.tsx
// Only set dir on portal/overlay components (modals rendered outside the DOM tree).
return (
  <div>
    <h1>{t('title')}</h1>
    <button>{tc('save')}</button>
  </div>
);
```

---

## ⚠️ Common Mistakes (Quick Reference)

Detailed rules are in the sections above. This table covers the most frequent gotchas:

| Mistake | Fix |
|---------|-----|
| `import { useTranslation } from '@/i18n'` (old shim) | Use `import { useTranslations } from 'next-intl'` with a namespace |
| `t('namespace.key')` (prefixed key) | Drop the prefix: `t('key')` — namespace is passed to `useTranslations()` |
| `locale === 'ar'` for RTL detection | Use `isRTLLocale(locale)` from `@/utils/locale` |
| `locale === 'ar' ? 'en' : 'ar'` for language toggle | Use `getNextLocale(locale)` from `@/utils/locale` |
| `locale === 'ar' ? '' : '/${locale}'` for URL path | Use `getLocalePath(locale)` from `@/utils/locale` |
| `locale === 'ar' ? 'rtl' : 'ltr'` for direction | Use `getLocaleDirection(locale)` from `@/utils/locale` |
| Adding `dir` to normal page containers | Don't — they inherit from `<html dir>` in `_document.tsx`. Only portals/overlays need `dir` |
| `dir="ltr"` or `dir={lang === 'ar' ? ...}` on user inputs | Use `dir="auto"` — browser detects direction from typed content |
| `console.error(...)` for error reporting | Use `captureError()` from `sentryHelpers.ts` |
| `text-surface-300` or `text-surface-400` for text/icons | **NEVER** — invisible in dark mode. Use `text-muted-foreground`, `text-icon-muted`, `text-subtle` |
| `<input>` with `text-foreground` but no `bg-*` | Add `bg-background` — prevents white-on-white in dark mode |
| Hardcoded color classes without `dark:` overrides | Use semantic classes from `globals.css` (`status-*`, `icon-bg-*`, `alert-*`) |
| `"{count} item(s)"` in translation files | Use ICU plural format: `"{count, plural, one {# item} other {# items}}"` |
| Hydration guard in `_app.tsx` | **NEVER** — server HTML will be empty. Guards belong in `DashboardLayout` |

---

## 💬 Commit Messages

Use conventional commits:

```
feat(scope): add new feature
fix(scope): fix bug
refactor(scope): code cleanup
docs: update documentation
style: formatting only
test: add tests
```

Examples:
```
feat(mobile): add bottom safe area
fix(login): prevent double-click
refactor(css): consolidate safe areas
```

**IMPORTANT:** Never add `Co-Authored-By`, `Signed-off-by`, or any attribution trailer to commits. Do not attribute commits to AI tools, bots, or any third party. Commits must have no trailers at all.

---

## 🎨 Design Tokens

### Colors (Tailwind)
- `brand-*`: Primary teal/green
- `surface-*`: Grays for backgrounds
- `accent-*`: Orange highlights

### Fonts
- `font-display`: Outfit (headings)
- `font-sans`: DM Sans (body)
- Arabic: Cairo/Tajawal (auto-loaded)

---

## ✅ Before Committing Checklist

- [ ] Ran `npm run lint` - no errors AND no warnings
- [ ] Used logical properties for RTL (`ps-*`, `pe-*`)
- [ ] No hardcoded strings (used `t('key')`)
- [ ] **No language conditionals** (`language === 'ar' ? ... : ...`) - use `t('key')` instead
- [ ] Ran `npm run translation:validate` if translation files changed
- [ ] Safe areas use `var(--sai-*)` or CSS classes (no hardcoded values)
- [ ] No `min-h-screen` in page content (use `flex-1 overflow-y-auto`)
- [ ] Bottom nav uses `bottom-nav-position` class
- [ ] Added `landscape:px-6` for side padding where needed
- [ ] Added `dir` attribute where needed
- [ ] Tested in both English and Arabic
- [ ] **Works in portrait mode** (bottom safe area visible)
- [ ] **Works in landscape mode** (no bottom gap, side padding correct)
- [ ] Modals don't overflow screen in landscape
- [ ] **Accessibility**: form inputs have labels, interactive elements are keyboard accessible, heading hierarchy is logical
- [ ] **Dark mode**: use semantic classes (`status-*`, `icon-bg-*`, `alert-*`) from `globals.css` — only add inline `dark:` overrides when no class fits. Landing page is exempt.
- [ ] **SSR content**: no hydration guards in `_app.tsx` — public pages must render full HTML on the server for SEO and AI crawlers