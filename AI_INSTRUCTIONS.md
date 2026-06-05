# AI Assistant Instructions for Jawab24

> Read this file before making any changes. Applies to all AI tools.

## Quick Summary

| Item | Value |
|------|-------|
| **Node.js** | v22+ |
| **Package Manager** | npm (workspaces monorepo) |
| **Frontend** | Next.js 15 + Tailwind CSS + Capacitor 8 |
| **Backend** | Fastify 5 + Drizzle ORM + PostgreSQL |
| **Languages** | Arabic (RTL) + English (LTR) |
| **Dev Server** | Frontend: 3001, Backend: 3000 |

## Project Structure

```
frontend/src/{components,pages,styles,i18n,lib,hooks}  — Next.js + Capacitor
backend/src/{routes,controllers,services,db}            — Fastify API
ai-worker/src/                                          — OpenAI integration
packages/shared/                                        — Shared TypeScript types
```

---

## Critical Rules

### 1. Safe Areas (Mobile)

All values defined in `globals.css` — never hardcode.

- Use `var(--sai-*)` or utility classes (`pt-safe`, `pb-safe`, `bottom-nav-position`)
- Use `landscape:px-6` for side padding
- Use `flex-1 overflow-y-auto` for scrollable content — never `min-h-screen` or `h-[100vh]`
- Never use `env(safe-area-inset-*)` directly in components or inline styles

### 2. RTL — Logical Properties Only

Never use physical directional classes. Always use Tailwind logical equivalents:

`pl-*`→`ps-*`, `pr-*`→`pe-*`, `ml-*`→`ms-*`, `mr-*`→`me-*`, `left-*`→`start-*`, `right-*`→`end-*`, `text-left`→`text-start`, `text-right`→`text-end`, `float-left`→`float-start`, `rounded-l-*`→`rounded-s-*`, `rounded-r-*`→`rounded-e-*`, `border-l-*`→`border-s-*`, `border-r-*`→`border-e-*`

For RTL detection: `isRTLLocale(locale)` from `@/utils/locale` — never `locale === 'ar'`.

Only set `dir` on portals/modals/overlays. Regular containers inherit from `<html dir>` in `_document.tsx`.

### 3. Responsive & Landscape

Every feature must work in portrait AND landscape. Key patterns:
- Modals: scrollable body, fixed header/footer, `landscape:max-w-2xl`
- Use `vh` carefully — test in landscape where height is limited
- Test both orientations AND tablet

### 4. Stripe & Sanctioned Countries (LEGAL)

**Block Stripe API calls for sanctioned countries BEFORE any request.** Check must happen on frontend (before showing payment UI) AND backend (before any Stripe call). Countries: Cuba, Iran, North Korea, Syria, Crimea, and others per Stripe's restricted list.

### 5. Translations

Use `useTranslations('namespace')` from `next-intl`. Never hardcode strings or use `language === 'ar' ? ... : ...` conditionals.

```tsx
const t = useTranslations('settings');
const tc = useTranslations('common');  // shared strings
t('title');  tc('save');
```

**File structure:** `frontend/src/i18n/{en,ar}/<namespace>.json` (44 namespaces). Flat or 1-level nested. Max 2 levels — validator enforces this.

**Page loading:** `makeGetStaticProps(['settings', 'time'])` from `@/i18n/getMessages`

**Pluralization — ICU Message Format required:**
```json
// English: "{count, plural, one {# item} other {# items}}"
// Arabic (all 6 forms): "{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصر} other {# عنصر}}"
```

**Adding a new namespace — all 4 steps required:**
1. Create `frontend/src/i18n/en/<namespace>.json` and `ar/<namespace>.json`
2. In `frontend/src/i18n/getMessages.ts` — add EN import, AR import, and both entries in the `NS` lookup table
3. In `frontend/src/i18n/namespaces.ts` — add to `PAGE_NAMESPACES`
4. Grep an existing namespace (e.g. `orderNotifications`) across all files to verify you didn't miss a registration point

> Step 2 is easy to forget because tests use `import.meta.glob` (auto-discovers files) but production uses static imports. Missing it causes raw keys to show instead of translated text — and tests won't catch it.

**Adding a page (or putting a shared component on a page) — load EVERY namespace it renders.**
A page's `getStaticProps` / `makeGetStaticProps` must list a namespace for **every** component it renders, not just the page's own text. Walk each child component's `useTranslations('<ns>')` and include all of them:
- `BuyTopUpCTA` / `TopUpRequestModal` → `topup`
- `SanctionedCtaFallback` and any plan card's sanctioned state → `payment` + `landing`
- a page reusing dashboard widgets → whatever those widgets call

Miss one and **only that page** shows raw keys (e.g. `topup.modal.title`). `translation:validate` will **NOT** catch it — it checks en/ar key parity, not per-page namespace loading.

**Adding a new plan/tier (slug) — add the slug-keyed display strings.**
Checkout (`getPlanName`/`getPlanDesc` in `pages/checkout.tsx`) and `PlanCard` resolve a plan's name/description from `pricing.<slug>` and `pricing.<slug>Desc`. A new slug (e.g. `scale-20k`) needs `pricing.scale-20k` **and** `pricing.scale-20kDesc` in **both** `en` and `ar`, or checkout/cards render raw `pricing.<slug>` keys. `translation:validate` won't flag this either.

> **The recurring lesson:** `translation:validate` passing is necessary but NOT sufficient. After adding a page, a component-on-a-page, or a plan, **load the actual rendered page in BOTH locales (`/en/…` and `/ar/…`) and confirm no raw keys / no missing cards** before calling it done.

**Before committing:** run `npm run translation:validate`. See `frontend/docs/TRANSLATION_GUIDE.md` for full rules.

### 6. Product Terminology

| Term | Meaning |
|------|---------|
| **Auto Reply** | Smart Replies + Post Replies |
| **Smart Reply** | AI-powered reply (never say "AI reply" in UI) |
| **Post Reply** | Per-post keyword trigger (ManyChat-style). Comment matches keyword → sends configured reply via DM. UI: "رد البوست". Configured per-post from the comments page, not workspace-level |
| **Away Message** | Sent when auto-reply is off / outside business hours |
| **Greeting Message** | First message to a new customer |

### 7. Linting

Zero errors AND zero warnings required: `npm run lint` / `npm run lint:fix`

### 8. Lighthouse CI

Runs on every push. Audits `/landing`, `/pricing`, `/login`, `/blog`, `/what-is-jawab24`. **Hard failures:** accessibility < 90, CLS > 0.1. Config: `.lighthouserc.json`.

Rules: never remove `alt` attrs, use semantic HTML, avoid layout-shifting elements, keep `<title>` and `<meta description>` on public pages.

### 9. Accessibility (All Pages, WCAG 2.1 AA)

- Every `<input>` must have a `<label>`, `aria-label`, or `aria-labelledby`
- Color contrast: 4.5:1 normal text, 3:1 large text
- Prefer `<button>`/`<a>` over clickable `<div>` — if unavoidable, add `role`, `tabIndex`, `onKeyDown`
- Never skip heading levels
- Decorative icons: `aria-hidden="true"`. All `<img>` need `alt`
- Loading states: `aria-busy="true"`. Async updates: `aria-live="polite"`

### 10. Code Quality

1. **Single DOM for responsive layouts** — never duplicate content with `md:hidden` / `hidden md:block`
2. **Tailwind utilities over inline styles**
3. **`clsx`** for long className strings with grouped comments
4. **`dir="auto"`** on ALL user-editable inputs/textareas
5. **Check `frontend/src/hooks/`** before writing inline hooks — reuse or create shared hooks
6. **E2E tests import translation JSON** — never hardcode translated strings
7. **`captureError()`** from `sentryHelpers.ts` for errors — never bare `console.error`
8. **No duplication** — before writing a helper function, `grep` the codebase for existing implementations with similar logic. Reuse or extend existing code. If a utility is used in 2+ files, it must live in a shared module, not be copy-pasted
9. **One file, one responsibility** — shared functions live in their own utility file
10. **Run tests after ANY change** — `npm run test` + relevant E2E specs
11. **Self-review before finishing** — after writing new code, re-read it and check: (a) no dead/unused code left behind, (b) no typos in variable names, (c) no columns/fields added to schema that are never read or written, (d) function signatures match actual usage (don't accept `string` if callers pass `undefined`)
12. **Verify assumptions about external APIs** — before building features around third-party behavior (Facebook, Stripe, Shopify), confirm the actual API behavior from documentation. Never assume expiry times, refresh mechanisms, or token lifecycles — get it right first, not after

### 11. Dark Mode — Semantic CSS Classes

Use semantic classes from `globals.css` (`status-*`, `icon-bg-*`, `alert-*`, `danger-zone-*`, `reply-*`) instead of manual `dark:` overrides. Read `globals.css` `@layer components` for the full list.

**Muted text/icons** (never use `text-surface-300`/`text-surface-400` — invisible in dark mode):
- `text-muted-foreground` — secondary text
- `text-icon-muted` — decorative icons
- `text-subtle` — separators, minor text
- `placeholder:text-muted-foreground` — input placeholders

Landing page is light-only — no `dark:` overrides needed. For theming fixes, use `/style` skill.

### 12. SSR — Never Gate Server HTML

Public pages must render full HTML on the server. Never wrap content in hydration guards in `_app.tsx`. Auth/hydration guards belong in `DashboardLayout` only. Public pages render immediately.

### 13. Multi-Language Translation Service

Away/greeting messages auto-translated on save via `backend/src/services/translation.ts`. Both `*_ar` and `*_en` stored; system picks by customer language.

### 13b. Backend i18n — Customer-Facing Strings

System-level strings sent to customers (nudges, fallbacks, placeholders) live in `backend/src/utils/i18n.ts`. Use `t(key, lang)` — never hardcode AR/EN strings in service files.

- **Frontend i18n**: `next-intl` with namespace JSON files (`frontend/src/i18n/{en,ar}/`)
- **Backend i18n**: centralized `utils/i18n.ts` with `t()` function
- **DB-stored**: merchant-customizable messages (away, greeting, nudge variations)

To add a new language: extend the `Locale` type in `i18n.ts` — TypeScript will flag every missing translation.

### 13c. AI Call Lifecycle Counters (Phase 6.5 diagnostic)

Four Redis counters per AI call, emitted fire-and-forget. Helpers live in `backend/src/lib/aiMetrics.ts` and `ai-worker/src/lib/aiMetrics.ts`.

Key shape: `metrics:ai:{stage}:{pipeline}:{model}[:{error_class}]`

| Stage | Emitted from | Meaning |
|-------|--------------|---------|
| `attempts` | the OpenAI call site — ai-worker before `chat.completions.create`, or backend direct-call clients (leadExtractor, transcription, embedding, openaiClient wrapper) | "We're about to issue an OpenAI API request" |
| `returns` | the OpenAI call site — after the SDK resolves successfully | "OpenAI returned; tokens received" |
| `logged` | backend `aiUsageLog.ts` after `db.insert` succeeds | "Cost row landed in `ai_usage_log`" |
| `failed_before_log` | any catch/guard that bypasses `logAiUsage` | "Call cost incurred (or guard tripped) but no row" |

**One canonical emit site per logical event.** When an instrumented call crosses the backend ↔ ai-worker boundary, *only the ai-worker side* emits `attempts` / `returns`. The backend's axios hop is internal HTTP, not an OpenAI request, so emitting from both sites would silently double-count attempts (only visible at production scale, never in unit tests). The backend's role on the hop is limited to `failed_before_log` with `AiWorkerUnreachable` when the hop itself fails.

Gap analysis (read with `scripts/phase6_5_breakdown.ts`):
- `attempts − returns` → SDK silent retries (direct-call pipelines) **or** OpenAI errors that throw before completion resolves (timeouts, 5xx)
- `returns − logged` → backend log misses **OR** response-received-but-rejected events. `recordAiReturn` fires the instant `chat.completions.create` resolves (the call was billed); refusal / empty-reply / hedging guards run *after* and throw before `logAiUsage` is reached. So a refusal looks like `attempts=1, returns=1, failed_before_log:AiRefusalError=1, logged=0` — that's correct, and the `R−L` gap measures "response received, content rejected" plus traditional log misses (missing userId, ZeroTokens guards, swallowed errors)
- `returns − logged < 0` (logged > returns) → internal cache hits. `logAiUsage(cached:true)` fires `recordAiLogged` without an OpenAI call; the magnitude of the negative gap *is* the cache-hit volume for that pipeline
- `attempts == 0 && logged > 0` → all traffic in window served from internal cache (exact-cache Layer-1 hits return before Layer-2 / embedding is reached, so `embedding_cache` can also legitimately stay at 0 even with comment_reply traffic)
- `failed_before_log:*:AiWorkerUnreachable > 0` → backend → ai-worker hop failed (axios error, circuit-open). This is a separate signal from OpenAI-side errors — the hop never reached the OpenAI call site at all

`error_class` enum: `AiEmptyReplyError`, `AiRefusalError`, `AiTimeoutError`, `OpenAIApiError`, `AiWorkerUnreachable`, `ZeroTokens`, `MissingUserId`, `Other`.

Emits never block AI calls — `redis.incr(key).catch(() => {})` is the entire pattern. The counters are diagnostic; they do not gate, retry, or fall back.

### 14. Proper Fixes Only

Fix root causes, not symptoms. No workarounds, no swallowed errors, no silenced types/tests/lint without justification.

- If the cause is unknown, diagnose first.
- "It works" is not enough — if the fix doesn't explain *why* the problem occurred, it's likely a symptom-fix. Race condition patched with `setTimeout(100)` instead of proper serialization is the classic example.
- Narrowly-scoped escape hatches (e.g. `@ts-expect-error` for a known upstream bug, feature flags for gradual rollout) are OK **with** an inline comment explaining the reason.
- Truly necessary temporary mitigations: label `// TEMP: <reason>` inline. Don't ship a TEMP without a documented path to the proper fix (linked issue, PR description, or clearly-scoped TODO). "We'll figure it out later" is not acceptable.

### 15. Documentation — Keep In Sync

After any feature addition, integration, or architectural change, update these docs **in the same commit**:

| Doc | Update when |
|-----|-------------|
| `SYSTEM_ANALYSIS.md` | New platform, resolved gap, changed status |
| `.planning/codebase/INTEGRATIONS.md` | New/changed integration details |
| `.planning/codebase/ARCHITECTURE.md` | Structural changes to how the system is built |

Rules:
- Never leave a doc saying "Planned" or "Not implemented" after shipping the feature
- Never leave a gap table entry un-struck after fixing the gap
- Doc update belongs in the **same commit** as the code — not a follow-up

---

## Common Commands

```bash
npm install                              # Install deps (from root)
cd frontend && npm run dev               # Frontend dev (port 3001)
cd backend && npm run dev                # Backend dev (port 3000)
npm run lint && npm run lint:fix         # Lint (zero errors + warnings)
npm run test                             # Unit tests
cd frontend && npm run test:e2e          # E2E tests (Playwright)
npm run translation:validate             # Check i18n files (from frontend/)
```

For Shopify integration tests, AI eval, mobile builds, and Android releases — see the `/shopify-dev`, `/eval`, `/build-mobile`, and `/release-android` skills.

### Releasing a new Android version

Local-first — no CI required:

```bash
./scripts/release-android.sh internal --bump patch   # build + sign + upload to internal track
./scripts/release-android.sh internal --dry-run      # build the signed AAB only, no upload
```

- Builds the signed AAB and uploads to Google Play via the Gradle Play Publisher plugin. Tracks: `internal` (default) / `alpha` / `beta` / `production`. Version: `--bump patch|minor|major` (default `patch`) or `--version X.Y.Z`; `versionCode` is derived as `major*10000 + minor*100 + patch`.
- **Prereqs**: signing config in `frontend/android/local.properties` and the Play service-account key at `frontend/android/play-service-account.json` (both untracked).
- The service account is scoped to **testing tracks only** — push to **production by promoting the tested build in the Play Console** (it has no production API permission by design).
- Full flow, preconditions, and the optional dispatch-only CI workflow (`.github/workflows/android-release.yml`) are documented in the `/release-android` skill.

---

## Testing Strategy

**Tier 1 (CI — must pass):** Backend/frontend/AI-worker unit tests, backend integration tests, E2E (Playwright), SEO regression, Lighthouse CI.

**Tier 2 (Deploy only):** Docker smoke tests, post-deploy health checks, content smoke test.

**Tier 3 (Manual):** `npm run test:ecommerce:shopify`, `npm run test:ecommerce:salla`, `npm run eval` (125 AI test cases). Use skills for setup.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `useTranslation` from `@/i18n` | `useTranslations` from `next-intl` with namespace |
| `t('namespace.key')` | Drop prefix: `t('key')` |
| `locale === 'ar'` | `isRTLLocale(locale)` from `@/utils/locale` |
| `locale === 'ar' ? 'en' : 'ar'` | `getNextLocale(locale)` |
| `locale === 'ar' ? 'rtl' : 'ltr'` | `getLocaleDirection(locale)` |
| `dir` on page containers | Don't — inherits from `<html dir>`. Only portals need it |
| `dir="ltr"` on inputs | `dir="auto"` |
| `console.error(...)` | `captureError()` from `sentryHelpers.ts` |
| `text-surface-300`/`400` | `text-muted-foreground`, `text-icon-muted`, `text-subtle` |
| Hardcoded colors without `dark:` | Semantic classes from `globals.css` |
| `"{count} item(s)"` | ICU plural: `"{count, plural, one {# item} other {# items}}"` |
| Hydration guard in `_app.tsx` | Never — guards belong in `DashboardLayout` |

---

## Commit Messages

Conventional commits. No `Co-Authored-By`, `Signed-off-by`, or any trailers.

```
feat(scope): add new feature
fix(scope): fix bug
refactor(scope): code cleanup
test: add tests
```

## Design Tokens

- `brand-*`: teal/green, `surface-*`: grays, `accent-*`: orange
- `font-display`: Outfit (headings), `font-sans`: DM Sans (body)
- Arabic: Cairo/Tajawal (auto-loaded)

---

## Best Practices & Industry Standards

Follow these across every change. When in doubt, prefer the safer, simpler option.

### Security (OWASP Top 10)
- Sanitize and validate ALL external input (user input, query params, API responses) at system boundaries
- Never interpolate user input into SQL, HTML, shell commands, or URLs — use parameterized queries, DOMPurify, and URL constructors
- Never expose secrets, tokens, or internal errors to the client — return generic error messages
- Set secure HTTP headers (CSP, X-Content-Type-Options, X-Frame-Options) — never weaken them without justification
- Apply least-privilege: API endpoints check auth + ownership before acting, never trust client-side-only guards

### Performance
- Minimize bundle size — lazy-load heavy components (`next/dynamic`), tree-shake imports, avoid barrel re-exports in hot paths
- Images: always use `next/image` with explicit `width`/`height` or `fill` + `sizes` — never bare `<img>` for content images
- Avoid layout shifts — reserve space for async content (skeletons, fixed dimensions), never inject DOM above the fold after paint
- Database queries: use indexes, avoid N+1 patterns, paginate unbounded lists
- Memoize expensive computations (`useMemo`/`useCallback`) only when profiling shows a need — don't pre-optimize

### Error Handling
- Use `captureError()` from `sentryHelpers.ts` — never swallow errors silently or use bare `console.error`
- Display user-friendly translated messages (`t('errorKey')`) — never show raw error strings, stack traces, or technical details
- Fail fast on startup for missing critical config (DB, API keys) — fail gracefully at runtime for transient issues (network, third-party APIs)
- Always handle loading, error, and empty states in UI — no unhandled promise rejections, no blank screens

### API & Data
- REST endpoints follow consistent naming: plural nouns, kebab-case (`/api/reply-templates`), proper HTTP methods and status codes
- Validate request bodies with schemas (Zod/Drizzle) at the handler level — never trust shape from the client
- Return consistent response shapes: `{ data }` on success, `{ error: { message, code } }` on failure
- Never return unbounded data — always paginate, limit, or stream large result sets

### Testing
- Unit tests cover business logic and edge cases, not implementation details — test behavior, not internals
- Integration tests hit real services (DB, APIs) — mocks only for third-party externals you don't control
- E2E tests use translation keys (imported JSON), never hardcoded strings
- Every bug fix includes a regression test that would have caught it

### Dependencies
- Pin exact versions in `package.json` for production dependencies
- Audit before adding a new dependency — prefer built-in APIs or existing packages in the repo
- Keep `npm audit` clean — no known high/critical vulnerabilities in production deps
- When upgrading, verify compatibility at runtime (not just `npm ls` / `tsc`) — some breakage is runtime-only
