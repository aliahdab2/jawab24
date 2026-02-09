import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./test/integration/setup.ts'],
    // Serialize test files — they share one Postgres database and truncate between tests.
    threads: false,
  },
});
