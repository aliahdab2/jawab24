/**
 * Regression tests for the Rule 10.8 duplication gate.
 *
 * Run: node --test scripts/__tests__/
 *
 * The first implementation matched a bare `name(`, so every call taking a
 * callback registered as a declaration and the gate reported React state
 * setters (`setLinking`, `setPagesLoading`) as duplicated across the three
 * ecommerce onboarding pages. 12 of its 19 findings were that artefact. These
 * tests pin the distinction, because a gate that cries wolf gets switched off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-duplication.mjs');

/**
 * The scanner resolves its roots from its own location, so a fixture repo needs
 * the same shape: <root>/scripts/check-duplication.mjs + <root>/backend/src/...
 */
function runOnFixture(files) {
    const root = mkdtempSync(join(tmpdir(), 'dupgate-'));
    try {
        mkdirSync(join(root, 'scripts'), { recursive: true });
        writeFileSync(join(root, 'scripts', 'check-duplication.mjs'), execFileSync('cat', [SCRIPT]));
        // No baseline file — every finding counts as new.
        for (const [rel, content] of Object.entries(files)) {
            const abs = join(root, rel);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, content);
        }
        let stdout;
        try {
            stdout = execFileSync('node', [join(root, 'scripts', 'check-duplication.mjs'), '--json'], {
                encoding: 'utf8',
            });
        } catch (err) {
            stdout = err.stdout; // exit 1 when findings exist — expected
        }
        return JSON.parse(stdout);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test('reports a genuinely duplicated function body across two files', () => {
    const body = `
        try {
            const res = await api.getStore();
            setStore(res);
            setLoading(false);
            return res;
        } catch {
            setError(true);
            return null;
        }
`;
    const { fresh } = runOnFixture({
        'backend/src/a.ts': `export async function fetchStore() {${body}}\n`,
        'backend/src/b.ts': `export async function fetchStore() {${body}}\n`,
    });
    assert.equal(fresh.length, 1, 'the identical body should be reported exactly once');
    assert.equal(fresh[0].detector, 'same-body');
    assert.deepEqual(fresh[0].names, ['fetchStore']);
});

test('does NOT report calls that take a callback — the original false positive', () => {
    // Same setter, same callback body, three files. A declaration scanner that
    // keys on `name(` reports this; a correct one reports nothing.
    const call = `
    setLinking((prev) => {
        const next = { ...prev };
        next.busy = true;
        doSomething(next);
        return next;
    });
`;
    const { fresh } = runOnFixture({
        'frontend/src/a.tsx': `export function A() {${call}}\n`,
        'frontend/src/b.tsx': `export function B() {${call}}\n`,
        'frontend/src/c.tsx': `export function C() {${call}}\n`,
    });
    const setterFindings = fresh.filter((f) => f.names.includes('setLinking'));
    assert.equal(setterFindings.length, 0, `setLinking must not be treated as a declaration: ${JSON.stringify(fresh)}`);
});

test('does NOT report useEffect bodies as duplicate declarations', () => {
    const effect = `
    useEffect(() => {
        const timer = setInterval(() => poll(), 1000);
        void poll();
        return () => clearInterval(timer);
    }, []);
`;
    const { fresh } = runOnFixture({
        'frontend/src/a.tsx': `export function A() {${effect}}\n`,
        'frontend/src/b.tsx': `export function B() {${effect}}\n`,
    });
    assert.equal(fresh.filter((f) => f.names.includes('useEffect')).length, 0);
});

test('does NOT report interface field lists — they duplicate structurally by nature', () => {
    const fields = `
    id: string;
    pageId: string;
    senderName: string | null;
    direction?: 'incoming' | 'outgoing';
`;
    const { fresh } = runOnFixture({
        'backend/src/a.ts': `export interface Message {${fields}}\n`,
        'frontend/src/b.ts': `export interface Message {${fields}}\n`,
    });
    assert.equal(fresh.length, 0, `type-only bodies must be skipped: ${JSON.stringify(fresh)}`);
});

test('does NOT report same-named functions whose bodies differ (adapter polymorphism)', () => {
    const { fresh } = runOnFixture({
        'backend/src/salla.ts':
            'export async function syncProducts() {\n  const r = await sallaApi.list();\n  await save(r);\n  return r.length;\n}\n',
        'backend/src/shopify.ts':
            'export async function syncProducts() {\n  const cursor = await shopifyApi.page();\n  while (cursor.next) { await drain(cursor); }\n  return cursor.total;\n}\n',
    });
    assert.equal(fresh.length, 0, `differing bodies are polymorphism, not duplication: ${JSON.stringify(fresh)}`);
});

test('catches a renamed clone — identical body, different name', () => {
    const body = `
        if (!timer) {
            return;
        }
        clearInterval(timer);
        timer = null;
        logger.info('cron stopped');
`;
    const { fresh } = runOnFixture({
        'backend/src/tokenRefresh.ts': `export function stopTokenRefreshCron() {${body}}\n`,
        'backend/src/whatsappTokenHealth.ts': `export function stopWhatsAppTokenHealthCron() {${body}}\n`,
    });
    assert.equal(fresh.length, 1);
    assert.deepEqual(fresh[0].names, ['stopTokenRefreshCron', 'stopWhatsAppTokenHealthCron']);
});

test('honours the baseline ratchet — a recorded finding does not fail the run', () => {
    const body = '\n  const a = compute();\n  const b = compute();\n  return a + b;\n';
    const files = {
        'backend/src/a.ts': `export function dup() {${body}}\n`,
        'backend/src/b.ts': `export function dup() {${body}}\n`,
    };
    const first = runOnFixture(files);
    assert.equal(first.fresh.length, 1, 'without a baseline the finding is new');

    const withBaseline = runOnFixture({
        ...files,
        'scripts/duplication-baseline.json': JSON.stringify({ keys: [first.fresh[0].key] }),
    });
    assert.equal(withBaseline.fresh.length, 0, 'a baselined finding must not be reported as new');
    assert.equal(withBaseline.known.length, 1, 'it must still be listed as known backlog');
});
