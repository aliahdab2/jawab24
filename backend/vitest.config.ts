import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
    // Coverage instrumentation can slow tests ~3-10x; default 5s timeout is
    // too tight for some heavier suites (instagramReply takes ~4.5s under coverage).
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        // Infrastructure & entry-point files (not unit-testable)
        'src/index.ts',
        'src/migrate.ts',
        'src/db/index.ts',
        'src/plugins/swagger.ts',
        // Pure type/interface declarations (no runtime code)
        'src/interfaces/**',
        'src/types/fastify.d.ts',
        'src/types/auth.ts',
        'src/types/common.ts',
        'src/types/facebook.ts',
        'src/types/instagram.ts',
        'src/types/payment.ts',
        'src/types/settings.ts',
        'src/services/kb/interfaces.ts',
        // KB infrastructure (requires OpenAI API / pgvector extension)
        'src/services/kb/embedding.ts',
        'src/services/kb/pgvector-store.ts',
        // BullMQ queue/worker setup (requires Redis connection)
        'src/lib/ecommerceSyncQueue.ts',
        'src/workers/ecommerceSyncWorker.ts',
        // Deprecated re-export shims
        'src/lib/shopifySyncQueue.ts',
        'src/workers/shopifySyncWorker.ts',
        // One-off ops/backfill scripts (run manually post-deploy, not unit-testable)
        'src/scripts/**',
      ],
      thresholds: {
        // Thresholds are set ~3–5 points below current actuals.
        // They pass today and fail if coverage regresses significantly.
        statements: 80,
        branches: 75,
        functions: 70,
        lines: 80,
      },
    },
  },
});

