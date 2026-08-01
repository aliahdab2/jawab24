import { vi, type Mock } from 'vitest';

/**
 * Chainable drizzle query mock: every builder method returns a fresh chain
 * that resolves to `rows`, so `db.select().from().where().limit()` and
 * `db.update().set().where().returning()` both work without per-shape setup.
 *
 * Shared home for a mock that had been copy-pasted per test file — when
 * drizzle grows a new chained method, add it HERE once (that exact drift
 * happened when `.returning` support had to be patched into one copy).
 */
export type QueryMock = Promise<unknown[]> & {
    from: Mock; where: Mock; limit: Mock; orderBy: Mock; set: Mock; values: Mock; returning: Mock;
    innerJoin: Mock;
};

export function q(rows: unknown[]): QueryMock {
    const p = Promise.resolve(rows) as QueryMock;
    for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'returning', 'innerJoin'] as const) {
        p[m] = vi.fn(() => q(rows));
    }
    return p;
}

/** A fresh LinkLogger-shaped spy pair for services that take an optional logger. */
export const mkLog = () => ({ info: vi.fn(), warn: vi.fn() });
