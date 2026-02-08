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
        connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/autoreply_test',
    },
    verbose: false,
    strict: false,
});
