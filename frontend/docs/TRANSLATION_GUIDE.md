# Translation Guide for Jawab24

Rules and best practices for managing translations in the Jawab24 frontend.

## File Structure

```
frontend/src/i18n/
  en.json          # English translations (source of truth)
  ar.json          # Arabic translations
  translations.ts  # Imports JSON, exports types & createT()
  hooks.ts         # useTranslation() hook
  index.ts         # Re-exports
```

Both files are **flat JSON** with dot-notation keys:

```json
{
  "section.subsection.element": "Translation text"
}
```

## Key Naming Rules

| Pattern | Example | When to use |
|---------|---------|-------------|
| `section.element` | `common.save` | Shared / simple keys |
| `section.subsection.element` | `settings.businessHours.start` | Section-specific keys |
| `section.subsection.desc` | `kb.section.products.desc` | Descriptions / helper text |
| `section.subsection.placeholder` | `pages.businessInfoPlaceholder` | Input placeholders |

- Use **dot.notation.camelCase** for all keys
- Group keys by page/feature prefix: `dashboard.*`, `settings.*`, `auth.*`, etc.
- Keep related keys together in the file (don't scatter them)

## Adding New Keys

**Always add to BOTH `en.json` and `ar.json`** at the same time.

1. Find the right section in the file (keys are grouped by prefix)
2. Add the key in both files with proper translations
3. Run `npm run translation:validate` to verify
4. The TypeScript type `TranslationKey` auto-updates from `en.json`

```json
// en.json
"myFeature.newLabel": "My new label"

// ar.json
"myFeature.newLabel": "التسمية الجديدة"
```

## Using Translations in Components

```tsx
import { useTranslation } from '@/i18n';

function MyComponent() {
  const { t, language } = useTranslation();

  return <p>{t('myFeature.newLabel')}</p>;
}
```

### Interpolation

Use `{variable}` syntax (single braces):

```json
"greeting": "Hello, {name}!"
"stats": "{count} items remaining"
```

```tsx
t('greeting', { name: userName })
t('stats', { count: 5 })
```

### No Hardcoded Strings

Every user-visible string must go through `t()`. Never do this:

```tsx
// BAD
<button>Save</button>

// GOOD
<button>{t('common.save')}</button>
```

## Brand Terms (Keep in Latin in Arabic)

These terms stay as-is in `ar.json` (no Arabic transliteration):

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

For directional icons (arrows, chevrons), swap them based on language:

```tsx
const Chevron = language === 'ar' ? ChevronLeft : ChevronRight;
```

### The `dir` Attribute

The app's `DashboardLayout` sets `dir={isRTL ? 'rtl' : 'ltr'}` on the wrapper. Child components inherit this automatically — don't add redundant `dir` attributes unless the component needs to override.

## Validation

Run before every commit:

```bash
npm run translation:validate
```

This checks:
1. **Key sync** — all EN keys exist in AR and vice versa
2. **Language integrity** — no Arabic text in EN; no untranslated Latin text in AR
3. **Empty values** — no keys with empty string values

Exit code 0 = pass, 1 = errors found.

## Checklist for PRs with Translation Changes

- [ ] Key added to both `en.json` AND `ar.json`
- [ ] Arabic translation reviewed by native speaker (or clearly marked for review)
- [ ] Key follows `section.element` naming convention
- [ ] No hardcoded strings in component code
- [ ] `npm run translation:validate` passes
- [ ] RTL layout tested (if UI changes involved)
