/**
 * Vitest globalSetup — runs exactly once before all integration test files.
 *
 * Responsibilities:
 *   1. Create the test database if it does not exist yet.
 *   2. Apply Drizzle migrations to the test database.
 *
 * This runs in the main vitest process (not inside forks), so there is zero
 * risk of migration races regardless of pool/parallelism settings.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'path';

// No default. The test database name is per-checkout (scripts/test-db-url.sh),
// so there is no single correct value to fall back to — and the old fallback
// silently pointed every entry point at one shared `autoreply_test`, which is
// exactly the collision this setup now prevents. Fail fast instead.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error(
        'DATABASE_URL is not set. Run integration tests with `npm run test:integration:local` ' +
            '(it resolves this checkout\'s test database via scripts/test-db-url.sh), or export ' +
            'DATABASE_URL yourself.',
    );
}

/**
 * Creates the test database when it is missing, so a fresh checkout or worktree
 * can run the suite without a manual setup step.
 */
async function ensureDatabaseExists(url: string): Promise<void> {
    const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

    // CREATE DATABASE cannot be parameterized, so the name is interpolated. Only
    // ever interpolate a name we generated ourselves — this also stops the suite
    // from creating (and later truncating) something like the dev database.
    if (!/^autoreply_test[a-z0-9_]*$/.test(dbName)) {
        throw new Error(
            `Refusing to use "${dbName}" as an integration-test database: the name must ` +
                'start with autoreply_test. Integration tests TRUNCATE every table they touch.',
        );
    }

    const adminUrl = new URL(url);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1 });

    try {
        const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
        if (existing.length === 0) {
            await admin.unsafe(`CREATE DATABASE "${dbName}"`);
            console.log(`✅ Created test database ${dbName}`);
        }
    } catch (error) {
        // 42P04 = duplicate_database: another process won the race between the
        // existence check and CREATE. That is the desired end state either way.
        if ((error as { code?: string }).code !== '42P04') throw error;
    } finally {
        await admin.end();
    }
}

export async function setup() {
    const migrationsFolder = path.resolve(__dirname, '../../migrations');

    await ensureDatabaseExists(connectionString);

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
