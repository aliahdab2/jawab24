/**
 * Vitest globalSetup — runs exactly once before all integration test files.
 *
 * Responsibilities:
 *   1. Create the test database if it does not exist yet.
 *   2. Record which checkout owns it, so stale ones can be pruned mechanically.
 *   3. Optionally recreate it from scratch (TEST_DB_FRESH=1).
 *   4. Apply Drizzle migrations to the test database.
 *
 * This runs in the main vitest process (not inside forks), so there is zero
 * risk of migration races regardless of pool/parallelism settings.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'path';
import fs from 'fs';
import {
    assertTestDatabaseName,
    databaseNameFromUrl,
} from '../../../scripts/testDatabaseName.mjs';

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

/** Absolute, symlink-resolved path of this checkout — matches scripts/test-db-url.sh's `pwd -P`. */
const repoRoot = fs.realpathSync(path.resolve(__dirname, '../../..'));

/**
 * Creates the test database when it is missing, so a fresh checkout or worktree
 * can run the suite without a manual setup step.
 *
 * With TEST_DB_FRESH=1 the database is dropped first. Per-checkout databases are
 * long-lived and `migrate()` is journal-driven and additive, so a worktree that
 * has been moved between branches accumulates objects the current branch never
 * created. The deploy gate always starts clean; this is the same escape hatch for
 * a hand-run suite. It deliberately does NOT force-terminate other sessions —
 * a blocked DROP is a real signal that something else is using the database.
 */
async function ensureDatabaseExists(url: string): Promise<void> {
    const dbName = databaseNameFromUrl(url);

    // CREATE/DROP DATABASE cannot be parameterized, so the name is interpolated.
    // The shared validator is what makes that safe, and it is the same rule the
    // deploy gate applies before its own DROP — see scripts/testDatabaseName.mjs.
    assertTestDatabaseName(dbName, 'create an integration-test database named');

    const adminUrl = new URL(url);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1 });

    try {
        if (process.env.TEST_DB_FRESH === '1') {
            await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
            console.log(`🧹 Dropped test database ${dbName} (TEST_DB_FRESH=1)`);
        }

        const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
        if (existing.length === 0) {
            await admin.unsafe(`CREATE DATABASE "${dbName}"`);
            console.log(`✅ Created test database ${dbName}`);
        }

        // Record the owning checkout so scripts/prune-test-dbs.sh can tell a live
        // database from one whose worktree was deleted. The name carries a hash of
        // the path, not the path itself, so without this the mapping is unrecoverable.
        await admin.unsafe(
            `COMMENT ON DATABASE "${dbName}" IS ${escapeLiteral(repoRoot)}`,
        );
    } catch (error) {
        // 42P04 = duplicate_database: another process won the race between the
        // existence check and CREATE. That is the desired end state either way.
        if ((error as { code?: string }).code !== '42P04') throw error;
    } finally {
        await admin.end();
    }
}

/** Single-quoted SQL literal with embedded quotes doubled (Postgres escaping). */
function escapeLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
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
