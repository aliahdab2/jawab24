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
    },
  },
});
