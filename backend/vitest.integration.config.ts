import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Migrations run exactly once via globalSetup (before any fork spawns).
    globalSetup: ['./test/integration/globalSetup.ts'],
    // Per-file setup: truncate tables, export helpers.
    setupFiles: ['./test/integration/setup.ts'],
    // Serialize: all integration tests share one Postgres database.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
