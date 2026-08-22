# AI Assistant Instructions for Jawab24

> Read this file before making any changes. Applies to all AI tools.

> **Settled decisions live in [`DECISIONS.md`](DECISIONS.md).** Before re-opening a settled architectural or product question, consult it first. When a decision is made or reversed, append a `D-NNN` entry (append-only — never edit past rulings).

> **Before touching anything that can change a reply, read [`docs/REPLY_ANATOMY.md`](docs/REPLY_ANATOMY.md).** It maps the ten stages a reply passes through, exactly which blocks the model is allowed to read and which of them are gated, where each known defect class lives, and the two prompt approaches that were measured at zero. It is also the answer to "why did the AI say that?" — start there instead of reading the pipeline from scratch.

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

> **"Safe areas are native-only" is FALSE — the web needs them too (August 2026).** The strategy comment in `globals.css` says insets apply only to Capacitor / PWA standalone because "mobile browsers already account for notch/nav in their viewport". That stopped being true with Android 15: WebViews are laid out **edge-to-edge**, so an ordinary web page in an in-app browser (Facebook, Instagram) gets a real non-zero `env(safe-area-inset-bottom)`. Anything gated on `.is-native` is therefore *missing* on exactly the surface where merchants first meet us — a link tapped in a Facebook post. The shipped symptom: `.bottom-nav-position` lifted the bottom nav by `var(--sai-bottom)` **ungated**, while its opaque backdrop `.bottom-safe-bg` was `height: 0` on web and only got a height under `.is-native` — so the nav floated over a **transparent** strip and dashboard content scrolled visibly through the gap beneath it. **The rule that follows: whenever a fixed element is offset by a `--sai-*` token, whatever fills or pads that offset must read the SAME token under the SAME conditions — never gate one side on `.is-native` and not the other.** Pinned by `frontend/src/__tests__/styles/bottomSafeArea.test.ts`. Note the gap is invisible in desktop DevTools' device emulation (it reports 0 insets); reproduce on a real Android device, or accept that a fix reading the same token is a no-op where the inset is 0.

**Soft keyboard — single source of truth.** `--keyboard-height` is owned **only** by `setupKeyboard()` in `frontend/src/lib/keyboardSetup.ts`. Never add a second writer (a stray `visualViewport` handler / `keyboardDidShow` listener elsewhere = two sources racing = the gap bug). Modals lift above the keyboard via the shared `DetailSheet` pattern (`bottom: var(--keyboard-height)` + `max-h: calc(100vh - var(--keyboard-height))`) — don't hand-roll keyboard offsets in a component.

> **The gotcha that bit us (June 2026, 255px gap):** when the keyboard opens, a WebView either **RESIZES** (`window.innerHeight` drops by the keyboard height, so `100vh` already excludes it → `--keyboard-height` MUST be **0**) or **OVERLAYS** (`innerHeight` stays full → `--keyboard-height` must equal the keyboard height). `--keyboard-height` is the keyboard's overlap with the *current* layout viewport, computed from three signals in priority order: (1) `innerHeight − visualViewport.height − offsetTop` when it reports a **non-zero** inset — authoritative; (2) when it reads ~0 but the keyboard is up, `nativeHeight − (baseline − innerHeight)` where `baseline` is the keyboard-closed `innerHeight` (resize → 0; overlay, incl. iOS `keyboardWillShow` before the viewport shrinks → full native height); (3) closed → 0. **Three traps, all shipped and caught:** (a) applying the native height on top of an already-resized viewport double-counts → modal floats *above* the keyboard (the original 255px gap); (b) trusting a viewport that reads **0** and discarding the native height → modal hides *behind* the keyboard on iOS / overlay devices (the inverse bug, caught in self-review); (c) on **dismiss**, the gap + shake while *retracting* the keyboard (June 2026). ROOT cause = a **late hide signal**: listening only to `keyboardDidHide` (which Capacitor fires at the animation END — Android `WindowInsetsAnimationCompat.onEnd`) leaves `nativeUp` true through the whole slide-down, so the native-height fallback pins `--keyboard-height` at the full keyboard height for the entire retract (the gap), dropping it only at the end (the shake). A first patch (the `viewportTrackedInset` flag — trust the viewport's decay to 0 once it has proven it tracks the inset) made the *first* dismiss smooth but the bug returned on **every subsequent dismiss**, because the WebView's `visualViewport` goes silent on later cycles (no intermediate frames) and the flag has nothing to track. The real fix: also listen to **`keyboardWillHide`**, which fires at the animation **START** (`onStart`, BOTH platforms), and drop `nativeUp` there — the fallback releases the height the instant the keyboard *begins* leaving, independent of any viewport frames. Android now wires **didShow (settled height) + willHide (early release) + didHide (settle the `baseline` — only safe at animation end on a resize WebView)**; iOS keeps **willShow + willHide** (its `innerHeight` is stable, so `baseline` is refreshed at willHide). The flag is kept as a secondary guard for OEMs where willHide is unreliable. **A residual SHAKE remained** even after willHide: during the retract the height still arrived in several noisy per-frame `visualViewport` steps (pan/`offsetTop` jitter), and `MessageDetailModal`'s `ResizeObserver` re-pins its bottom-anchored thread (`justify-end`) on *every* size change, so the modal juddered. Cured by EASING every `--keyboard-height` change: it is registered with `@property` (animatable `<length>`) and `html.is-native { transition: --keyboard-height 0.18s ease-out }` damps the value however it arrives. The transition is **always-on, NOT gated to the dismiss** — that matters because a collapse-only transition gated behind the willHide event did NOT help (willHide isn't guaranteed to fire on every OEM, so the gate never opened and the jitter was undamped). On top of that, a JS `collapsing` flag (set between willHide and didHide) pins the height to `0` and ignores viewport jitter for the clean path when willHide DOES fire; where it doesn't, `apply()` keeps tracking the viewport and the same always-on transition damps it. So a viewport reading 0 is NOT proof the keyboard is closed (signals 1–2); don't infer dismiss from the viewport at all — take it from `keyboardWillHide`. Track the `keyboard-open` class (collapses `pb-safe-modal`) **separately** from the height — a resize device reports height 0 while the keyboard is genuinely open. To diagnose, compare `innerHeight` vs `visualViewport.height` vs computed `--keyboard-height` on a **real device** (CI/emulators won't reproduce it). Regression coverage: `frontend/src/lib/__tests__/keyboardSetup.test.ts` (resize, overlay-reports, overlay-silent, dismiss-tail, willHide-early-release, show-cancels-collapse, iOS-willShow, threshold, clamp).

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

**Arabic register — فصحى only (added 2026-07-09).** All Arabic copy that Jawab24 itself authors — i18n strings, marketing pages, blog posts, notifications, emails, app-store listings — must be Modern Standard Arabic (الفصحى). No dialect: never «وش، اللي، مو، ليش، هالـ، بدك، شلون» or similar خليجي/مصري/شامي forms. Also avoid English loanwords and calqued phrasing where native Arabic exists. **Scope boundary:** this rule governs OUR copy only — the AI reply pipeline deliberately mirrors the customer's dialect (prompt v40/v44 dialect mirroring) and must NOT be "fixed" to فصحى. Older dialect content (some pre-2026-07-09 blog posts) is migrated opportunistically when touched, not in bulk.

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
- `SanctionedCtaFallback` and any plan card's sanctioned state → `payment`
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
| **Greeting Message** | Welcome sent when a new customer taps "Get Started" / «بدء الاستخدام» (opener-only — typed first messages go straight to the AI) |
| **Business Info** | The merchant-authored knowledge the AI replies from (products, prices, hours, policies, FAQs). UI: "معلومات نشاطك التجاري" (2nd-person in-app/marketing) / "معلومات النشاط التجاري" (impersonal legal copy). **Always the user-facing name** — never "Knowledge Base"/"قاعدة المعرفة" (kept only in admin tooling + as a RAG mechanism descriptor) or "business profile"/"ملف متجرك". Internally the code still calls it "knowledge base / kb" (folder, `page.knowledgeBase`, `?openKb=true`, i18n keys) — do not rename code |

### 7. Linting

Zero errors AND zero warnings required: `npm run lint` / `npm run lint:fix`

### 8. Lighthouse CI

Configured in `.lighthouserc.json` to audit `/landing`, `/pricing`, `/login`, `/blog`, `/what-is-jawab24`, with hard failures at accessibility < 90 and CLS > 0.1. ⚠️ It lives only in the GitHub CI path, which we do not use (see Testing Strategy) — so these thresholds are currently enforced by review, not by an automated gate. The rules below still apply to every change.

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
4. **`dir="auto"`** on ALL user-editable inputs/textareas.

   > **`dir="auto"` alone is NOT enough while the field is EMPTY (fixed 2026-08-19).** `dir=auto` on a form control resolves from the element's **value**, never its placeholder — an empty value has no strong directional character, so the element computes `direction: ltr` no matter what `<html dir>` says. In the Arabic UI that puts the caret and the placeholder at the **left** edge of every empty box; and because `dir=auto` also maps to `unicode-bidi: plaintext`, the placeholder line still renders RTL internally, so a trailing «...» sits on the far left of a left-aligned box. Shipped symptom: the «اختبار الرد الذكي» composer. **You do not need to do anything about this per component** — `globals.css` carries one rule, `input[dir="auto"]:placeholder-shown, textarea[dir="auto"]:placeholder-shown { direction: inherit }`, which fixes every current and future field at one point; typing restores full auto-detection because `:placeholder-shown` stops matching. The ~27 components that carry their own `dir={value ? 'auto' : getLocaleDirection(locale)}` are belt-and-braces, not the mechanism — don't add a 28th. Pinned by `frontend/src/__tests__/styles/autoDirEmptyInput.test.ts` (source) and `frontend/e2e/complete-profile.spec.ts` (the cascade, which a unit test cannot prove).
5. **Check `frontend/src/hooks/`** before writing inline hooks — reuse or create shared hooks
6. **E2E tests import translation JSON** — never hardcode translated strings
7. **`captureError()`** from `sentryHelpers.ts` for errors — never bare `console.error`
8. **No duplication** — before writing a helper function, `grep` the codebase for existing implementations with similar logic. Reuse or extend existing code. If a utility is used in 2+ files, it must live in a shared module, not be copy-pasted.

   **This is now a gate, not a promise: `npm run check:duplication`** (also runs in `pre-deploy`). It compares normalised declaration *bodies* across all four workspaces, so it catches renamed clones as well as same-named ones. Known findings are carried in `scripts/duplication-baseline.json` and reported without failing; anything new fails. If a finding is duplication by design, justify it and run `npm run check:duplication:baseline` — never silence it without a stated reason.

   > **Why prose alone was not enough.** The April 2026 cleanup extracted `facebookCrypto.maybeEncryptToken` and migrated four call sites, but `AuthService.maybeEncrypt` survived with a byte-identical body — a `private` member is invisible both to a grep for the exported name and to reading the diff. The `Ai*Error` classes are still duplicated between `backend/src/utils/fbGraphErrors.ts` and `ai-worker/src/lib/errors.ts`, which is the same split §13c records as having shipped the timeout-classification bug **twice**. Grepping first is still the rule; the gate is the backstop for what grepping misses. Its floor is 3 body lines — shorter clones (including `maybeEncrypt` itself) are below it, so the habit still matters.
9. **One file, one responsibility** — shared functions live in their own utility file
10. **Run tests after ANY change** — `npm run test` + relevant E2E specs
11. **Self-review BEFORE the merge, not after** — re-read your own diff adversarially, as if reviewing someone else. Hygiene first: (a) no dead/unused code left behind, (b) no typos in variable names, (c) no columns/fields added to schema that are never read or written, (d) function signatures match actual usage (don't accept `string` if callers pass `undefined`).

    **Then the four questions below, which hygiene checks do NOT catch.** They are the ones that shipped defects to production on 2026-08-13 (PR #736, corrected by #737/#740 and D-080) — three defects in one merged PR, found by an external reviewer and by a self-review done *after* the merge that took 20 minutes. Run it before.

    - **a. Who READS what I changed?** Enumerate every reader of the column/field/shape — backend queries, stats/count endpoints, caches, frontend lists, chips, SSE — and check each. ⛔ "The writer is correct" is not the question. Precedent: an auto-resolve rule changed `resolved` semantics; the dashboard banner's *count* filtered `resolved=false` while its *list* did not, so merchants saw "0 need attention" above twenty items. The readers were three greps away.
    - **b. Does my evidence cover everything the change GOVERNS?** If the predicate touches three tables, measure three tables. Precedent: the same rule was measured on `messages` (24,243 rows) and shipped governing `comments` too (31,885) — a ruling made on 43% of its own blast radius, with the owner's consent taken on a number that described under half of it.
    - **c. Am I destroying the evidence I will need to check this later?** A write that stamps a timestamp/flag used as a measurement proxy makes the *next* measurement impossible, not merely inexact. Precedent: the sweep wrote `updated_at` — the schema's only proxy for "resolved at" — on 56,147 rows, erasing the ability to tell system action from merchant action.
    - **d. Does every mutation honour the contracts its neighbours honour?** Cache invalidation, SSE emission, audit rows, metric counters. If four controller paths all call something after this kind of write, so must yours. Precedent: `invalidateEndpointStatsCaches` — required of every mutation of those counts, skipped by the largest one.

    **And a sample is not a population.** If you read 25 of 512, say "25 of 512". State conclusions about the rest as bounds, never as fact — and prefer a sweep that can find the counter-example (a pattern search across all rows, the extreme tail) over more sampling.
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
- `returns − logged` → backend log misses **OR** response-received-but-rejected events. `recordAiReturn` fires the instant `chat.completions.create` resolves (the call was billed); refusal / empty-reply / hedging guards run *after* and throw before `logAiUsage` is reached. So a thrown refusal looks like `attempts=2, returns=2, failed_before_log:AiRefusalError=1, logged=0` — two attempts because the refusal guard retries once (since #738; the retry resends assistant history JSON-wrapped since 2026-08-16) and only throws when both attempts refuse. That's correct, and the `R−L` gap measures "response received, content rejected" plus traditional log misses (missing userId, ZeroTokens guards, swallowed errors)
- `returns − logged < 0` (logged > returns) → internal cache hits. `logAiUsage(cached:true)` fires `recordAiLogged` without an OpenAI call; the magnitude of the negative gap *is* the cache-hit volume for that pipeline
- `attempts == 0 && logged > 0` → all traffic in window served from internal cache (exact-cache Layer-1 hits return before Layer-2 / embedding is reached, so `embedding_cache` can also legitimately stay at 0 even with comment_reply traffic)
- `failed_before_log:*:AiWorkerUnreachable > 0` → backend → ai-worker hop failed (axios error, circuit-open). This is a separate signal from OpenAI-side errors — the hop never reached the OpenAI call site at all

`error_class` enum: `AiEmptyReplyError`, `AiRefusalError`, `AiTimeoutError`, `OpenAIApiError`, `AiWorkerUnreachable`, `ZeroTokens`, `MissingUserId`, `Other`.

**`AiTimeoutError` vs `OpenAIApiError` — never classify by reading the error.** The OpenAI SDK assigns no `name` to its error classes (`APIUserAbortError → APIError → OpenAIError → Error`), so `err.name === 'AbortError' | 'APIUserAbortError'` is DEAD CODE and every timeout books as `OpenAIApiError`. Ask the AbortSignal the call site owns instead — `isTimeoutAbort(signal)` / `classifyTimeoutAbort(signal, otherwise?)` from `@jawab24/shared` (`packages/shared/src/aiTimeout.ts`) is the ONLY sanctioned predicate. `makeTrackedOpenAI` applies it automatically to every chat/embedding call that passes a `signal`, so tracked pipelines inherit correct classification for free; the ESLint-exempted direct clients (`transcription.ts`, `embedding.ts`, `leadExtractor.ts`) classify at their own emit site. This shipped wrong twice — JAWAB24-AI-WORKER-6/9 (ai-worker, 2026-07-22) and JAWAB24-BACKEND-1J (backend voice/vision, 2026-07-27) — because a fix in one package wasn't adopted in the other.

Emits never block AI calls — `redis.incr(key).catch(() => {})` is the entire pattern. The counters are diagnostic; they do not gate, retry, or fall back.

### 14. Proper Fixes Only

Fix root causes, not symptoms. No workarounds, no swallowed errors, no silenced types/tests/lint without justification.

- If the cause is unknown, diagnose first.
- **⭐ Measure FIRST, propose second — not the reverse.** A proposal made before the measurement anchors everyone to it, including you, and the measurement then gets read as a verdict on the proposal instead of on the problem. On 2026-08-13 three confident recommendations died the moment they were measured — emptying a "contaminated" field (which turned out to cause total silence, 6/6), escalating unread alerts to email (built on an aid page whose volume was mistaken for value), and treating a free-text description as a disclosure policy (the model ignored the merchant's explicit instruction, 0/6). Each cost a full round trip that measuring first would have skipped. When you catch yourself writing "the fix is…" before you have a number, stop and get the number.
- "It works" is not enough — if the fix doesn't explain *why* the problem occurred, it's likely a symptom-fix. Race condition patched with `setTimeout(100)` instead of proper serialization is the classic example.
- **Prevention over detection.** When a failure has a structural cause (a shared resource, a race, an unguarded code path), prefer the fix that makes it *impossible* over one that merely detects it and warns. A guard, alert, or retry is a complementary safety net — never the primary fix. Example (2026-06-11): dev-vs-build `.next` corruption was cured by giving the dev server its own `distDir` (collision impossible), with the pre-deploy dev-server guard kept only as belt-and-braces — not by the guard alone.
- Narrowly-scoped escape hatches (e.g. `@ts-expect-error` for a known upstream bug, feature flags for gradual rollout) are OK **with** an inline comment explaining the reason.
- Truly necessary temporary mitigations: label `// TEMP: <reason>` inline. Don't ship a TEMP without a documented path to the proper fix (linked issue, PR description, or clearly-scoped TODO). "We'll figure it out later" is not acceptable.

### 15. Documentation — Keep In Sync

After any feature addition, integration, or architectural change, update these docs **in the same commit**:

| Doc | Update when |
|-----|-------------|
| `SYSTEM_ANALYSIS.md` | New platform, resolved gap, changed status |
| `.planning/codebase/INTEGRATIONS.md` | New/changed integration details |
| `.planning/codebase/ARCHITECTURE.md` | Structural changes to how the system is built |
| `backend/docs/OBJECT_STORAGE.md` | Anything about merchant image storage — provider, backups, key rotation, the `ImageStorage` S3 abstraction (see D-032) |
| `backend/docs/SETTINGS.md` | Any settings field added/renamed/removed, any change to the reply gate chain, or any change to what/when auto-messages (away, greeting, quota fallback, nudges) are sent |
| `docs/REPLY_ANATOMY.md` | Any change to the reply path: a new context block, a new guard, a gate change, a defect class opened or closed, or a measured result that moves one of its numbers. Rule 19 already requires the eval mirror — this is the map that tells the next reader where the change sits |

Rules:
- Never leave a doc saying "Planned" or "Not implemented" after shipping the feature
- **Never leave a doc claiming a feature exists when it does not.** This is the same defect
  in reverse, and it is the more dangerous direction: a doc that under-claims wastes a grep,
  a doc that over-claims sends the reader down a wrong path with full confidence. Mark
  anything declared-but-unwired as ❌ NOT IMPLEMENTED. A type, a template, or a UI component
  existing is **not** the feature existing — check for a real caller.
- Never leave a gap table entry un-struck after fixing the gap
- Doc update belongs in the **same commit** as the code — not a follow-up

**Docs must also be fixed when found wrong, with no code change involved.** The rules above
are triggered by shipping; documentation also rots on its own, while nothing is being
shipped. So whenever an investigation shows a doc to be inaccurate — even if the task at
hand touches no code — correct it there and then. A standalone docs-only commit is the
right outcome, not scope creep.

**When a doc and the source disagree, the source wins — and the doc is the bug.** Verify a
doc's claim by grepping for a real caller/writer before you rely on it. Precedent
(2026-07-31, PR #577): `SYSTEM_ANALYSIS.md` said `pages.auto_reply_disabled_reason` records
`plan_limit`, while `db/schema.ts` had said `RESERVED — no current writer` for over a month
and the same doc contradicted itself further down. `docs/notifications-roadmap.md` listed a
trial-expiry cron as shipped; its only caller was the demo seeder. Both cost real
investigation time on a live merchant issue.

### 16. Best Practice & Industry Standards Always

When multiple valid approaches exist, choose the one that follows established **best practice** and recognized **industry standards** — even when a quicker, narrower change would "work." Default to the conventional, well-understood, standards-compliant solution over a bespoke or minimal one; reach for a non-standard approach only with a clear, stated reason. Concretely:

- Follow the **industry-standard pattern** for the problem (REST/HTTP semantics, OWASP for security, WCAG for accessibility, semantic versioning, conventional commits, the framework's documented/idiomatic way) rather than inventing a local convention. The "Best Practices & Industry Standards" section below is the baseline, not the ceiling.
- Don't ship the minimal patch when the well-engineered solution is the right call; never trade correctness, maintainability, or robustness for speed unless explicitly asked to.
- If you spot a better, more standard approach than the obvious one mid-task, take it (or surface it and recommend it) rather than defaulting to the easy path.

Pairs with Rule 14: the proper fix, done the proper (standard) way.

### 17. Reply Speed Is The Product (LATENCY BUDGET)

**Jawab24's competitive lead is how fast it answers.** Treat reply latency as a feature with a budget, not an afterthought. Ruling and evidence: **D-049**.

Know the actual cost hierarchy before optimizing anything (measured 2026-07-29 over 30 days of real traffic — 9,002 unique / 16,149 messages):

| What | Cost per reply | Notes |
|------|----------------|-------|
| Semantic reply-cache **HIT** | **milliseconds** | the thing that makes us fast |
| Cache **MISS** → OpenAI call | **2,000–4,000 ms** | ~500,000× everything below |
| One extra sequential network hop (ai-worker, DB, Redis) | 1–50 ms | |
| ALL local language detection + regex + string work | **~0.004 ms** | 65 ms total for a whole MONTH of traffic |

Rules, in order of how much they matter:

1. **Anything that turns a cache HIT into a MISS is the most expensive change you can make.** Bumping `PROMPT_VERSION` retires *every* semantic reply-cache key. Bump it only when the prompt genuinely changed, and verify `scripts/deploy-on-server.sh` still runs `npm run cache:warm-replies` after the deploy (it does today, non-fatally, at the container step). Never bump it "to be safe."
2. **Never put a network call, model call, or `await` on the per-message path to answer a question that can be answered locally.** Language detection is the standing example: it must stay synchronous and in-process. A hosted LID or a "just one more model call" classifier converts microseconds into tens/hundreds of milliseconds on **every** message and never warms up. Pinned by `packages/shared/src/language/__tests__/languageLatency.test.ts`.
3. **Never add a *sequential* hop where a parallel one works.** Independent I/O in the reply path belongs in `Promise.all`.
4. **Do not micro-optimize local CPU on this path without a profile.** Single-digit-microsecond work is not a latency problem, and hand-rolling a cheaper partial copy of a shared function to save it duplicates logic (Rule 10.8) for no user-visible gain.
5. **Measure before and after against a real corpus, never intuition.** Same method as detector changes: pull real `messages.message` + `comments.message`, run old vs new in one process, best-of-N. Report the delta AND the total across a month's traffic — a per-message number alone is easy to misread.
6. **Latency must be observable, or the lead is undefendable.** `messageProcessor.ts` already laps all 16 pipeline stages, but via `logger.debug` while prod runs at `info` (`config.logLevel` default, no `LOG_LEVEL` in the server `.env`) — so today those timings are **dark in production**. Don't claim a latency win from local numbers alone.

### 17b. Copy The Working Flow Before Inventing One

**Before building any app↔browser↔third-party bridge, find the one that already
works in this repo and read it.** Jawab24 has shipped, on-device-proven flows for
Facebook login, Facebook page connect, and page reconnect. They are the reference
implementation for "the native app must send the merchant to Meta and get them
back" — not a starting point to improve on.

This rule exists because ignoring it cost a full night and **seven Android
releases** (2026-07-31). WhatsApp connect kept failing on a real device while
Facebook page connect worked the whole time, and the difference was one property
nobody checked:

| | Facebook page connect (works) | the WhatsApp attempts (all failed) |
|---|---|---|
| Tab's FIRST document | **facebook.com** | a jawab24.com page |
| Reaching Meta | it *is* the destination | page-side `location.assign`, or a server 302 |
| Return to the app | a PAGE assigns `window.location` → App Link fires | a server 302 → App Link ignored |

**Two invariants, and BOTH were learned the hard way — the second one only after
the first was fixed and the flow still misbehaved:**

1. **A browser tab the app opens must START at the third party.** All three
   failing outbound shapes — `location.assign` in a Custom Tab, the same in an
   intent-opened Chrome tab, and a server 302 — died silently on the device. The
   tab type, Android 11 package visibility, and JS were all red herrings chased
   in turn.
2. **An App Link must be navigated to by a PAGE, never sent as a `Location:`
   header.** Android intercepts a navigation a page starts; a redirect the
   browser follows inside its own request chain is not one — it just renders the
   web fallback. Symptom: `GET /auth/app-sync?redirect=… → 200` in the access
   log and the merchant left in the browser after a *successful* connect.
   `auth/callback.tsx` does it right for Facebook; copy that.

Concretely, for any new app→browser handoff:
- Mint whatever state you need from the **authenticated app session**, then
  `Browser.open()` the third-party URL directly.
- Return by SERVING A PAGE whose script assigns `window.location` to the
  **`/auth/app-sync` App Link** (Android-verified: it reopens the app and closes
  the tab), with a manual anchor for when the script or the verification does not
  fire. Pass only an intent — no session token — when the app never lost its
  session; and remember a token-less bridge URL is a RETURN, not a sign-in, so
  never bounce it to `/login`.
- **Cookie jars do not cross.** The app WebView and the browser have separate
  jars, so any cookie-paired defence (CSRF double-submit, nonce) is unavailable
  on this path. Replace it with an equally strong property — single-use state via
  `lib/singleUseKey` — never just delete it. A signed state with no replay
  defence is replayable for its whole TTL, and for connect flows a replay
  attaches the *attacker's* asset to the victim's workspace.
- **Server logs cannot tell a Custom Tab from Chrome** — same user-agent, same
  cookies. Never conclude "the real browser opened" from a Chrome UA; if a code
  path can silently degrade, mark it in-band (`launchDegraded=1`) so the logs
  can prove which surface ran.

### 18. One Session, One Worktree — Never Edit Code in the Main Checkout

**Every session that will change code starts by creating a git worktree.** The main
checkout at `~/Documents/AutoReply` is for reading, running, and reviewing — never for
edits. Do this BEFORE the first edit, not after the diff has grown.

```
EnterWorktree(name: "<descriptive-name>")     # → .claude/worktrees/<name>, new branch off origin/main
git branch -m feat/<conventional-name>        # the auto name `worktree-<name>` is not a PR branch name
```

The `/worktree` skill is the full procedure; `/cleanup-worktrees` prunes merged ones.

**Why:** sessions overlap. Work is routinely in flight on several branches at once
(WhatsApp fixes landing while a facts slice is being measured), and a shared checkout
makes them collide — one session's `git checkout` silently changes the code another
session is measuring, and a dirty tree sweeps unrelated files into the wrong commit.
Isolation makes the conflict impossible rather than merely detectable (Rule 14,
prevention over detection).

Rules that follow from it:

1. **Never `git checkout`, `git stash`, or `npm install` in the main checkout.** A branch
   switch there has produced a false E2E red and a failed pre-deploy. If pre-deploy says
   «package-lock.json is out of sync», that message is **misleading** — it means
   `node_modules`, and the fix is a plain `npm install` on main, never regenerating the lock.
2. **Verify the base ref before writing code.** `worktree.baseRef` may be `head`, which
   silently inherits someone's uncommitted work:
   `git merge-base --is-ancestor HEAD origin/main && echo ok`. Fix with
   `git reset --hard origin/main` while the worktree is still empty.
3. **After creating the worktree: `npm install`, then `cd packages/shared && npm run build`.**
   A fresh worktree has no `node_modules`, and a stale `dist/` silently breaks the backend
   while your changes appear to do nothing. Skip only for docs-only changes.

   **A fresh worktree also has NO `.env` files** — they are gitignored, so `backend/.env`,
   `ai-worker/.env` and `frontend/.env.local` do not come with it. Copy them from the main
   checkout before running anything locally. Without `backend/.env` the backend starts and
   then fails on the first DB call; without `frontend/.env.local` the frontend builds but
   every `NEXT_PUBLIC_*` is missing. (Same class as the missing `node_modules` and the
   missing `GoogleService-Info.plist` on iOS builds.)
4. **One worktree, one purpose.** Check `git status --short` before committing and leave
   out anything that was already there; say so explicitly in the summary.
5. **Dev servers: give each worktree its own ports** — two checkouts on one port silently
   measure each other's code. The defaults above (backend 3000, frontend 3001, ai-worker
   3002) belong to whichever checkout binds them first, and on this machine 3000/3001 are
   frequently taken by an unrelated dev server, so check
   `lsof -iTCP:<port> -sTCP:LISTEN` before binding and never kill what you find. A worktree
   runs on its own: `PORT=3100` for the backend, 3005 for the ai-worker, and the frontend
   must be pointed at it with `NEXT_PUBLIC_API_URL=http://localhost:3100`. ⚠️ **3100/3005 are
   only a convention, not a reservation** — a second concurrent worktree finds them taken
   (2026-08-10) and must move up a band (3200/3201/3202) rather than reclaim them. The
   backend serves routes at the ROOT locally, so the URL carries **no `/api` suffix**; that
   prefix exists only because nginx adds it in production.

   ⚠️ **The local dev database is SHARED by every worktree, and it drifts.** It is maintained
   with `drizzle-kit push`, which writes no `__drizzle_migrations` journal entries — so its
   journal lags while its schema runs ahead, and `npm run db:migrate` therefore FAILS on it
   ("column … already exists"). On 2026-08-10 it was nine columns behind the code and demo
   login died on `column "like_comments" does not exist` — which looks like a broken login,
   not a stale database. The symptom to recognise: the request DOES reach the backend and
   fails there with a `PostgresError`, so read the backend log before touching the frontend.
   ⛔ Do **not** answer `drizzle-kit push`'s prompts blind — it asks about TABLE conflicts,
   which is the class that can propose a drop or a rename on a box holding your fixtures.
   Reconcile ADDITIVELY instead: diff the code's columns against `information_schema.columns`
   and `ADD COLUMN IF NOT EXISTS` the missing ones as nullable. Never drop, rename, or retype.
6. **A fresh worktree can fail suites you never touched** — an independent install can
   hoist a second copy of a framework (React → `Cannot read properties of null (reading
   'useEffect')`). Check `git diff --stat` first; if your change doesn't touch that
   workspace, it's an install artifact — say so rather than claiming a false green.

### 19. Reply-Touching Changes Must Be Mirrored in the Eval

Any change that can alter what a customer receives as a reply — the ai-worker prompt
(static prefix or dynamic blocks), reply generation (`generator.ts`,
`messageProcessor.ts`, `commentProcessor.ts`), language resolution, intent/flag/
confidence handling, reply caching — must land **in the same PR** with its mirror
in the eval:

1. **Every behavior change gets an eval case.** A new behavior → a case that pins
   it (prod replays are the gold standard: the real conversation, the real page
   fixture). A bug fix → a case that failed before the fix and passes after. A
   known-open gap → an `expectedFail` (XGAP) case, so the gap is documented by a
   running test instead of rotting on a branch.
2. **The eval harness must exercise the SAME code as production.** The playground
   path (`generateForPlayground`) shares production logic through single choke
   points (`computeReplyFlags`, `resolveDmLanguageHint`). Never re-implement or
   fork production reply logic inside the playground/eval path — extract a shared
   function both paths call. Precedent (2026-08-01): defer-to-history language
   logic landed only on the production path; the playground drifted, asserted the
   Latin-floor language explicitly, and "reproduced" an English-reply bug that
   production never had — a real investigation wasted on a broken measuring stick.
3. **Tests import production predicates — never copy them.** A test that inlines a
   production expression drifts silently when the expression changes
   (`deferToHistory.test.ts` did exactly this until 2026-08-01; it now calls
   `resolveDmLanguageHint` directly).

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

> **Backend integration tests:** run `cd backend && npm run test:integration:local`. It
> forces `DATABASE_URL` at **this checkout's own** test DB on `localhost:5433` — the name is
> `autoreply_test_<checkout>_<hash>`, printed by `npm run print:test-db-url`
> (`scripts/test-db-url.sh`). Override the server with `TEST_PG_HOST` / `TEST_PG_PORT`, or the
> whole URL with `TEST_DATABASE_URL` — but note that override is **not** unrestricted: whatever
> it names must still match `^autoreply_test[a-z0-9_]*$`, because that rule
> (`scripts/testDatabaseName.mjs`) is the single guard standing between the suite's per-test
> TRUNCATE and, say, the dev database. That also stops a stray `DATABASE_URL` from your shell or
> `backend/.env` (which points at the dev DB on 5432) from making the suite migrate/mutate the
> wrong database. The DB is created on first run by `test/integration/globalSetup.ts`; add
> `TEST_DB_FRESH=1` to drop and recreate it, which you want after moving a worktree between
> branches with divergent migrations. Plain `npm run test:integration` is the CI variant and
> trusts the ambient `DATABASE_URL`; with none set it now fails fast instead of silently
> falling back to a shared database.
>
> ⚠️ **Why the name is per-checkout (2026-08-09).** It used to be one machine-global
> `autoreply_test`. `test/integration/setup.ts` TRUNCATEs ~20 tables **before every test**, so
> two suites running at once — a deploy gate in the main checkout and a `test:integration:local`
> in any worktree — delete each other's fixtures. That produced a **false red** in the deploy
> gate: 29 failures across 13 files, all rows-vanishing-mid-test, ending in a FK violation on
> `workspaces.owner_id` because the other run had just truncated `users`. The same overlap also
> killed an earlier gate run outright, since Postgres refuses `DROP DATABASE` while another
> session is connected. The gate's lock is per-checkout and a bare `test:integration:local`
> takes no lock at all, so isolating the database — not locking — is the fix. ⛔ Do **not**
> "solve" a blocked drop with `DROP DATABASE ... WITH (FORCE)`: that makes your run succeed by
> force-terminating someone else's suite.
>
> Each checkout that runs integration tests leaves one `autoreply_test_*` database (~16 MB)
> behind, and deleting a worktree does not remove its database — with 100+ worktrees on this
> host that is a real disk leak. `globalSetup.ts` records the owning checkout path in the
> database's `COMMENT`, so pruning is mechanical rather than guesswork:
>
> ```bash
> npm run prune:test-dbs             # report: live / orphaned / unknown owner
> npm run prune:test-dbs -- --drop   # drop the ones whose checkout no longer exists
> ```
>
> A database with no recorded owner is reported and never dropped — guessing is how you delete
> something that mattered. It never uses `WITH (FORCE)` either: a blocked `DROP` means something
> is still attached, and that is a signal, not an obstacle.
>
> The pre-2026-08-09 shared `autoreply_test` was deleted on 2026-08-10 — there is no legacy
> database to keep in step with. If it reappears, some checkout still predates this change and
> its `test:integration:local` recreated it; rebase that checkout rather than keeping the
> database alive.

For Shopify integration tests, AI eval, mobile builds, Android releases, and in-browser QA loops (console/network/RTL/i18n checks via Chrome DevTools MCP) — see the `/shopify-dev`, `/eval`, `/build-mobile`, `/release-android`, and `/qa` skills.

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

> **⛔ We do NOT use the GitHub Actions CI path (owner ruling, reaffirmed 2026-08-05).**
> The deploy gate is `./scripts/deploy-production.sh`, whose `scripts/pre-deploy-check.sh`
> runs the same path as CI locally before any deploy: config/translations/sitemap checks,
> lockfile sync, dependency audit, shared-package build, `tsc`, lint, schema-drift and
> code-quality checks, unit tests ×3 packages (with coverage thresholds), backend
> integration tests, and the full Playwright E2E suite (which includes the SEO regression
> spec). A red GitHub check therefore says nothing about a PR — CI has been broken
> fleet-wide repeatedly (billing outages; as of 2026-08-05, backend `tsc` heap OOM on
> `main` itself). Never block a merge on it (`gh pr merge --admin`), never report red CI
> as a blocker, and don't spend time fixing it unless the owner explicitly asks.
> Known gap: Lighthouse runs only in CI, so today it runs nowhere — the §8 rules are
> enforced by review, not by a gate.

**Tier 1 (pre-deploy gate — must pass; run locally by `deploy-production.sh`):** Backend/frontend/AI-worker unit tests (coverage thresholds), backend integration tests, E2E (Playwright, incl. SEO regression), plus lint / `tsc` / schema-drift / dependency-audit checks.

**Tier 2 (Deploy only):** Docker smoke tests, post-deploy health checks, content smoke test.

**Tier 3 (Manual):** `npm run test:ecommerce:shopify`, `npm run test:ecommerce:salla`, `npm run eval` (the AI reply eval suite — 440+ cases in `scripts/playground-eval.ts`). Use skills for setup.

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
| Editing code in `~/Documents/AutoReply` | `EnterWorktree` first — one session, one worktree (Rule 18) |
| Designing a new app→browser→Meta bridge | Read the working Facebook page-connect flow first (Rule 17b) — the tab must START at facebook.com, and the App Link return must be navigated by a PAGE, not a 302 |
| "a Chrome user-agent in the logs means Chrome opened" | A Custom Tab is identical in logs — mark degradation in-band (Rule 17b) |
| `git checkout` / `npm install` in the main checkout | Never — it breaks whatever another session is measuring |

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
