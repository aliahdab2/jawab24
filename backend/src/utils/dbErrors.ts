/**
 * Postgres error classification.
 *
 * WHY THIS EXISTS: drizzle wraps every driver error in a `DrizzleQueryError` whose own
 * `code` is `undefined` — the SQLSTATE lives on `.cause` (the postgres-js `PostgresError`).
 * So the obvious check is silently dead:
 *
 *     if ((err as { code?: string })?.code === '23505') { ...recover... }   // NEVER runs
 *
 * Confirmed against the real database (drizzle 0.45.2 + postgres-js):
 * `err.constructor.name === 'DrizzleQueryError'`, `err.code === undefined`,
 * `err.cause.name === 'PostgresError'`, `err.cause.code === '23505'`.
 *
 * A mocked unit test cannot catch this: it constructs the error itself
 * (`Object.assign(new Error(), { code: '23505' })`), so it asserts against a shape the
 * driver never produces. Use these predicates, never a bare `.code` read, and cover
 * unique-violation recovery with an integration test that lets Postgres raise it.
 */

/** SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** SQLSTATE 23503 — foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

/** The SQLSTATE for an error, found anywhere in its `cause` chain. */
export function pgErrorCode(error: unknown): string | undefined {
    let node: unknown = error;
    // Bounded walk: a malformed/cyclic chain must not hang the request.
    for (let depth = 0; node && depth < 5; depth++) {
        const code = (node as { code?: unknown }).code;
        if (typeof code === 'string' && code.length > 0) return code;
        node = (node as { cause?: unknown }).cause;
    }
    return undefined;
}

/** True for a unique-index violation, however deeply drizzle wrapped it. */
export function isUniqueViolation(error: unknown): boolean {
    return pgErrorCode(error) === UNIQUE_VIOLATION;
}

/** True for a foreign-key violation, however deeply drizzle wrapped it. */
export function isForeignKeyViolation(error: unknown): boolean {
    return pgErrorCode(error) === FOREIGN_KEY_VIOLATION;
}
