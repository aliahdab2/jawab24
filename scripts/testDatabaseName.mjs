/**
 * The ONE rule for "is this a database an integration-test run may destroy?".
 *
 * Three call sites destroy data against a name derived from DATABASE_URL:
 *
 *   1. scripts/pre-deploy-check.sh — DROP DATABASE / CREATE DATABASE (step 6)
 *   2. backend/test/integration/globalSetup.ts — CREATE DATABASE
 *   3. backend/test/integration/setup.ts — TRUNCATE ~20 tables before EVERY test
 *
 * They must agree exactly, so they all call THIS module — the shell one via the
 * `--validate` CLI below. A second, hand-written copy of the rule is how you get
 * a guard that is stricter in one place than another; the shell guard used to be
 * a prefix glob (`autoreply_test*`) while the JS side was anchored, which meant
 * a DATABASE_URL ending in `/autoreply_test; DROP DATABASE autoreply` satisfied
 * the shell check and had its tail executed as superuser SQL against the same
 * server that hosts the dev database.
 *
 * The pattern is anchored and allows only characters that need no quoting, so a
 * name that passes is safe to interpolate into CREATE/DROP DATABASE.
 */

import { pathToFileURL } from 'node:url';

/** Anchored: the whole name, lowercase word characters only, `autoreply_test` prefix. */
export const TEST_DB_NAME_PATTERN = /^autoreply_test[a-z0-9_]*$/;

/** Postgres truncates identifiers longer than this, which would silently retarget the statement. */
export const MAX_IDENTIFIER_BYTES = 63;

/**
 * @param {string} name Database name, already URL-decoded.
 * @returns {boolean}
 */
export function isTestDatabaseName(name) {
    return (
        typeof name === 'string' &&
        TEST_DB_NAME_PATTERN.test(name) &&
        Buffer.byteLength(name, 'utf8') <= MAX_IDENTIFIER_BYTES
    );
}

/**
 * Throws unless `name` is a database the integration suite is allowed to destroy.
 *
 * @param {string} name Database name, already URL-decoded.
 * @param {string} action What the caller is about to do, for the error message.
 */
export function assertTestDatabaseName(name, action) {
    if (isTestDatabaseName(name)) return;
    throw new Error(
        `Refusing to ${action} "${name}": an integration-test database must match ` +
            `${TEST_DB_NAME_PATTERN} and be at most ${MAX_IDENTIFIER_BYTES} bytes. ` +
            'Integration tests TRUNCATE every table they touch, and the deploy gate DROPs ' +
            'this database outright. Resolve it with scripts/test-db-url.sh.',
    );
}

/**
 * Extracts the database name from a Postgres URL, URL-decoded.
 *
 * @param {string} url
 * @returns {string}
 */
export function databaseNameFromUrl(url) {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

// CLI: `node scripts/testDatabaseName.mjs --validate <name>` — exit 0 if the name
// is safe to destroy, 1 otherwise. This is how pre-deploy-check.sh reuses the rule
// instead of keeping a shell copy of it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [flag, name] = process.argv.slice(2);
    if (flag !== '--validate' || name === undefined) {
        console.error('usage: node scripts/testDatabaseName.mjs --validate <database-name>');
        process.exit(2);
    }
    try {
        assertTestDatabaseName(name, 'operate on');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
