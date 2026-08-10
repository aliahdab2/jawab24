# Testing — Jawab24 Codebase

This document describes the testing architecture, frameworks, and patterns used across the Jawab24 monorepo.

---

## Test Frameworks

### Vitest
- **Unit & Integration Testing**: Vitest 3.0.0 with jsdom (frontend) and node (backend)
- **Configuration**:
  - Frontend: `frontend/vitest.config.ts` (jsdom environment)
  - Backend: `backend/vitest.config.ts` (node environment)
  - AI Worker: `ai-worker/vitest.config.ts` (node environment)
- **Setup Files**:
  - Frontend: `frontend/test/setup.ts` (mocks next-intl, router, translations, browser APIs)
  - Backend: `backend/test/setup.ts` (mocks database)

### Playwright
- **E2E Testing**: Playwright 1.58.1 (chromium only)
- **Configuration**: `frontend/playwright.config.ts`
- **Test Files**: `frontend/e2e/<feature>.spec.ts`
- **Server**: Reuses local dev server in local mode, spins up standalone in CI

### Testing Library
- **Frontend**: `@testing-library/react` for component testing
- **Queries**: Prefer accessible queries (`getByRole`, `getByLabelText`) over `getByTestId`

---

## Test Structure

| Type | Location | Command | Coverage | Runs |
|------|----------|---------|----------|------|
| **Unit Tests** | `frontend/src/**/*.test.{ts,tsx}`, `backend/src/**/*.test.ts` | `npm run test` | Thresholds: 35% stmts (frontend), 80% stmts (backend) | On push, PR, CI |
| **Hook Tests** | `frontend/src/hooks/*.test.ts` | `npm run test` | 75% (hooks folder) | On push, PR, CI |
| **Service Tests** | `backend/src/services/**/*.test.ts` | `npm run test` | 80% (statements/lines) | On push, PR, CI |
| **Middleware Tests** | `backend/test/middleware/*.test.ts` | `npm run test` | Part of 80% threshold | On push, PR, CI |
| **Integration Tests** | `backend/test/integration/**` | `npm run test:integration:local` | Separate from unit (not in CI) | Manual / pre-deploy |
| **E2E Tests** | `frontend/e2e/*.spec.ts` | `npm run test:e2e` | N/A (behavioral) | On push, PR, CI |
| **SEO Tests** | `frontend/e2e/seo.spec.ts` | `npm run test:e2e -- e2e/seo.spec.ts` | 39 tests for meta/structured data | On push, PR, CI |

---

## Unit Tests

### Frontend Unit Tests

**Location**: `frontend/src/**/*.test.ts` or `frontend/test/`

**Setup (`frontend/test/setup.ts`):**
- Mocks next-intl with real English translations (loaded from JSON files)
- Mocks Next.js router
- Mocks browser APIs (`matchMedia`, `IntersectionObserver`, etc.)
- Suppresses expected jsdom noise (network errors, navigation warnings)

**No unit test may talk to the network — two rules, both learned the hard way:**

1. **Never hand production code a real `axios.create()`.** Mocking `.post` is not
   enough: interceptors also call the instance *as a function* to retry a request
   (`axiosInstance(originalRequest)`), and that call stays live. Use the shared
   callable double instead — `createMockAxios()` from
   `frontend/src/__tests__/testUtils/mockAxios.ts`, which exposes `instance`,
   `post`, `retry`, `use` and the captured `response.onFulfilled/onRejected`.
   Use `axios-mock-adapter` (as `axiosRetry.test.ts` does) only when a test
   genuinely needs real axios behaviour end to end.
2. **The jsdom origin is pinned to `http://localhost:59999`** in
   `frontend/vitest.config.ts`. jsdom's default is `localhost:3000` — the port a
   Next dev server owns locally — so a stray relative-URL request used to be
   answered by whatever was running, and the suite's result depended on it: green
   when nothing listened (instant ECONNREFUSED), 20s-timeout reds when a dev
   server did. Keep the host `localhost`; production code branches on
   `hostname === 'localhost'` for dev OAuth origins.

```typescript
// Loads real English translations for accurate UI text verification
const enModules = import.meta.glob('../src/i18n/en/*.json', { eager: true });
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => {
    return (key: string, params?: Record<string, unknown>) => {
      // Returns actual translation value or 'namespace.key' fallback
    };
  },
  useLocale: () => 'en',
}));
```

**Example: Hook Test**
```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAiGeneration } from './useAiGeneration';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  subscriptionApi: { checkAiLimit: vi.fn() },
  aiApi: { generateAsync: vi.fn(), getJobStatus: vi.fn() },
}));

describe('useAiGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (subscriptionApi.checkAiLimit as any).mockResolvedValue({
      data: { allowed: true },
    });
  });

  it('fetches limits on mount by default', async () => {
    renderHook(() => useAiGeneration());

    await waitFor(() => {
      expect(subscriptionApi.checkAiLimit).toHaveBeenCalledTimes(1);
    });
  });

  it('returns initial state correctly', () => {
    const { result } = renderHook(() => useAiGeneration({ fetchLimitsOnMount: false }));

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.aiLimit).toEqual({ allowed: true });
  });
});
```

**Example: Component Test**
```typescript
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('applies className', () => {
    const { container } = render(<Card className="custom">Content</Card>);
    const card = container.querySelector('.custom');
    expect(card).toBeInTheDocument();
  });
});
```

### Backend Unit Tests

**Location**: `backend/src/**/*.test.ts` or `backend/test/`

**Setup (`backend/test/setup.ts`):**
- Mocks the database module before any services import
- Provides chainable mock objects for Drizzle ORM queries
- Sets test environment variables

```typescript
// Mocks Drizzle ORM to prevent actual DB calls
vi.mock('../src/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
      }),
    }),
    transaction: vi.fn(async (fn: Function) => fn({...mockDb})),
  },
}));
```

**Example: Middleware Test**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticate } from '../../src/middleware/auth';
import { authService } from '../../src/services/auth';

vi.mock('../../src/services/auth');

describe('Authenticate Middleware', () => {
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    mockRequest = { headers: {}, cookies: {}, log: { error: vi.fn() } };
    mockReply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    vi.clearAllMocks();
  });

  it('should authenticate with valid signed cookie', async () => {
    const validToken = 'valid.jwt.token';
    mockRequest.cookies.token = 'signed.token';
    mockRequest.unsignCookie.mockReturnValue({ valid: true, value: validToken });

    vi.mocked(authService.verifyToken).mockReturnValue({
      userId: 'user-123',
      facebookId: 'fb-123',
    });

    await authenticate(mockRequest, mockReply);

    expect(mockRequest.user).toEqual({ userId: 'user-123', facebookId: 'fb-123' });
  });
});
```

**Example: Service Test**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messagesService } from '../../src/services/messages';
import { db } from '../../src/db';

vi.mock('../../src/db');

describe('MessagesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getMessages returns paginated results', async () => {
    const mockMessages = [
      { id: '1', message: 'Hello', createdAt: new Date() },
    ];
    vi.mocked(db.query.messages.findMany).mockResolvedValue(mockMessages);

    const result = await messagesService.getMessages('workspace-1');

    expect(result.data).toEqual(mockMessages);
    expect(result.pagination.hasMore).toBe(false);
  });
});
```

---

## E2E Tests

### Playwright Configuration

**File**: `frontend/playwright.config.ts`
```typescript
export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  webServer: {
    command: process.env.CI
      ? 'PORT=3001 node .next/standalone/frontend/server.js'
      : 'npm run dev',
    url: 'http://localhost:3001/en/login',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
});
```

**Key Points:**
- Spins up Next.js dev server locally (reuses if already running)
- Uses standalone server in CI (`.next/standalone/frontend/server.js`)
- Retries twice on CI, zero retries locally (per `retries: process.env.CI ? 2 : 0`)
- HTML reports in `playwright-report/`; trace artifacts in `test-results/`

### Test Files

**Location**: `frontend/e2e/<feature>.spec.ts`

**List of E2E Test Files** (all in `frontend/e2e/`):
- `comments.spec.ts` — Comment listing, filtering, replying, resolution
- `complete-profile.spec.ts` — Profile completion onboarding flow
- `checkout.spec.ts` — Stripe Embedded Checkout (PaymentElement, monthly + yearly)
- `dashboard.spec.ts` — Dashboard stats, needs-attention list
- `integrations.spec.ts` — E-commerce integration listing (Shopify, Salla, Zid)
- `landing.spec.ts` — Landing page content, responsive design
- `login.spec.ts` — Login page: Facebook OAuth + Phone OTP tabs
- `messages.spec.ts` — Message listing, pagination, customer context
- `pages.spec.ts` — Page listing, KB gaps, page settings
- `payment.spec.ts` — Payment intent and subscription management
- `payment-flow.spec.ts` — Full checkout + subscription lifecycle
- `pricing.spec.ts` — Pricing page, plan selection
- `rules.spec.ts` — Rule creation, editing, deletion, priority
- `settings.spec.ts` — Workspace settings, business hours, language toggle
- `seo.spec.ts` — 39 tests for canonical URLs, hreflang, OG tags, structured data
- `ssr.spec.ts` — Server-side rendering (public pages render full HTML)
- `team.spec.ts` — Team member invite (email + phone), role management
- `templates.spec.ts` — Template creation, updating, deletion
- `visual.spec.ts` — Visual regression tests (snapshots, macOS baselines only)

### Example E2E Test

```typescript
import { test, expect } from '@playwright/test';

test.describe('Comments Page', () => {
  test('should render comments list', async ({ page }) => {
    // Mock API responses
    await page.route('**/api/comments*', route => {
      route.abort('blockedbyserver');  // Simulate empty response
    });

    await page.goto('/en/comments');

    // Assert UI rendered with empty state
    await expect(page.getByText('No comments')).toBeVisible();
  });

  test('should filter by replied status', async ({ page }) => {
    await page.goto('/en/comments');

    // Click filter button
    await page.getByRole('button', { name: 'Unreplied' }).click();

    // Verify URL updated with filter
    await expect(page).toHaveURL(/replied=false/);
  });

  test('should open comment detail modal', async ({ page }) => {
    await page.goto('/en/comments');

    // Click first comment
    await page.getByRole('button').first().click();

    // Modal appears
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
```

### SEO Test Example

```typescript
import { test, expect } from '@playwright/test';
import enLanding from '../src/i18n/en/landing.json';

test.describe('SEO — Landing Page', () => {
  test('should have canonical URL', async ({ page }) => {
    await page.goto('/en');

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBe('https://jawab24.com/');  // Always root, never /en
  });

  test('should have hreflang links for all languages', async ({ page }) => {
    await page.goto('/en');

    const hreflangs = await page.locator('link[rel="alternate"]').evaluateAll(els =>
      els.map(el => ({ lang: el.getAttribute('hreflang'), href: el.getAttribute('href') }))
    );

    // Both ar and en should be present
    expect(hreflangs.some(h => h.lang === 'ar')).toBe(true);
    expect(hreflangs.some(h => h.lang === 'en')).toBe(true);
  });

  test('should have og:title and og:description', async ({ page }) => {
    await page.goto('/en');

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content');

    expect(ogTitle).toBeTruthy();
    expect(ogDesc).toBeTruthy();
  });

  test('translation file key should match rendered title', async ({ page }) => {
    await page.goto('/en');

    const pageTitle = await page.locator('h1').first().innerText();
    expect(pageTitle).toBe(enLanding.heroTitle);  // Verify actual translated string
  });
});
```

---

## Integration Tests

### Backend Integration Tests

**Location**: `backend/test/integration/`

**Setup:**
- Uses a real PostgreSQL instance — the dev Docker container on `localhost:5433` (not part of
  default PR CI)
- **One database per checkout**, named `autoreply_test_<checkout>_<hash>` and resolved by
  `scripts/test-db-url.sh`. `test/integration/globalSetup.ts` creates it on first run, then
  applies migrations **once** in the main vitest process, before any fork spawns.
- `test/integration/setup.ts` TRUNCATEs ~20 tables before **every** test — which is why the
  database must not be shared between concurrent runs (see the warning below)
- Which databases may be destroyed is decided in exactly one place —
  `scripts/testDatabaseName.mjs` (`^autoreply_test[a-z0-9_]*$`). The deploy gate calls it over
  its `--validate` CLI before `DROP DATABASE`; `globalSetup.ts` and `setup.ts` import it before
  `CREATE DATABASE` and the `TRUNCATE`. Never hand-write a second copy of that rule — a prefix
  glob (`autoreply_test*`) accepts `autoreply_test; DROP DATABASE autoreply`.
- Serialized on purpose: `fileParallelism: false`, `pool: 'forks'`, `singleFork: true`
- NOT included in unit test runs (`npm run test`)

**Running Integration Tests:**
```bash
cd backend
npm run test:integration:local                                        # all files
npm run test:integration:local -- test/integration/messages.test.ts   # one file
npm run test:integration:local -- -t 'isPaused'                       # one test by name
TEST_DB_FRESH=1 npm run test:integration:local                        # drop + recreate first
```

`TEST_DB_FRESH=1` matters because per-checkout databases are long-lived while `migrate()` is
journal-driven and additive: a worktree moved between branches with divergent migrations keeps
objects the current branch never created. The deploy gate always starts from a dropped database;
this is the same clean slate for a hand-run suite.

**Housekeeping:** each checkout leaves one ~16 MB database behind, and deleting a worktree does
not delete its database. `globalSetup.ts` records the owning checkout path in the database
`COMMENT`, so `npm run prune:test-dbs` (add `-- --drop` to act) can reap the ones whose checkout
is gone.

> ⚠️ **Use `test:integration:local`.** Plain `npm run test:integration` is the CI/deploy-gate
> variant: it trusts the ambient `DATABASE_URL` and now **fails fast** when none is set, rather
> than silently falling back to a database shared with every other checkout.
>
> **Why per-checkout (fixed 2026-08-09).** This used to be one machine-global `autoreply_test`.
> Because every test truncates the tables first, two suites running at once — a deploy gate in
> the main checkout and a `test:integration:local` in any worktree — deleted each other's
> fixtures. It produced a **false red** in the gate three separate times; the worst was 29
> failures across 13 files ending in a FK violation on `workspaces.owner_id`, on a commit that
> passes 414/414 in isolation. Full account in `AI_INSTRUCTIONS.md` under *Backend integration
> tests*. ⛔ Never work around a blocked `DROP DATABASE` with `WITH (FORCE)` — that succeeds by
> force-terminating someone else's suite.

**Example: Messages Integration Test**
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db';
import { messagesService } from '../../src/services/messages';
import { messages, pages } from '../../src/db/schema';

describe('MessagesService Integration', () => {
  let pageId: string;

  beforeAll(async () => {
    // Create test page
    const [page] = await db.insert(pages).values({
      workspaceId: 'test-workspace',
      facebookPageId: 'fb-123',
      name: 'Test Page',
    }).returning();
    pageId = page.id;
  });

  it('creates and retrieves message', async () => {
    const dto = {
      pageId,
      facebookMessageId: 'msg-123',
      senderId: 'sender-123',
      message: 'Test message',
    };

    const created = await messagesService.createMessage(dto);
    expect(created.id).toBeTruthy();

    const retrieved = await messagesService.getMessage(created.id);
    expect(retrieved).toMatchObject(dto);
  });

  afterAll(async () => {
    // Cleanup — delete all test data
    await db.delete(messages).where(eq(messages.pageId, pageId));
    await db.delete(pages).where(eq(pages.id, pageId));
  });
});
```

---

## Coverage Configuration

### Frontend Coverage

**File**: `frontend/vitest.config.ts`
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['test/', '**/*.d.ts', '**/*.config.*'],
  thresholds: {
    // Global thresholds — lower because many pages use E2E testing
    statements: 35,
    branches: 70,
    functions: 37,
    lines: 35,

    // Per-folder gates for critical code
    'src/lib/': { statements: 58, branches: 85, functions: 30, lines: 58 },
    'src/hooks/': { statements: 75, branches: 74, functions: 76, lines: 75 },
    'src/i18n/': { statements: 57, branches: 95, functions: 62, lines: 57 },
  },
},
```

**Running Coverage:**
```bash
npm run test:coverage        # Generates HTML report in coverage/
npm run test -- --coverage   # Same as above
```

### Backend Coverage

**File**: `backend/vitest.config.ts`
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: [
    'src/**/*.test.ts',
    'src/index.ts',                    // Entry point
    'src/db/index.ts',                 // DB connection
    'src/services/kb/*.ts',            // Requires OpenAI API
    'src/workers/**/*.ts',             // Requires Redis
    'src/types/**',                    // Type-only files
  ],
  thresholds: {
    statements: 80,
    branches: 75,
    functions: 70,
    lines: 80,
  },
},
```

**Excluded Files Rationale:**
- **Entry points** (`index.ts`) — can't be unit tested in isolation
- **KB services** (`embedding.ts`, `pgvector-store.ts`) — require OpenAI API key
- **Workers** (`replyWorker.ts`) — require Redis connection
- **Pure types** — no runtime code to test

---

## Key Test Patterns

### Pattern 1: Mocking Dependencies

**Frontend Hook Mock:**
```typescript
vi.mock('@/lib/api', () => ({
  commentsApi: {
    getAll: vi.fn(),
    getStats: vi.fn(),
  },
}));

import { commentsApi } from '@/lib/api';

// Use in test
vi.mocked(commentsApi.getAll).mockResolvedValue({
  data: [/* ... */],
  pagination: { hasMore: false, nextCursor: null, limit: 50 },
});
```

**Backend Service Mock:**
```typescript
vi.mock('../../src/services/messages');
import { messagesService } from '../../src/services/messages';

vi.mocked(messagesService.getMessages).mockResolvedValue({
  data: [],
  pagination: { hasMore: false, nextCursor: null, limit: 50 },
});
```

### Pattern 2: Async Rendering (React Testing Library)

```typescript
import { render, screen, waitFor } from '@testing-library/react';

it('loads and displays data', async () => {
  render(<CommentsPage />);

  // Wait for async data to load
  await waitFor(() => {
    expect(screen.getByText('Comment 1')).toBeInTheDocument();
  });
});
```

### Pattern 3: Hook Testing with renderHook

```typescript
import { renderHook, waitFor } from '@testing-library/react';

it('fetches data on mount', async () => {
  const { result } = renderHook(() => useComments());

  expect(result.current.isLoading).toBe(true);

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
    expect(result.current.comments).toHaveLength(2);
  });
});
```

### Pattern 4: E2E Page Navigation

```typescript
test('should navigate between pages', async ({ page }) => {
  await page.goto('/en/comments');
  await expect(page).toHaveURL('/en/comments');

  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL('/en/templates');
});
```

### Pattern 5: E2E API Mocking

```typescript
test('should handle API errors gracefully', async ({ page }) => {
  // Mock API to return 500
  await page.route('**/api/comments*', route => {
    route.abort('failed');
  });

  await page.goto('/en/comments');

  // Expect error message
  await expect(page.getByText('Failed to load comments')).toBeVisible();
});
```

### Pattern 6: Real Translation Verification in E2E

```typescript
import enComments from '../src/i18n/en/comments.json';

test('should use correct translation for title', async ({ page }) => {
  await page.goto('/en/comments');

  const title = await page.locator('h1').innerText();
  expect(title).toBe(enComments.title);  // Verify against actual translation
});
```

---

## CI Integration

### GitHub Actions Workflow

**File**: `.github/workflows/ci.yml`

**Runs on:**
- Every push to any branch
- Every pull request
- Manual trigger via `workflow_dispatch`

**Steps:**
1. **Install dependencies**: `npm ci`
2. **Lint**: `npm run lint` (0 errors, 0 warnings required)
3. **Unit tests**: `npm run test` (all packages)
   - Frontend: 35% statements threshold (E2E covers most UI paths)
   - Backend: 80% statements threshold
   - AI Worker: node environment, no strict threshold
4. **E2E tests**: `cd frontend && npm run test:e2e`
   - Runs all Playwright specs
   - Retries twice on failure
   - Uploads HTML report on failure
5. **Lighthouse CI**: `.lighthouserc.json`
   - Audits `/landing`, `/pricing`, `/login`, `/blog`, `/what-is-jawab24`
   - Hard fails: accessibility < 90, CLS > 0.1
   - Soft warnings: performance < 70, SEO < 80
6. **Integration tests**: Optional (manual trigger or deployment only)

**Pre-Deploy Checks — the actual gate:**

`scripts/pre-deploy-check.sh`, invoked by `./scripts/deploy-production.sh`. It is the **only**
gate that runs; the numbered steps are, in order:

| Step | What it checks |
|------|----------------|
| 0 | Config files, translations, sitemap, `llms.txt` (+ the validator's own tests), lockfile sync, pinned/synced OpenAI SDK, Fastify-5 plugin compatibility, dependency audit, native-binary matrix, cross-file duplication (Rule 10.8) |
| — | `npm run test:db-tooling` — self-tests for the test-database name generator and the shared destroy-guard, run before step 0 so a broken invariant fails in seconds rather than minutes |
| 1 | No ESM-only packages; shared package builds |
| 2 | TypeScript compiles (all workspaces) |
| 3 | Lint — backend, frontend, ai-worker, shared |
| 4 | Duplicate API paths, migration validity, schema drift |
| 5 | Unit tests ×4 workspaces, with coverage thresholds |
| 6 | Drop/recreate this checkout's test database, then backend integration tests |
| 6b | Real Stripe **test-mode** round-trip: subscribe → pay → activate (a missing key is a hard failure, not a skip) |
| 7 | Full Playwright E2E suite, including the SEO regression spec |
| 8 | Docker image builds |

Run it directly with `npm run pre-deploy`.

> ⚠️ Two corrections to older versions of this document. **Lighthouse is not a gate** — it is
> configured only in the GitHub Actions path, which is not used, so today it runs nowhere and
> its thresholds are enforced by review. And nothing "must pass on every PR" via CI: a red
> GitHub check says nothing about a PR. See `AI_INSTRUCTIONS.md` → *Testing Strategy*.

---

## Test Cleanup & Hygiene

### Clearing Mocks Between Tests

```typescript
beforeEach(() => {
  vi.clearAllMocks();  // Clear all mock calls
});

afterEach(() => {
  vi.restoreAllMocks();  // Reset all mocks to original
});
```

### Testing Async Code

```typescript
// Use waitFor for polling/retries
await waitFor(() => {
  expect(result.current.data).toBeDefined();
});

// Use act() for state updates
act(() => {
  result.current.updateData();
});
```

### Avoiding Flaky Tests

**Don't:**
- Use `setTimeout` with arbitrary waits
- Test DOM timing without events
- Depend on external APIs (mock them)

**Do:**
- Use `waitFor` with clear conditions
- Use `userEvent` instead of `fireEvent` for realistic user interaction
- Mock all external dependencies

---

## Running Tests Locally

### Frontend Unit Tests
```bash
cd frontend
npm run test                    # Run all tests
npm run test -- --ui           # Interactive UI mode
npm run test:watch             # Watch mode
npm run test:coverage          # Generate coverage report
```

### Backend Unit Tests
```bash
cd backend
npm run test                    # Run all tests
npm run test:integration:local  # Integration tests (real DB, this checkout's own)
npm run test:watch             # Watch mode
npm run test:coverage          # Generate coverage report
```

### E2E Tests
```bash
cd frontend
npm run test:e2e               # Run all E2E tests
npm run test:e2e:headed        # Watch browser run tests
npm run test:e2e:ui            # Interactive Playwright UI
npm run test:e2e -- --debug    # Step through test
npm run test:e2e:report        # Open HTML report
npm run test:e2e -- e2e/login.spec.ts    # Run single file
npm run test:e2e -- -g "login"           # Run tests matching pattern
```

### AI Eval (Quality Testing)

**Prerequisites:**
- Backend running on port 3000
- AI Worker running on port 3002
- Both with correct environment variables

```bash
# Get admin token
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/demo | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# Run full eval (125 test cases)
ADMIN_TOKEN="$ADMIN_TOKEN" npm run eval

# Run single category (e.g., category 3)
CATEGORY=3 ADMIN_TOKEN="$ADMIN_TOKEN" npm run eval

# Verbose output
VERBOSE=1 ADMIN_TOKEN="$ADMIN_TOKEN" npm run eval

# Control concurrency
CONCURRENCY=5 ADMIN_TOKEN="$ADMIN_TOKEN" npm run eval
```

---

## Test Reporting & Artifacts

### Coverage Reports
- **Frontend**: `frontend/coverage/` (HTML + lcov)
- **Backend**: `backend/coverage/` (HTML + lcov)
- **Location**: `<package>/coverage/index.html` to view

### E2E Test Reports
- **HTML Report**: `frontend/playwright-report/` (auto-generated)
- **Traces/Screenshots**: `frontend/test-results/` (artifacts, only on retry)
- **Traces**: `.zip` files with screenshots/video on retry
- **View**: `npm run test:e2e:report` to open in browser

### CI Artifacts
- **GitHub Actions**: Uploaded as artifacts on test failure
- **Download**: Via GitHub Actions UI → "Artifacts"
- **Contents**: Coverage reports, test reports, trace files

---

## Debugging Tests

### Debugging Frontend Tests

**Using VS Code:**
1. Add breakpoint in test file
2. Run `npm run test -- --inspect-brk`
3. Open `chrome://inspect` in Chrome
4. Click "Inspect" to attach debugger

**Using Vitest UI:**
```bash
npm run test -- --ui
# Opens browser at http://localhost:51204/__vitest__/
```

### Debugging E2E Tests

**Step Through Test:**
```bash
npm run test:e2e -- --debug e2e/login.spec.ts
```

**Watch Browser:**
```bash
npm run test:e2e:headed e2e/login.spec.ts
```

**Inspect Element:**
```typescript
test('inspect element', async ({ page }) => {
  await page.goto('/en/login');
  await page.pause();  // Pauses here, opens inspector
  await expect(page).toHaveTitle('Login');
});
```

### Debugging Backend Tests

**Using Node Inspector:**
```bash
node --inspect-brk ./node_modules/vitest/vitest.mjs run backend/test/setup.test.ts
```

**Using VS Code Debugger:**
1. Add `"args": ["--inspect-brk"]` to `.vscode/launch.json`
2. Set breakpoint in test
3. Run "Debug Jest Tests"

---

## Known Testing Gaps & TODOs

### Visual Regression Testing
- **Status**: Snapshots exist (`e2e/visual.spec.ts`, 12 baselines)
- **Issue**: Only macOS baselines available; CI runs on Linux
- **Impact**: Pixel-level changes not caught in CI
- **Solution**: Add Linux baselines or skip visual tests in CI

### Performance Testing
- **Status**: Lighthouse CI monitors soft thresholds only
- **Issue**: No performance budgets or breakpoint detection
- **Impact**: Regressions visible in reports but don't block merges
- **Solution**: Set hard performance thresholds in `.lighthouserc.json`

### Mobile App E2E
- **Status**: No E2E tests for Capacitor mobile app
- **Issue**: Mobile-specific features (safe areas, native APIs) untested
- **Impact**: Responsive & mobile features rely on manual testing
- **Solution**: Add Appium or Detox tests for Android/iOS

### Accessibility Testing
- **Status**: Lighthouse CI covers WCAG 2.1 AA (>90)
- **Issue**: Only public pages audited; dashboard pages not
- **Impact**: Dashboard accessibility regressions not caught
- **Solution**: Add axe-core tests to E2E suite for all pages

