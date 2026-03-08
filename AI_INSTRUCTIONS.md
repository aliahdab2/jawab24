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
const { t, language } = useTranslation();
const isRTL = language === 'ar';

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
2. **ALWAYS** use `t('translation.key')` function for all user-facing text
3. **ALWAYS** add new keys to **both** `en.json` and `ar.json`
4. The ONLY acceptable use of `language === 'ar'` is for the `dir` attribute:
   ```tsx
   // ✅ OK - dir attribute is a technical necessity
   <div dir={language === 'ar' ? 'rtl' : 'ltr'}>
   ```

**Why this matters:**
- Language conditionals bypass translation validation
- They break when adding new languages
- They make translation management impossible
- They violate single-source-of-truth principle

**Translation Key Structure (nested JSON):**

The JSON files (`en.json`, `ar.json`) use **nested objects**. Keys in code use dot-notation: `t('landing.hero.title')`.

```json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel"
  },
  "landing": {
    "hero": {
      "title": "Turn Your Page Into a"
    }
  }
}
```

- **Level 1**: page or namespace (`common`, `landing`, `settings`, `kb`)
- **Level 2**: section or feature (`hero`, `businessHours`, `replyStyle`)
- **Level 3**: specific key (`title`, `label`, `desc`)
- **NEVER** go deeper than 3 levels — the validator enforces this
- **NEVER** create a key that is both a value and a parent namespace (e.g., `settings.businessHours` cannot be a string AND have children like `settings.businessHours.label`)
- Shared keys go under `common.*` (e.g., `common.save`, `common.loading`)

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

Jawab24 automatically translates user-generated content (greeting messages, away messages) to support bilingual businesses.

**How It Works:**
1. User writes message in any language (Arabic or English) in settings
2. Backend automatically detects language when saving
3. Backend translates to the other language using OpenAI
4. Both versions stored in database (`*_ar` and `*_en` fields)
5. When replying to customers, system sends the appropriate language version

**Implementation Details:**
- **Translation happens**: When user clicks Save in settings (not on every message sent)
- **Service**: `/backend/src/services/translation.ts` using OpenAI GPT-4o-mini
- **API endpoint**: `POST /api/translation/translate` (authenticated, for manual use if needed)
- **Language detection**: `/backend/src/utils/language.ts` `detectLanguage()` function
- **Auto-translation**: `/backend/src/controllers/settings.ts` lines 52-110

**Database Schema:**
```typescript
// settings table (backend/src/db/schema.ts)
awayMessage: text('away_message'),        // DEPRECATED - legacy field
greetingMessage: text('greeting_message'), // DEPRECATED - legacy field
awayMessageAr: text('away_message_ar'),
awayMessageEn: text('away_message_en'),
greetingMessageAr: text('greeting_message_ar'),
greetingMessageEn: text('greeting_message_en'),
awayMessageSourceLang: varchar('away_message_source_lang'),
greetingMessageSourceLang: varchar('greeting_message_source_lang'),
```

**Reply Logic:**
- Message processors detect customer's language from their comment/message
- Call `settingsService.getAwayMessage(userId, language)` or `getGreetingMessage(userId, language)`
- Service returns appropriate language version
- Falls back to any available version if specific language not found

**Cost Optimization:**
- Translation only happens when user saves settings (one-time cost)
- No translation on every message sent to customers (would be expensive!)
- Uses cost-effective `gpt-4.1-mini` model
- System prompt enforces consistent, emoji-preserving translations

**User Experience:**
- User sees simple textarea (no language tabs - too confusing!)
- Types in any language they prefer
- Backend handles translation transparently
- Users don't need to know translation is happening

**Supported Languages:** Arabic (ar) and English (en)

**Future Extensions:**
- Templates (high value - used frequently)
- Knowledge Base (highest value - enables multilingual AI replies)
- Additional languages (French, Spanish, German, Swedish)

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

11. **E2E tests must import translation JSON files — never hardcode translated strings** — Import `en.json` and `ar.json` in E2E test files and use `en['key']` / `ar['key']` for all UI text assertions. This prevents tests from breaking when translations change and keeps tests aligned with the single source of truth.
   ```typescript
   // ❌ WRONG - hardcoded strings break when translations change
   await expect(page.locator('h1').filter({ hasText: 'Reply Rules' })).toBeVisible();
   await expect(page.locator('h1').filter({ hasText: /Auto Rules|قواعد الرد/i })).toBeVisible();

   // ✅ CORRECT - import from translation files
   import en from '../src/i18n/en.json';
   import ar from '../src/i18n/ar.json';

   await expect(page.locator('h1').filter({ hasText: en['rules.title'] })).toBeVisible();
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

### 13. Dark Mode — Use Semantic CSS Classes - CRITICAL

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
│   │   ├── i18n/          # en.json, ar.json translations
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

# AI Reply Quality Eval (98 test cases)
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

The project uses **GitHub Actions** for continuous integration and deployment.

### Workflows (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **ci.yml** | Push to `main`/`develop`, PRs to `main` | 4-stage pipeline: secrets check → pre-deploy checks (lint, test, build with Postgres) → Docker image build + container smoke tests → deploy gate |
| **deploy.yml** | After CI passes on `main`, or manual trigger | Blue-green zero-downtime deployment with pre-validation, migration check, 6-point health verification, automatic rollback on failure |
| **rollback.yml** | Manual trigger | Emergency rollback to previous environment |
| **smoke-tests.yml** | Post-deploy | Smoke tests against live deployment |
| **validate-deployment.yml** | Post-deploy | Comprehensive deployment validation |

### CI Pipeline Stages

1. **Preflight** — Verify GitHub secrets and deployment scripts exist
2. **Checks** — `npm ci` → OpenAI SDK version parity → `pre-deploy-check.sh` (lint, test, build) with Postgres service
3. **Docker** — Build all 3 Docker images (backend, frontend, ai-worker) + smoke test each container starts without crashing
4. **Summary** — Gate: blocks deployment if any stage fails

### Deploy Pipeline

- Runs only after CI passes on `main`
- Pre-deployment: validates env vars on server, checks DB connectivity, manages disk space
- Validates migrations locally before deploying
- Creates backup point, then runs blue-green deploy via `deploy-on-server.sh`
- Post-deploy: 6-point verification (backend health, frontend, DB, API endpoints, HTTPS/SSL, container health)
- **Automatic rollback** if any verification fails

### Key Commands

```bash
# CI runs this automatically — you can run it locally too:
./scripts/pre-deploy-check.sh

# Manual deployment (emergency/hotfix):
# Go to Actions tab → Deploy → Run workflow
```

---

## ⚠️ Known Issues & Technical Debt

This section documents known issues, technical debt, and production readiness gaps in the codebase. AI assistants should be aware of these when making changes.

### Testing Gaps

1. **~~Thin E2E test coverage~~ — RESOLVED**
   - Full E2E coverage: comments, dashboard, landing, login, messages, pages, payment, pricing, rules, settings, templates, visual
   - All tests import from `en.json`/`ar.json` instead of hardcoding translated strings

2. **No visual regression testing**
   - Status: No visual regression tests configured
   - Impact: UI-heavy mobile app with RTL can easily have visual regressions
   - Impact: Safe area, landscape mode, RTL layout issues may slip through

### Production Readiness

3. **~~No centralized error reporting~~ — RESOLVED**
   - Sentry (`@sentry/nextjs` + `@sentry/node` v10.35.0) is integrated across all workspaces
   - All critical `console.error()` calls replaced with `captureError()` from `sentryHelpers.ts`
   - Helper utilities: `frontend/src/lib/sentryHelpers.ts` and `backend/src/utils/sentryHelpers.ts`
   - Errors are tagged by context (e.g. `{ tags: { page: 'settings', action: 'save' } }`)
   - Infrastructure errors (Redis, shutdown) use DUAL logging (console + Sentry)
   - Non-critical errors use `Sentry.addBreadcrumb()` for context without noise

### Performance & Cost

4. **~~No rate limiting on auto-translation~~ — ALREADY PROTECTED**
   - Backend `handleSmartTranslation()` compares update vs current DB values — only translates when text actually changed
   - Frontend save button is disabled during save (`disabled={!hasChanges || saving}`) — prevents double-clicks

### Code Quality

5. **~~Remaining hardcoded strings~~ — RESOLVED**
   - All language conditionals fixed — using `t()` keys
   - Checkmark symbols replaced with `<Check>` lucide icon
   - No `&middot;` separator found in codebase

### Security

6. **~~No input sanitization on user textareas~~ — NOT AN ISSUE**
   - Audit confirmed: all user content rendered as **plain text in JSX** (not HTML)
   - No `dangerouslySetInnerHTML` with user input anywhere
   - Backend is JSON-only API, no server-side HTML rendering
   - Existing sanitization in `packages/shared/src/utils/sanitize.ts` handles AI prompt injection

### Minor Cleanup

7. **~~Dead export: `translateText`~~ — NOT DEAD**
    - Actively used in `controllers/settings.ts` and `routes/translation.ts`
    - No action needed

---

**Note to AI Assistants:**
- When working on related features, consider fixing these issues if appropriate
- Don't introduce new instances of these anti-patterns
- Ask the user if they want you to address any of these issues when you're in the area

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
const { t, language } = useTranslation();
const isRTL = language === 'ar';

return (
  <div dir={isRTL ? 'rtl' : 'ltr'}>
    <h1>{t('page.title')}</h1>
  </div>
);
```

---

## ⚠️ Common Mistakes

| Mistake | Fix |
|---------|-----|
| Hardcoded safe area values | Use `var(--sai-*)` CSS variables |
| Using `env()` in components | Use CSS classes like `pt-safe`, `bottom-nav-position` |
| Using `min-h-screen` in pages | Use `flex-1 overflow-y-auto` instead |
| Inline styles for safe areas | Use CSS classes |
| Using `left`/`right` in CSS | Use `start`/`end` for RTL |
| Using `pl-*`/`pr-*` | Use `ps-*`/`pe-*` for RTL |
| Using `ml-*`/`mr-*` | Use `ms-*`/`me-*` for RTL |
| Hardcoded strings | Use `t('key')` |
| **Language conditionals for text** | **Use `t('key')` NOT `language === 'ar' ? ... : ...`** |
| Missing `dir` attribute | Add `dir={isRTL ? 'rtl' : 'ltr'}` |
| Fixed heights in modals | Use `max-h-[vh]` + `overflow-auto` |
| Ignoring landscape mode | Test both orientations, use `landscape:` |
| Buttons hidden in landscape | Keep footer `flex-shrink-0`, body scrollable |
| Stripe call without country check | ALWAYS check sanctioned countries first |
| `dir="ltr"` on inputs with translated placeholders | Use `dir="auto"` so RTL placeholders display correctly |
| `dir={lang === 'ar' ? 'rtl' : 'ltr'}` on user inputs | Use `dir="auto"` — browser detects direction from typed content |
| Inline `useX()` hook in a page | Check `frontend/src/hooks/` first, create shared hook if missing |
| `<input>` or `<textarea>` without `aria-label` or linked `<label>` | Use UI components (`Input`, `Textarea`) which auto-link labels, or add `aria-label={t('...')}` |
| Hardcoded English in `aria-label` | Use `aria-label={t('key')}` — screen readers need translated labels too |
| Hardcoded translated strings in E2E tests | Import `en.json`/`ar.json` and use `en['key']`/`ar['key']` — tests break when translations change |
| `console.error(...)` for error reporting | Use `captureError()` from `sentryHelpers.ts` — errors must be tracked in Sentry, not just the browser console |
| `bg-amber-50 text-amber-700` without `dark:` overrides | Use semantic class `status-warning` (or `alert-warning`, `icon-bg-amber`) — check `globals.css` for available classes before adding inline `dark:` overrides |
| `<textarea>` or `<input>` with `text-foreground` but no `bg-*` | Add `bg-background` — browser default bg is white, causing white-on-white in dark mode |
| `bg-green-100` circles/badges in dark mode | Use `icon-bg-emerald` or `icon-bg-green` — or add `dark:bg-green-900/30` if no semantic class fits |
| `text-surface-300` or `text-surface-400` for text/icons | **NEVER** — these are invisible in dark mode (near-black). Use: `text-muted-foreground` (text), `text-icon-muted` (icons), `text-subtle` (separators), `bg-dot-muted` (dots). For action buttons with hover states: `text-surface-400 dark:text-surface-600` |
| `placeholder:text-surface-300` or `placeholder:text-surface-400` | Use `placeholder:text-muted-foreground` — matches the standard `input` component pattern in `globals.css` |
| Duplicating logic (fallback chains, selection, formatting) across files | Extract a shared utility function and import it everywhere — single source of truth |
| Adding new behavior to an unrelated service file | Create a dedicated file when the function is used by multiple callers (adapter, controller, route) |

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

### Breakpoints
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px (desktop)
- `xl`: 1280px

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