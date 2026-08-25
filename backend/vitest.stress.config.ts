import { defineConfig } from 'vitest/config';

/**
 * Tier-4 stress suite — deliberately OUT of the pre-deploy gate.
 *
 * `docs/SALLA_TEST_PLAN.md` Tier 4 carries a standing rule: ⛔ never load-test a
 * partner's API. Everything here therefore hammers OUR side — real Postgres, real
 * Redis, mocked platform HTTP — and answers "does our code hold at volume", not
 * "does Salla's API hold".
 *
 * It is opt-in (`npm run test:stress:local`) because it is slow by construction:
 * it drives thousands of rows and hundreds of concurrent operations, which is the
 * point, and which is exactly what a deploy gate must not wait on.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/stress/**/*.test.ts'],
    // Stress scenarios push far more rows than an integration test; a cap-sized
    // catalog sync alone writes PRODUCT_SAFETY_CAP rows.
    testTimeout: 180000,
    hookTimeout: 120000,
    globalSetup: ['./test/integration/globalSetup.ts'],
    setupFiles: ['./test/integration/setup.ts'],
    // Same reason as the integration config: one shared Postgres database.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
