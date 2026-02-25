/**
 * Vitest globalSetup — runs exactly once before all integration test files.
 *
 * Responsibilities:
 *   1. Apply Drizzle migrations to the test database.
 *
 * This runs in the main vitest process (not inside forks), so there is zero
 * risk of migration races regardless of pool/parallelism settings.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'path';

const connectionString =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/autoreply_test';

export async function setup() {
    const migrationsFolder = path.resolve(__dirname, '../../migrations');
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);

    try {
        await migrate(db, { migrationsFolder });
        console.log('✅ Test database migrations applied');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await client.end();
    }
}
