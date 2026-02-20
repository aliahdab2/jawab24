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
    // In CI, use next dev since 'next start' doesn't work with output: 'standalone'
    // The production build is validated separately via the Docker build step
    command: 'npm run dev',
    // Use url (not port) so Playwright waits for an actual HTTP response — this ensures
    // the dev server has finished its initial compilation before any tests run.
    url: 'http://localhost:3001/en/login',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
});
