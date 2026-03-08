import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    actionTimeout: 0,
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // CI: use production server (next start) — no HMR/Fast Refresh, so .next files
    // are never rewritten mid-test (eliminates ENOENT race conditions).
    // Local: use dev server (reuseExistingServer reuses whatever is on :3001).
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: 'http://localhost:3001/en/login',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
    // Dev mode: forces getStaticProps fallback. Prod mode: data baked in at build time.
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:4999/api',
    },
  },
});
