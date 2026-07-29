import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    actionTimeout: 0,
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    // Pin the browser's zone. `freezeDate` (visual.spec.ts) already pins the
    // INSTANT; without pinning the ZONE too, anything rendering a timezone or a
    // local time differs per machine — a visual snapshot then encodes whoever
    // last regenerated it (this repo: Europe/Stockholm locally vs UTC on a CI
    // runner) and fails everywhere else. Settings → General displays the
    // workspace zone, falling back to the DEVICE zone when none is stored
    // (resolveStoredTimezone), so that card put a machine-dependent string
    // straight into a snapshotted viewport.
    // Asia/Riyadh = PLACEHOLDER_TIMEZONE, i.e. what a merchant who never chose
    // one actually sees in production.
    timezoneId: 'Asia/Riyadh',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Mobile portrait — visual regression + public page layout tests only.
      // Complex functional tests (mocked API flows) stay in chromium
      // since they test business logic, not mobile-specific layout.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: [
        'visual.spec.ts',
        'landing.spec.ts',
        'login.spec.ts',
        'ssr.spec.ts',
        'seo.spec.ts',
        'keyboard-modal-layout.spec.ts',
      ],
    },
    {
      name: 'mobile-chrome-landscape',
      use: { ...devices['Pixel 7 landscape'] },
      testMatch: [
        'visual.spec.ts',
        'landing.spec.ts',
        'login.spec.ts',
        'ssr.spec.ts',
        'seo.spec.ts',
      ],
    },
  ],
  webServer: {
    // CI: use standalone server (output: 'standalone' in next.config.js).
    // `next start` does NOT work with standalone — must use the standalone server.js.
    // Monorepo layout puts it at .next/standalone/frontend/server.js.
    // Local: use dev server (reuseExistingServer reuses whatever is on :3001).
    command: process.env.CI ? 'PORT=3001 node .next/standalone/frontend/server.js' : 'npm run dev',
    url: 'http://localhost:3001/en/login',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
    // Dev mode: forces getStaticProps fallback. Prod mode: data baked in at build time.
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:4999/api',
      // Stable test secret so /api/revalidate has a known shared key during E2E.
      REVALIDATE_SECRET: process.env.REVALIDATE_SECRET || 'e2e-revalidate-secret',
      // WhatsApp OFF, pinned rather than inherited — same reason test/setup.ts pins
      // it for the unit suite. `isWhatsAppEnabled()` is
      // `!!NEXT_PUBLIC_FB_APP_ID && !!NEXT_PUBLIC_WHATSAPP_CONFIG_ID`, and when it
      // flips true the nav/page title renames "My Pages" → "Channels", so six specs
      // that assert the former label go red. That happened on 2026-07-29 the moment
      // those vars were added to .env.local for an Android build: the suite had been
      // green only because the ambient environment happened to lack them.
      //
      // KNOWN GAP, deliberately left: prod runs with WhatsApp ON, so these specs now
      // assert a label real users may not see. Pinning makes the suite deterministic;
      // deciding whether E2E should instead mirror prod (assert "Channels", flags on)
      // depends on NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY and is a product call.
      //
      // Note this only bites when Playwright STARTS the server. Locally
      // `reuseExistingServer` is true, so a dev server already on :3001 keeps its own
      // env — check `lsof -iTCP:3001` before trusting a local run.
      NEXT_PUBLIC_FB_APP_ID: '',
      NEXT_PUBLIC_WHATSAPP_CONFIG_ID: '',
    },
  },
});
