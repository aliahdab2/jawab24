# AI Assistant Instructions for Jawab24

> **For AI Assistants**: Read this file before making any changes to the codebase.
> This applies to: Cursor, GitHub Copilot, Claude, Gemini, ChatGPT, and any other AI tools.

---

## Quick Summary

| Item | Value |
|------|-------|
| **Node.js** | v20+ required |
| **Package Manager** | npm (workspaces monorepo) |
| **Frontend** | Next.js 15 + Tailwind CSS + Capacitor 8 |
| **Backend** | Express + Drizzle ORM + PostgreSQL |
| **Languages** | Arabic (RTL) + English (LTR) |
| **Dev Server** | Frontend: 3001, Backend: 3000 |

---

## 🚨 Critical Rules

### 1. Safe Areas (Mobile App) - CRITICAL

**Every page needs explicit safe area classes. Body only handles bottom padding.**

```tsx
// ✅ CORRECT - Every page needs these:

// TOP: Header/nav needs pt-safe (for notch/status bar)
<nav className="fixed top-0 w-full pt-safe">
// OR for non-fixed headers:
<div className="flex items-center h-16 pt-safe">

// BOTTOM: Footer/last element needs pb-safe (for system nav)
<footer className="p-4 pb-safe">

// MIDDLE: Content between header and footer - NO safe area needed
<div className="flex-1">
```

**The Rule**: 
- `pt-safe` → Top element of every page (header, nav, first visible element)
- `pb-safe` → Bottom element of every page (footer, copyright, last content)
- Middle content → No safe area classes needed

### 2. RTL Support (Arabic)

**Always use logical properties, never physical left/right.**

```tsx
// ❌ WRONG - breaks Arabic
className="pl-4 pr-2 ml-auto text-left"

// ✅ CORRECT - works for both RTL and LTR
className="ps-4 pe-2 ms-auto text-start"
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

### 5. Translations

**Never hardcode user-facing strings.**

```tsx
// ❌ WRONG
<button>Save</button>

// ✅ CORRECT
<button>{t('common.save')}</button>
```

### 4. Linting

**Always check for lint errors after editing files.**

```bash
# Check linting
npm run lint

# Auto-fix
npm run lint:fix
```

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

# Build mobile app
cd frontend
npm run build:mobile
npx cap sync android
cd android && ./gradlew assembleDebug

# Run tests
npm run test
```

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
| Adding `pt-safe` to content | Body handles it automatically |
| Using `left`/`right` in CSS | Use `start`/`end` for RTL |
| Using `pl-*`/`pr-*` | Use `ps-*`/`pe-*` for RTL |
| Using `ml-*`/`mr-*` | Use `ms-*`/`me-*` for RTL |
| Hardcoded strings | Use `t('key')` |
| Missing `dir` attribute | Add `dir={isRTL ? 'rtl' : 'ltr'}` |
| Missing `pt-safe` on page header | Every page's top element needs `pt-safe` |
| Missing `pb-safe` on page footer | Every page's bottom element needs `pb-safe` |
| Fixed heights in modals | Use `max-h-[vh]` + `overflow-auto` |
| Ignoring landscape mode | Test both orientations, use `landscape:` |
| Buttons hidden in landscape | Keep footer `flex-shrink-0`, body scrollable |
| Stripe call without country check | ALWAYS check sanctioned countries first |

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

- [ ] Ran `npm run lint` - no errors
- [ ] Used logical properties for RTL (`ps-*`, `pe-*`)
- [ ] No hardcoded strings (used `t('key')`)
- [ ] Fixed elements have `pt-safe`
- [ ] Content containers do NOT have `pt-safe`/`pb-safe`
- [ ] Added `dir` attribute where needed
- [ ] Tested in both English and Arabic
- [ ] **Works in portrait mode**
- [ ] **Works in landscape mode** (buttons visible, content scrollable)
- [ ] Modals don't overflow screen in landscape