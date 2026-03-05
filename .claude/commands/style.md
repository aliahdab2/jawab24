Fix dark mode, theming, or color/contrast issues in the Jawab24 codebase.

Arguments: $ARGUMENTS
- Describe the component or page with the styling issue
- Example: "danger zone dark mode", "pricing card contrast", "modal background"

## Workflow

### Step 1 — Read the source of truth
Read `frontend/src/styles/globals.css` and scan the `@layer components` block for ALL existing semantic classes. Group them by category (status-*, icon-bg-*, alert-*, danger-*, notif-ring-*, reply-*, pricing-*, landing-*).

### Step 2 — Identify the component
Find the file(s) mentioned in the arguments. Read them to understand current styling.

### Step 3 — Check for existing semantic classes
Before adding any `dark:` overrides, check if an existing semantic class already covers the need:
- Red backgrounds/text → `alert-error`, `status-error`, `icon-bg-red`, `danger-zone-*`
- Amber/warning → `alert-warning`, `status-warning`, `icon-bg-amber`
- Green/success → `alert-success`, `status-success`, `icon-bg-emerald`
- Blue/info → `status-info`, `icon-bg-blue`
- Violet/purple → `status-violet`, `icon-bg-violet`, `icon-bg-purple`

### Step 4 — Fix the issue

**If an existing class fits** → Replace inline colors with the semantic class.

**If no class fits but the pattern will be reused** → Create a NEW semantic class in `globals.css` inside `@layer components`, following this naming convention:
- `{category}-{variant}` (e.g., `status-warning`, `icon-bg-amber`, `danger-zone-btn`)
- Include both light AND dark values in the `@apply` directive
- Add hover/focus states as separate selectors if needed

**If it's truly one-off** → Use inline `dark:` overrides with these mappings:

| Light | Dark |
|-------|------|
| `bg-{color}-50` | `dark:bg-{color}-900/30` |
| `bg-{color}-100` | `dark:bg-{color}-900/50` |
| `text-{color}-700` to `-900` | `dark:text-{color}-300` |
| `text-{color}-600` | `dark:text-{color}-400` |
| `border-{color}-100` to `-200` | `dark:border-{color}-700` to `-800` |

Also prefer semantic tokens:
- `bg-card` instead of `bg-white`
- `bg-background` instead of no `bg-*` on inputs/textareas
- `text-foreground` instead of `text-gray-900`
- `border-theme-border` instead of `border-gray-200`

### Step 5 — Update docs if new classes were created
If you added new semantic classes to `globals.css`, update the table in `AI_INSTRUCTIONS.md` (section 13, "Available semantic classes") so they're discoverable.

### Step 6 — Verify
Run `npm run lint` to ensure no warnings or errors.

## Exception
The landing page (`/landing`, `components/landing/*`) is light-only — no `dark:` overrides needed there.

## Key principle
Every color value should be changeable from ONE place. If you're about to write the same `dark:` override in multiple components, create a semantic class instead.
