# Design System - Global DNA Lock

This directory contains the **design system components** that enforce visual consistency across the entire application.

## 🧬 Core Principles

1. **Consistency beats beauty** - All pages should feel like siblings, not different products
2. **Number-first hierarchy** - In KPI cards, numbers are always the primary visual element
3. **Icons as Visual Anchors** - Icons are prominent (24px), inside colored containers (48px) to provide quick visual recognition
4. **Intentional empty space** - Empty states guide users, they don't just fill space

## 📦 Components

### `KpiCard.tsx`
**Purpose**: Standardized KPI/stat card component  
**Locked Specs**:
- Number: 30px, weight 700 (bold), text-surface-900
- Label: 12px (text-xs), medium, text-surface-500
- Icon: 24px (w-6 h-6)
- Icon Container: 48px (w-12 h-12), colored bg + shadow
- Shadow: `0 10px 30px rgba(0,0,0,0.05)`
- Padding: `px-5 py-4`
- Hover: lift 2px, 150ms transition, icon scale/rotate

**Usage**:
```tsx
import { KpiCard } from '@/components/ui';

<KpiCard
  title="Total Comments"
  value={1234}
  icon={MessageSquare}
  color="brand"
/>
```

## 🎨 Design Tokens

See `/constants/designTokens.ts` for the complete token system.

### Key Tokens:
- **Card Shadow**: `0 10px 30px rgba(0,0,0,0.05)`
- **Card Radius**: `20px`
- **KPI Number**: `30px`, weight `700`
- **Icon Size**: `24px` (in 48px container)
- **Hover Lift**: `-2px`
- **Transition**: `150ms ease`

## 🚫 Rules

1. **DO NOT** create page-specific variations of these components
2. **DO NOT** modify shadow/spacing without system-wide review
3. **DO** use these components when touching any page
4. **DO** refer to design tokens for all spacing/sizing decisions

## 📋 Checklist for New Pages

When creating or updating a page:

- [ ] Use `<KpiCard>` for all stat cards
- [ ] Apply design tokens for spacing
- [ ] Match empty state styling (py-10, icon 60% opacity)
- [ ] Use consistent filter/search spacing (p-3.5, gap-3.5)
- [ ] Verify hover behavior matches (2px lift, 150ms)
- [ ] Check shadow consistency (`0 10px 30px rgba(0,0,0,0.05)`)

## 🔄 Version History

- **v1.1.0** (2026-01-06): Updated KPI Design
  - Increased icon size to 24px
  - Added colored icon containers (48px)
  - Updated KpiCard component
- **v1.0.0** (2026-01-06): Initial DNA lock
  - Created KpiCard component
  - Established design tokens
  - Standardized Dashboard, Comments, Messages pages
