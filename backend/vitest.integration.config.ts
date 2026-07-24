import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    // Same deploy-time contention rationale as hookTimeout below: a real-Postgres
    // test that runs ~7s in isolation can exceed 30s when the deploy runs this
    // 300+ test suite WHILE building Docker images and running Playwright E2E on
    // the same host. 60s absorbs the contention without masking a real hang
    // (isolated runs stay well under 30s). Caught 2026-07-24: comment-pipeline
    // "different senders" timed out at 30s mid-deploy, passed at 7.5s in isolation.
    testTimeout: 60000,
    // The beforeEach TRUNCATE cascades across ~20 tables and can exceed 30s under
    // the same contention, causing flaky pre-deploy failures. 60s gives the
    // truncate headroom without masking a real hang. See test/integration/setup.ts.
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
