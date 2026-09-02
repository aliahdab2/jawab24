import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./test/setup.ts'],
        // Matches backend/vitest.config.ts (frontend uses 20000). ai-worker was
        // the only workspace left on vitest's 5000ms DEFAULT — nobody chose it,
        // and that made the deploy gate flaky rather than the code slow:
        // `server.test.ts` calls vi.resetModules() in beforeEach, so every test
        // there re-imports the whole src/server graph (fastify + cors +
        // rate-limit + the app). That costs ~1s on an idle machine and >5s when
        // the host is loaded — a pre-deploy run competing with a Docker build
        // measured 5233ms and failed the gate on green code. Verified the same
        // test fails identically on fastify 5.8.5 and 5.12.1, so the cost is the
        // cold import, not any one dependency.
        testTimeout: 15000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
            thresholds: {
                statements: 70,
                branches: 60,
                functions: 65,
            },
        },
    },
});
