# Dashboard Spacing Guidelines

Standard spacing for all dashboard pages. One system, no per-page overrides.

## Vertical Rhythm

```
PageHeader (mb-5 / sm:mb-8 / lg:mb-10)
  |
Filter/Tab bar (mb-6)          <-- only Comments, Messages
  |
Content grid / stacked list
  |
(bottom padding handled by DashboardLayout via pb-dash-mobile)
```

## Spacing Table

| Concern              | Mobile       | Landscape      | Tablet (sm)    | Desktop (lg)   |
|----------------------|--------------|----------------|----------------|----------------|
| PageHeader mb        | 20px (mb-5)  | 12px (mb-3)    | 32px (mb-8)    | 40px (mb-10)   |
| Filter/tab bar mb    | 24px (mb-6)  | 24px           | 24px           | 24px           |
| Card grid gap        | 16px (gap-4) | 16px           | 24px (sm:gap-6)| 24px           |
| Stat grid gap        | 12px (gap-3) | 12px           | 16px (sm:gap-4)| 16px           |
| Stacked list gap     | 16px (space-y-4) | 16px       | 24px (sm:space-y-6) | 24px      |
| Content bottom pad   | 16px (pb-4)  | 16px           | 24px (sm:pb-6) | 24px           |
| Section gap (dashboard) | 32px (mb-8) | --            | --             | 40px (lg:mb-10)|

## Grid Types

| Type | Columns | Gap Pattern | Used By |
|------|---------|-------------|---------|
| **Stat grid** | `grid-cols-2 md:grid-cols-4` | `gap-3 sm:gap-4` | Dashboard |
| **Card grid** | `grid-cols-1 lg:grid-cols-2` | `gap-4 sm:gap-6` | Comments, Messages, Templates |
| **Stacked list** | single column | `space-y-4 sm:space-y-6` | Rules, Settings |

## CSS Tokens

Defined in `globals.css` `:root`:

```css
--dash-section-gap: 2rem;    /* 32px */
--dash-filter-mb: 1.5rem;    /* 24px */
```

## Rules

1. Use the spacing values above -- do not invent new ones per page
2. `PageHeader` handles its own bottom margin -- do not override it with className
3. `DashboardLayout` handles outer padding (px, pt) and bottom padding (pb-dash-mobile) -- pages should not add their own
4. Landscape mode reduces PageHeader margin automatically (mb-3)
5. Content grid bottom padding (`pb-4 sm:pb-6`) is separate from layout bottom padding
لبee to