# Translation Guide for Jawab24

Rules and best practices for managing translations in the Jawab24 frontend.

> **Updated 2026-04-15** — Reflects migration to `next-intl` v4 with namespaced translation files.

## File Structure

```
frontend/src/i18n/
  en/                   # English translations (44 namespace files)
    common.json         # Shared strings (save, cancel, loading, etc.)
    dashboard.json      # Dashboard page
    settings.json       # Settings page
    comments.json       # Comments page
    messages.json       # Messages page
    nav.json            # Navigation/sidebar
    ...                 # 44 namespace files total
  ar/                   # Arabic translations (mirrors en/ structure)
    common.json
    dashboard.json
    ...
  getMessages.ts        # Static imports for EN + AR, NS lookup table
  namespaces.ts         # PAGE_NAMESPACES — maps pages to required namespaces
  hooks.ts              # useLanguage() for switching + dateLocale
  index.ts              # Re-exports
```

Each namespace file is flat or 1-level nested JSON. Max 2 levels — the validator enforces this.

## Using Translations in Components

```tsx
import { useTranslations } from 'next-intl';

function MyComponent() {
  const t = useTranslations('settings');    // namespace-scoped
  const tc = useTranslations('common');     // shared strings

  return (
    <div>
      <h1>{t('title')}</h1>
      <button>{tc('save')}</button>
    </div>
  );
}
```

### Locale and Language Switching

```tsx
import { useLocale } from 'next-intl';
import { useLanguage } from '@/i18n';

const locale = useLocale();                          // 'en' or 'ar'
const { setLanguage, dateLocale } = useLanguage();   // switching + date formatting
```

### RTL Detection

```tsx
import { isRTLLocale } from '@/utils/locale';

const isRTL = isRTLLocale(locale);  // never use locale === 'ar'
```

## Adding New Keys

**Always add to BOTH `en/<namespace>.json` and `ar/<namespace>.json`** at the same time.

```json
// en/settings.json
{ "newLabel": "My new label" }

// ar/settings.json
{ "newLabel": "التسمية الجديدة" }
```

Run `npm run translation:validate` to verify.

## Adding a New Namespace — All 4 Steps Required

1. Create `frontend/src/i18n/en/<namespace>.json` and `ar/<namespace>.json`
2. In `frontend/src/i18n/getMessages.ts` — add EN import, AR import, and both entries in the `NS` lookup table
3. In `frontend/src/i18n/namespaces.ts` — add to `PAGE_NAMESPACES`
4. Grep an existing namespace (e.g. `orderNotifications`) across all files to verify you didn't miss a registration point

> **Step 2 is easy to forget** because tests use `import.meta.glob` (auto-discovers files) but production uses static imports. Missing it causes raw keys to show instead of translated text — and tests won't catch it.

## Page Loading

Pages declare their required namespaces via `makeGetStaticProps`:

```tsx
// In the page file
export const getStaticProps = makeGetStaticProps(['settings', 'time']);
```

Global namespaces (`common`, `nav`, `notifications`, `errors`, `errorBoundary`, `meta`) are auto-loaded for every page.

## Interpolation

Use `{variable}` syntax (single braces):

```json
"greeting": "Hello, {name}!"
"stats": "{count} items remaining"
```

```tsx
t('greeting', { name: userName })
t('stats', { count: 5 })
```

## Pluralization — ICU Message Format

```json
// English
"itemCount": "{count, plural, one {# item} other {# items}}"

// Arabic (all 6 forms required)
"itemCount": "{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصر} other {# عنصر}}"
```

## No Hardcoded Strings

Every user-visible string must go through `t()`. Never do this:

```tsx
// BAD
<button>Save</button>

// GOOD
<button>{tc('save')}</button>
```

## Brand Terms (Keep in Latin in Arabic)

These terms stay as-is in `ar/*.json` (no Arabic transliteration):

- **Jawab24** / **jawab24.com**
- **Facebook**, **Instagram**, **WhatsApp**, **Meta**
- **Stripe**, **OpenAI**
- **CSV**, **API**, **DELETE** (technical terms)
- Organization/address details (Swedish legal text)

## RTL Support

### CSS Logical Properties

Use `start`/`end` instead of `left`/`right`:

```tsx
// BAD
className="ml-4 pr-2 text-left border-l-2"

// GOOD
className="ms-4 pe-2 text-start border-s-2"
```

Tailwind equivalents:
| Physical | Logical |
|----------|---------|
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `left-*` / `right-*` | `start-*` / `end-*` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `border-l-*` / `border-r-*` | `border-s-*` / `border-e-*` |

### Direction-Aware Icons

For directional icons (arrows, chevrons), use RTL detection:

```tsx
const Chevron = isRTLLocale(locale) ? ChevronLeft : ChevronRight;
```

### The `dir` Attribute

The `<html dir>` is set in `_document.tsx`. Child components inherit automatically. Only set `dir` on portals/modals/overlays. Use `dir="auto"` on user-editable inputs/textareas.

> An **empty** `dir="auto"` field resolves to LTR — `dir=auto` reads the element's value, never its placeholder — which in the Arabic UI puts the caret and placeholder at the left edge. That is handled globally in `globals.css` by `input[dir="auto"]:placeholder-shown, textarea[dir="auto"]:placeholder-shown { direction: inherit }`, so `dir="auto"` on its own is the right thing to write in a component. See AI_INSTRUCTIONS.md §10.4.

## Validation

Run before every commit:

```bash
npm run translation:validate
```

This checks:
1. **Key sync** — all EN keys exist in AR and vice versa
2. **Language integrity** — no Arabic text in EN; no untranslated Latin text in AR
3. **Empty values** — no keys with empty string values
4. **Nesting depth** — max 2 levels

Exit code 0 = pass, 1 = errors found.

## Checklist for PRs with Translation Changes

- [ ] Key added to both `en/<namespace>.json` AND `ar/<namespace>.json`
- [ ] If new namespace: registered in `getMessages.ts` (import + NS table) AND `namespaces.ts`
- [ ] Arabic translation reviewed by native speaker (or clearly marked for review)
- [ ] No hardcoded strings in component code
- [ ] `npm run translation:validate` passes
- [ ] RTL layout tested (if UI changes involved)
- [ ] Uses `useTranslations('namespace')` from `next-intl` (NOT old `useTranslation()` from `@/i18n`)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `useTranslation` from `@/i18n` | `useTranslations` from `next-intl` with namespace |
| `t('namespace.key')` | Drop prefix: `t('key')` — namespace is set at hook level |
| `locale === 'ar'` | `isRTLLocale(locale)` from `@/utils/locale` |
| `dir` on page containers | Don't — inherits from `<html dir>`. Only portals need it |
| `dir="ltr"` on inputs | `dir="auto"` |
| Missing `getMessages.ts` registration | Raw keys in production, tests pass — always register imports |
