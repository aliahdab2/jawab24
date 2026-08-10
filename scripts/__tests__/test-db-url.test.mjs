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
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('the name always starts with autoreply_test', () => {
    // pre-deploy-check.sh refuses to DROP anything not matching autoreply_test*,
    // so this prefix is load-bearing for the gate's safety guard.
    for (const name of ['plain', 'With-Caps', 'dots.and_stuff']) {
        assert.match(dbNameOf(urlForFakeCheckout(name)), /^autoreply_test_/);
    }
});

test('the name is a legal Postgres identifier', () => {
    // Identifiers cap at 63 bytes and the name is interpolated unquoted into
    // CREATE/DROP DATABASE by the gate.
    const name = dbNameOf(urlForFakeCheckout('a-very-long-worktree-name-that-keeps-going-and-going'));
    assert.ok(name.length <= 63, `${name} is ${name.length} bytes`);
    assert.match(name, /^[a-z][a-z0-9_]*$/);
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
