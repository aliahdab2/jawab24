# GitHub Copilot Instructions

> See [AI_INSTRUCTIONS.md](../AI_INSTRUCTIONS.md) for full guidelines.

## Quick Rules for Copilot

### RTL Support - Use Logical Properties
```tsx
// ✅ Use these (RTL-safe)
ps-4, pe-4, ms-auto, me-0, text-start, rounded-s-lg

// ❌ Avoid these (breaks Arabic)
pl-4, pr-4, ml-auto, mr-0, text-left, rounded-l-lg
```

### Safe Areas - Body Handles It
```tsx
// ❌ Don't add pt-safe to content
<div className="min-h-screen pt-safe">

// ✅ Just use min-h-screen
<div className="min-h-screen">

// ✅ Only fixed headers need pt-safe
<nav className="fixed top-0 pt-safe">
```

### Translations - No Hardcoded Strings
```tsx
// ❌ Wrong
<button>Save</button>

// ✅ Correct
<button>{t('common.save')}</button>
```

### Node.js
- Version: v20+
- Package Manager: npm (workspaces)

### After Editing
```bash
npm run lint      # Check for errors
npm run lint:fix  # Auto-fix
```
