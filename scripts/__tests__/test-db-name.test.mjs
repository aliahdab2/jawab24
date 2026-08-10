/**
 * Tests for scripts/testDatabaseName.mjs — the rule that decides whether a
 * database may be TRUNCATEd by the integration suite and DROPped by the deploy gate.
 *
 * Run: node --test scripts/__tests__/test-db-name.test.mjs
 *
 * This predicate has three destructive call sites (the gate's DROP/CREATE,
 * globalSetup's CREATE, setup.ts's per-test TRUNCATE). It shipped once as a shell
 * prefix glob — `[[ $name == autoreply_test* ]]` — which accepts
 * `autoreply_test; DROP DATABASE autoreply` and hands the tail to psql as a second
 * statement against the server that also hosts the dev database. The injection
 * cases below are the ones that would have caught that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isTestDatabaseName,
    assertTestDatabaseName,
    databaseNameFromUrl,
    MAX_IDENTIFIER_BYTES,
} from '../testDatabaseName.mjs';

const MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', 'testDatabaseName.mjs');

const ACCEPTED = [
    'autoreply_test',
    'autoreply_test_main_0123456789',
    'autoreply_test_a_worktree_name_abcdef0123',
    'autoreply_test123',
];

const REJECTED = [
    // The dev database and its neighbours — the whole point of the guard.
    ['autoreply', 'the dev database'],
    ['postgres', 'the maintenance database'],
    ['', 'a URL with no database path'],
    // Prefix-glob escapes: all of these satisfy `autoreply_test*`.
    ['autoreply_test; DROP DATABASE autoreply', 'statement injection'],
    ['autoreply_test"; DROP DATABASE autoreply; --', 'quoted statement injection'],
    ['autoreply_test autoreply', 'embedded space'],
    ['autoreply_test-dashes', 'a character needing quoting'],
    ['autoreply_testCAPS', 'uppercase — Postgres would fold an unquoted form'],
    // Suffix, not prefix.
    ['x_autoreply_test', 'the prefix appearing mid-name'],
    // Longer than a Postgres identifier: the server would silently truncate and
    // the statement would then target a DIFFERENT database than the one checked.
    [`autoreply_test_${'a'.repeat(MAX_IDENTIFIER_BYTES)}`, 'an over-long identifier'],
];

test('accepts the names the generator can actually produce', () => {
    for (const name of ACCEPTED) {
        assert.equal(isTestDatabaseName(name), true, `${name} should be accepted`);
    }
});

test('rejects everything else, including every prefix-glob escape', () => {
    for (const [name, why] of REJECTED) {
        assert.equal(isTestDatabaseName(name), false, `${name} (${why}) should be rejected`);
    }
});

test('assertTestDatabaseName names the database and the action it refused', () => {
    assert.throws(() => assertTestDatabaseName('autoreply', 'truncate tables in'), (error) => {
        assert.match(error.message, /Refusing to truncate tables in "autoreply"/);
        return true;
    });
    assert.doesNotThrow(() => assertTestDatabaseName('autoreply_test_x_0123456789', 'drop'));
});

test('databaseNameFromUrl decodes before the name is judged', () => {
    // %22 is a double quote. Decoding AFTER validating would let an encoded quote
    // through the check and then materialise inside CREATE DATABASE "...".
    const name = databaseNameFromUrl(
        'postgresql://postgres:postgres@localhost:5433/autoreply_test%22x',
    );
    assert.equal(name, 'autoreply_test"x');
    assert.equal(isTestDatabaseName(name), false);
});

test('the --validate CLI exits 0 for accepted names and 1 for rejected ones', () => {
    // This is the entry point scripts/pre-deploy-check.sh uses in place of a
    // second, hand-written copy of the rule.
    for (const name of ACCEPTED) {
        assert.doesNotThrow(
            () => execFileSync('node', [MODULE, '--validate', name], { stdio: 'pipe' }),
            `${name} should exit 0`,
        );
    }
    for (const [name, why] of REJECTED) {
        assert.throws(
            () => execFileSync('node', [MODULE, '--validate', name], { stdio: 'pipe' }),
            `${name} (${why}) should exit non-zero`,
        );
    }
});

test('the --validate CLI rejects malformed usage with a distinct exit code', () => {
    // Exit 2, not 1: "you called this wrong" must not read as "the name is unsafe".
    try {
        execFileSync('node', [MODULE], { stdio: 'pipe' });
        assert.fail('expected a non-zero exit');
    } catch (error) {
        assert.equal(error.status, 2);
    }
});
