import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // jsdom's default document origin is http://localhost:3000 — the port a Next
    // dev server owns on a developer machine (see AI_INSTRUCTIONS Rule 18.5).
    // Any test that lets a relative-URL request through resolves it against this
    // origin and really issues it, so the suite's outcome depended on whether a
    // dev server happened to be running: nothing listening → instant
    // ECONNREFUSED and green; dev server listening → the request is accepted and
    // never answered, and the test burns the full 20s timeout (five reds in
    // `test:coverage`, 2026-08-04). Pin an origin nothing binds, so a stray
    // request always fails fast instead of hanging on someone else's server.
    // Host stays `localhost`: production code branches on
    // `window.location.hostname === 'localhost'` (login.tsx, pages.tsx,
    // auth/callback.tsx) to pick the dev OAuth origin.
    environmentOptions: { jsdom: { url: 'http://localhost:59999/' } },
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // V8 coverage instrumentation slows tests ~20×, making the 5s default
    // flake on fast tests during `test:coverage`. 20s is well clear of real
    // hangs while absorbing the instrumentation overhead.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'test/',
        // Shared test scaffolding (factories, ui mocks) — exercised BY tests,
        // not product code, so it must not inflate src coverage numbers.
        'src/__tests__/testUtils/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
      ],
      thresholds: {
        // Global thresholds — set ~3–5 points below current actuals.
        // They pass today and fail if coverage regresses significantly.
        // Frontend coverage is lower because many pages/components are
        // covered by E2E + visual regression tests rather than unit tests.
        // Recalibrated for @vitest/coverage-v8 3.x (V8 coverage engine change).
        statements: 35,
        branches: 70,
        functions: 37,
        lines: 35,

        // Per-folder gates for critical code paths.
        // These prevent backsliding on well-tested areas.
        'src/lib/': {
          statements: 58,
          branches: 85,
          functions: 30,
          lines: 58,
        },
        'src/hooks/': {
          statements: 75,
          branches: 74,
          functions: 76,
          lines: 75,
        },
        'src/i18n/': {
          statements: 57,
          branches: 95,
          functions: 62,
          lines: 57,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

