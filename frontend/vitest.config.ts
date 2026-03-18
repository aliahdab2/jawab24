import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'test/',
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

