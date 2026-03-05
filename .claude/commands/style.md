Fix dark mode, theming, or color/contrast issues in the Jawab24 codebase.

Arguments: $ARGUMENTS
- Describe the component, page, or CSS issue (e.g., "danger zone dark mode", "pricing card contrast")

## Workflow

### 1. Discover existing semantic classes
Read `frontend/src/styles/globals.css` — scan the `@layer components` block. List every semantic class grouped by prefix (status-*, icon-bg-*, alert-*, danger-zone-*, notif-ring-*, reply-*, pricing-*, landing-*). This is the live source of truth — never rely on a cached list.

### 2. Read the affected component
Find and read the file(s) from the arguments. Identify every hardcoded color class that lacks a `dark:` counterpart.

### 3. Apply fixes (in priority order)

**Priority A — Use an existing semantic class** if one matches the intent. Replace the inline colors entirely.

**Priority B — Create a new semantic class** in `globals.css` `@layer components` if the pattern will appear in more than one place (or is likely to). Follow the existing naming convention (`{category}-{variant}`). Always include both light AND dark values in one `@apply`. Add `:hover` / `:focus-visible` as separate selectors when needed.

**Priority C — Inline `dark:` overrides** only for truly one-off cases. Use these mappings:

| Light | Dark |
|-------|------|
| `bg-{color}-50` | `dark:bg-{color}-900/30` |
| `bg-{color}-100` | `dark:bg-{color}-900/50` |
| `text-{color}-700` to `-900` | `dark:text-{color}-300` |
| `text-{color}-600` | `dark:text-{color}-400` |
| `border-{color}-100` to `-200` | `dark:border-{color}-700` to `-800` |

Prefer semantic tokens over raw colors:
- `bg-card` not `bg-white`
- `bg-background` not bare inputs/textareas
- `text-foreground` not `text-gray-900`
- `border-theme-border` not `border-gray-200`

### 4. Verify
Run `npm run lint` — zero errors AND zero warnings required.

## Exceptions
- Landing page (`/landing`, `components/landing/*`) is light-only — skip `dark:` overrides.

## Principle
Every color must be changeable from ONE place. Same `dark:` override in 2+ components = create a semantic class.
