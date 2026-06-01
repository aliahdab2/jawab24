import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30000,
    // The beforeEach TRUNCATE cascades across ~20 tables and can exceed 30s under
    // deploy-time resource contention (the deploy runs this suite WHILE building
    // Docker images), causing flaky pre-deploy failures. 60s gives the truncate
    // headroom without masking a real hang. See test/integration/setup.ts.
    hookTimeout: 60000,
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
