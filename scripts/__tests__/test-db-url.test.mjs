/**
 * Regression tests for scripts/test-db-url.sh.
 *
 * Run: node --test scripts/__tests__/test-db-url.test.mjs
 *
 * The integration test database used to be one machine-global `autoreply_test`
 * shared by the main checkout and every worktree. Because
 * backend/test/integration/setup.ts TRUNCATEs ~20 tables before EVERY test, two
 * suites running at once deleted each other's fixtures — which surfaced as a
 * deploy gate reporting 29 failures across 13 files that had nothing to do with
 * the code, and, on an earlier run, as the gate dying in its drop/create step
 * because Postgres refuses DROP DATABASE while another session is connected.
 *
 * These tests pin the properties that make that collision impossible. The
 * uniqueness test is the one that would have caught the original bug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestDatabaseName } from '../testDatabaseName.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-db-url.sh');

/**
 * Runs the script as if it lived in a checkout rooted at a fresh temp directory,
 * since it derives the database name from its own location on disk.
 */
function urlForFakeCheckout(checkoutName, env = {}) {
    const root = join(mkdtempSync(join(tmpdir(), 'jawab24-dburl-')), checkoutName);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    const copy = join(root, 'scripts', 'test-db-url.sh');
    copyFileSync(SCRIPT, copy);
    try {
        return execFileSync('bash', [copy], {
            encoding: 'utf8',
            env: { ...process.env, ...env },
        }).trim();
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const dbNameOf = (url) => new URL(url).pathname.replace(/^\//, '');

test('two different checkouts never share a database', () => {
    const a = urlForFakeCheckout('feature-one');
    const b = urlForFakeCheckout('feature-two');
    assert.notEqual(dbNameOf(a), dbNameOf(b));
});

test('two checkouts with the SAME basename still never share a database', () => {
    // Worktrees are routinely named after a ticket and can repeat across repos;
    // only the absolute path is guaranteed unique.
    const a = urlForFakeCheckout('same-name');
    const b = urlForFakeCheckout('same-name');
    assert.notEqual(dbNameOf(a), dbNameOf(b));
});

test('the same checkout always resolves to the same database', () => {
    // The deploy gate and `npm run test:integration:local` must agree, or the
    // gate would migrate one database and the suite would read another.
    const root = join(mkdtempSync(join(tmpdir(), 'jawab24-dburl-')), 'stable');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    const copy = join(root, 'scripts', 'test-db-url.sh');
    copyFileSync(SCRIPT, copy);
    try {
        const first = execFileSync('bash', [copy], { encoding: 'utf8' }).trim();
        const second = execFileSync('bash', [copy], { encoding: 'utf8' }).trim();
        assert.equal(first, second);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('every generated name satisfies the shared destructive-operation guard', () => {
    // The generator and the validator are separate files, and the gate trusts BOTH:
    // it resolves a name here and then refuses to DROP it unless the validator
    // agrees. If they ever disagree, no checkout can run the suite at all — so tie
    // them together with the awkward checkout names, not just the tidy ones.
    for (const name of [
        'plain',
        'With-Caps',
        'dots.and_stuff',
        'a-very-long-worktree-name-that-keeps-going-and-going',
        '...',
        'trailing---',
        '99-numeric-start',
    ]) {
        const dbName = dbNameOf(urlForFakeCheckout(name));
        assert.ok(
            isTestDatabaseName(dbName),
            `checkout "${name}" produced "${dbName}", which the shared guard rejects`,
        );
        // No `__`: a doubled separator is legal but signals the label was emptied
        // or truncated onto a separator, which makes names harder to eyeball.
        assert.doesNotMatch(dbName, /__/, `${dbName} has a doubled separator`);
    }
});

test('the script stays directly executable', () => {
    // Both real call sites exec it, not `bash it`: pre-deploy-check.sh runs
    // "$REPO_ROOT/scripts/test-db-url.sh" and backend's test:integration:local runs
    // ../scripts/test-db-url.sh. Every other test here invokes it via `bash <path>`,
    // which works fine without the mode bit — so a lost +x passes the whole suite
    // and then makes both call sites resolve an EMPTY database URL.
    assert.ok(statSync(SCRIPT).mode & 0o111, 'scripts/test-db-url.sh is not executable');
    const url = execFileSync(SCRIPT, { encoding: 'utf8' }).trim();
    assert.ok(isTestDatabaseName(dbNameOf(url)), `direct exec produced "${url}"`);
});

test('TEST_PG_HOST and TEST_PG_PORT override the server', () => {
    const url = new URL(urlForFakeCheckout('ports', { TEST_PG_HOST: '127.0.0.1', TEST_PG_PORT: '6544' }));
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '6544');
});

test('defaults to the dev Docker Postgres on 5433', () => {
    const url = new URL(urlForFakeCheckout('defaults'));
    assert.equal(url.hostname, 'localhost');
    assert.equal(url.port, '5433');
});
