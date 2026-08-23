/**
 * Regression: the integration suite must hold a BOUNDED number of Postgres
 * connections, independent of how many test files have run.
 *
 * Origin (2026-08-23). `setup.ts` is a `setupFiles` entry, so it executes once
 * per test file with a fresh module instance, and it built a new `postgres()`
 * pool each time with no `idle_timeout` — teardown was a single `beforeExit`
 * handler at the end of the process. Connections therefore accumulated for the
 * whole run: measured peak was 64 of the server's `max_connections = 100` for
 * ONE suite.
 *
 * That is invisible until a second checkout runs its own integration suite at
 * the same time. The per-checkout test databases (2026-08-09) stopped concurrent
 * suites truncating each other's fixtures, but a separate database is the same
 * server and the same 100-connection ceiling. Two suites needed ~128, and a
 * pre-deploy died at file 53 of 55 with `53300 sorry, too many clients already`
 * — reported against `flagMeta.test.ts`, which has nothing to do with the cause.
 *
 * After caching the pool on `globalThis`, the same suite peaks at 21.
 *
 * The assertion below deliberately measures the LIVE server rather than
 * inspecting the client's config: a config assertion would still pass if a
 * future change reintroduced a per-file pool somewhere else.
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb } from './setup';

/**
 * Ceiling for connections this suite holds against its OWN database.
 *
 * Measured peak after the fix is 21–26 across full runs; before it, 64. The
 * ceiling sits at 40 — above the observed range so ordinary variance cannot red
 * it, and far enough below the 64 baseline that a return to per-file pools still
 * trips it. Two concurrent suites at this bound fit under a stock
 * `max_connections = 100`.
 *
 * The remaining ~20 are the app-side pool in `src/db`, which is still built per
 * file but self-drains via its own `idle_timeout: 20`. Bounding that too would
 * mean bending production code around a test concern, so it is left alone.
 *
 * If this fails, something started opening a pool per test file again. Do not
 * raise the number to make it pass — find the pool.
 */
const MAX_TEST_CONNECTIONS = 40;

describe('integration suite connection budget', () => {
    it('holds a bounded number of connections regardless of how many files have run', async () => {
        // Scoped to `current_database()`, NOT `datname LIKE 'autoreply_test%'`.
        // Test databases are per-checkout but the SERVER is shared, so the
        // broader predicate counts other worktrees' suites too — this assertion
        // would then go red because of someone else's run, which is the exact
        // false-red class this whole fix exists to remove.
        const rows = await testDb.execute<{ count: string }>(sql`
            SELECT COUNT(*)::text AS count
              FROM pg_stat_activity
             WHERE datname = current_database()
        `);
        const held = Number(rows[0]?.count ?? '0');

        expect(held).toBeGreaterThan(0); // sanity: we are connected, so we can count
        expect(held).toBeLessThanOrEqual(MAX_TEST_CONNECTIONS);
    });

    it('reuses one pooled client across test files instead of building a new one per file', () => {
        // The cache the fix installs. If a future edit drops it, `setup.ts` goes
        // back to one pool per file and the budget above starts creeping up as
        // the suite grows — long before anyone notices, and only under
        // concurrency.
        const cached = (globalThis as Record<symbol, unknown>)[Symbol.for('jawab24.integrationTestClient')];
        expect(cached).toBeDefined();
    });
});
