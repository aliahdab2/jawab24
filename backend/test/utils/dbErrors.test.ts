import { describe, it, expect } from 'vitest';
import { isUniqueViolation, isForeignKeyViolation, pgErrorCode } from '../../src/utils/dbErrors';

/**
 * The shapes here are the ones the REAL driver produces, verified against Postgres
 * (see test/integration/postsScheduledMarker.test.ts). The bug these predicates exist to
 * prevent is a `.code` read on the thrown error: drizzle wraps it, so `err.code` is
 * `undefined` and the recovery branch silently never runs.
 */
describe('dbErrors', () => {
    /** What drizzle 0.45 + postgres-js actually throws: a wrapper whose own `code` is
     *  undefined, with the SQLSTATE on `.cause`. */
    function drizzleWrapped(code: string) {
        const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
            name: 'PostgresError',
            code,
        });
        return Object.assign(new Error('Failed query: insert into "posts" ...'), { cause });
    }

    it('finds the SQLSTATE on the cause, not just the top-level error', () => {
        const err = drizzleWrapped('23505');
        // The trap, stated as an assertion: reading .code directly gets nothing.
        expect((err as { code?: string }).code).toBeUndefined();
        expect(isUniqueViolation(err)).toBe(true);
    });

    it('still works for a bare driver error (no wrapper)', () => {
        expect(isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' }))).toBe(true);
    });

    it('distinguishes unique from foreign-key violations', () => {
        expect(isForeignKeyViolation(drizzleWrapped('23503'))).toBe(true);
        expect(isUniqueViolation(drizzleWrapped('23503'))).toBe(false);
        expect(isForeignKeyViolation(drizzleWrapped('23505'))).toBe(false);
    });

    it('returns false for unrelated errors and non-errors', () => {
        expect(isUniqueViolation(new Error('nope'))).toBe(false);
        expect(isUniqueViolation(null)).toBe(false);
        expect(isUniqueViolation(undefined)).toBe(false);
        expect(isUniqueViolation('23505')).toBe(false);
        expect(pgErrorCode(new Error('nope'))).toBeUndefined();
    });

    it('walks a nested chain but cannot be hung by a cyclic one', () => {
        const deep = { cause: { cause: { cause: Object.assign(new Error('x'), { code: '23505' }) } } };
        expect(isUniqueViolation(deep)).toBe(true);

        const cyclic: { cause?: unknown } = {};
        cyclic.cause = cyclic;
        expect(isUniqueViolation(cyclic)).toBe(false);
    });
});
