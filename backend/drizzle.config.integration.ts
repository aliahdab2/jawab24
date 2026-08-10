import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle config for integration tests.
 * Same schema as production but without strict mode (no interactive prompts).
 */
export default defineConfig({
    schema: './src/db/schema.ts',
    out: './migrations',
    driver: 'pg',
    dbCredentials: {
        // No hardcoded fallback: the test database name is per-checkout, resolved
        // by scripts/test-db-url.sh. Export DATABASE_URL before running drizzle-kit
        // against a test database — e.g. DATABASE_URL=$(../scripts/test-db-url.sh).
        connectionString: process.env.DATABASE_URL || '',
    },
    verbose: false,
    strict: false,
});
