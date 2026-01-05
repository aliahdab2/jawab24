import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
    schema: './src/db/schema.ts',
    out: './migrations',
    driver: 'pg',
    dbCredentials: {
        connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/jawab24',
    },
    // Ensure migrations are verbose
    verbose: true,
    // Strict mode - fail on breaking changes
    strict: true,
});
