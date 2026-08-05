#!/usr/bin/env node
/**
 * Rule 10.8 gate — cross-file code duplication detector.
 *
 * Why this exists: Rule 10.8 ("before writing a helper, grep for an existing
 * implementation") was prose-only, so nothing enforced it. The April 2026
 * `maybeEncrypt` cleanup extracted `facebookCrypto.maybeEncryptToken` and
 * migrated four call sites — but `AuthService.maybeEncrypt` survived, because a
 * `private` member is invisible both to a grep for the exported name and to any
 * export-only scan. A human re-reading the diff cannot see that either. Only a
 * body-level check across files can.
 *
 * Two detectors, deliberately different in what they key on:
 *
 *   1. same-body      — normalised declaration bodies that are identical across
 *                       files, REGARDLESS of name. Catches renamed copies
 *                       (`maybeEncrypt` vs `maybeEncryptToken`). High precision:
 *                       identical bodies are duplication by definition.
 *   2. same-name-body — the same declaration name in 2+ files whose bodies are
 *                       also near-identical. Requiring the BODY to match is what
 *                       keeps the signal clean: `getStaticProps` appears in 51
 *                       pages and the ecommerce adapters all implement
 *                       `syncProducts`, but their bodies differ, so neither is
 *                       reported. Name alone produced 55 hits, ~80% of them
 *                       framework convention or interface polymorphism.
 *
 * Type-only bodies (interface/type field lists) and JSX-shaped windows are
 * skipped — they duplicate structurally by nature and drown the real signal.
 *
 * Usage:
 *   node scripts/check-duplication.mjs            # full scan, non-zero exit on new findings
 *   node scripts/check-duplication.mjs --json     # machine-readable
 *   node scripts/check-duplication.mjs --update-baseline
 *
 * Ratchet: findings recorded in scripts/duplication-baseline.json are reported
 * but do not fail the run. Anything NOT in the baseline fails. This blocks new
 * duplication without demanding the existing backlog be cleared first — the
 * standard way to introduce a rule to a codebase that predates it.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'duplication-baseline.json');

const SRC_DIRS = ['frontend/src', 'backend/src', 'ai-worker/src', 'packages/shared/src'];
const SKIP_PATH = /node_modules|\.next|[/\\]dist[/\\]|__tests__|\.test\.|\.spec\.|\.d\.ts$/;

/**
 * Declaration names that are duplicated by design, not by accident.
 * Keep this list SHORT and justified — every entry is a hole in the gate.
 */
const ALLOWED_NAMES = new Set([
    'getStaticProps',   // Next.js page contract — one per page by definition
    'getStaticPaths',   // Next.js page contract
    'getServerSideProps',
    'config',           // Next.js route config / per-workspace config module
    'default',
]);

/** Minimum normalised body lines for a declaration to be worth comparing. */
const MIN_BODY_LINES = 3;

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const entry of entries) {
        const p = join(dir, entry);
        if (SKIP_PATH.test(p)) continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Declaration extraction
// ---------------------------------------------------------------------------
/**
 * A declaration must be introduced by a declaring keyword or be method-shaped.
 * Matching a bare `name(` is NOT enough: `useEffect(() => {`, `setLinking(prev
 * => {` and every other call-with-callback would match, and did — the first run
 * reported `setLinking` duplicated across three onboarding pages when those are
 * React state setters, not declarations. Two forms are accepted:
 *
 *   KEYWORD form  — export/function/const/let/var/class/async/access-modifier
 *   METHOD form   — indented `name(args) {` or `name(args): Type {`
 *
 * and any line carrying `=>` before its body brace is rejected outright, which
 * is what separates a declaration from a call that takes a callback.
 */
const DECL_KEYWORD_RE = new RegExp(
    '^\\s*(?:export\\s+)?(?:default\\s+)?' +
    '(?:(?<kind>interface|type)\\s+[A-Za-z_$][\\w$]*' +
    '|(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+)+(?:async\\s+)?(?<mname>[A-Za-z_$][\\w$]*)\\s*\\(' +
    '|(?:async\\s+)?function\\s+(?<fname>[A-Za-z_$][\\w$]*)\\s*\\(' +
    '|class\\s+(?<cname>[A-Za-z_$][\\w$]*)' +
    '|(?:const|let|var)\\s+(?<vname>[A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b|\\()' +
    '|async\\s+(?<aname>[A-Za-z_$][\\w$]*)\\s*\\()',
);

/** `  someMethod(a: string): Promise<void> {`  — a class method with no modifier. */
const METHOD_RE = /^\s{2,}(?:async\s+)?(?<name>[A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::\s*[^{;]+)?\s*\{\s*$/;

function matchDeclaration(line) {
    const kw = DECL_KEYWORD_RE.exec(line);
    if (kw) {
        if (kw.groups.kind) return { kind: kw.groups.kind };
        return { name: kw.groups.mname || kw.groups.fname || kw.groups.cname || kw.groups.vname || kw.groups.aname };
    }
    const method = METHOD_RE.exec(line);
    return method ? { name: method.groups.name } : null;
}

/** Strip comments and collapse whitespace so formatting differences don't hide a clone. */
function normaliseLine(line) {
    return line
        .replace(/\/\/.*$/, '')
        .replace(/\/\*.*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A body that is only type members — `foo: string;` / `bar?: number;`. */
function isTypeOnlyBody(lines) {
    const meaningful = lines.filter((l) => l && l !== '}' && l !== '{');
    if (!meaningful.length) return true;
    const fieldLike = meaningful.filter((l) => /^[\w'"[\]?.]+\??\s*:\s*[^;]+;?$/.test(l));
    return fieldLike.length / meaningful.length > 0.8;
}

/** A body that is mostly markup — closing tags, props, punctuation. */
function isJsxShapedBody(lines) {
    const meaningful = lines.filter(Boolean);
    if (!meaningful.length) return true;
    const markup = meaningful.filter((l) => /^[<>/){}\]\s]*$|^<\/?[A-Za-z]|^[\w-]+=[{"']/.test(l));
    return markup.length / meaningful.length > 0.6;
}

/** Real logic: a call, a control-flow keyword, an assignment or an await. */
function hasExecutableContent(lines) {
    const signals = lines.filter((l) =>
        /\b(if|for|while|switch|return|await|throw|try)\b/.test(l) || /[A-Za-z_$][\w$]*\s*\(/.test(l),
    );
    return signals.length >= 2;
}

/**
 * Collect declarations with their brace-balanced bodies.
 * Brace counting is sufficient here — a full parse would need a TS dependency,
 * and the only cost of a miscount is a missed or over-long body, never a crash.
 */
function extractDeclarations(absPath) {
    const rel = relative(ROOT, absPath).replace(/\\/g, '/');
    const lines = readFileSync(absPath, 'utf8').split('\n');
    const decls = [];

    for (let i = 0; i < lines.length; i++) {
        // A call that takes a callback is not a declaration, however much it looks
        // like one: `useEffect(() => {`, `setLinking(prev => {`, `map(x => {`.
        if (/=>/.test(lines[i].split('{')[0] ?? '')) continue;

        const m = matchDeclaration(lines[i]);
        if (!m) continue;
        if (m.kind) continue;                              // interface / type alias
        const name = m.name;
        if (!name || ALLOWED_NAMES.has(name)) continue;
        if (/^(if|for|while|switch|catch|return|typeof|new|await|constructor)$/.test(name)) continue;

        // Walk forward to the opening brace of the body, then to its match.
        let depth = 0, started = false, end = i;
        for (let j = i; j < Math.min(lines.length, i + 400); j++) {
            for (const ch of lines[j]) {
                if (ch === '{') { depth++; started = true; }
                else if (ch === '}') depth--;
            }
            if (started && depth <= 0) { end = j; break; }
            end = j;
        }
        if (!started || end === i) continue;

        const body = lines.slice(i + 1, end).map(normaliseLine).filter(Boolean);
        if (body.length < MIN_BODY_LINES) continue;
        if (isTypeOnlyBody(body) || isJsxShapedBody(body) || !hasExecutableContent(body)) continue;

        decls.push({
            name,
            file: rel,
            line: i + 1,
            body: body.join('\n'),
            hash: createHash('sha1').update(body.join('\n')).digest('hex'),
        });
        i = end;                                            // don't re-scan nested decls
    }
    return decls;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------
const files = SRC_DIRS.flatMap((d) => walk(join(ROOT, d)));
const declarations = files.flatMap(extractDeclarations);

const findings = [];

// Detector 1 — identical bodies across files, name-independent.
const byHash = new Map();
for (const d of declarations) {
    if (!byHash.has(d.hash)) byHash.set(d.hash, []);
    byHash.get(d.hash).push(d);
}
for (const group of byHash.values()) {
    const distinctFiles = [...new Set(group.map((d) => d.file))];
    if (distinctFiles.length < 2) continue;
    findings.push({
        detector: 'same-body',
        key: `same-body:${[...new Set(group.map((d) => `${d.file}#${d.name}`))].sort().join('|')}`,
        names: [...new Set(group.map((d) => d.name))].sort(),
        sites: group.map((d) => `${d.file}:${d.line} (${d.name})`).sort(),
        lines: group[0].body.split('\n').length,
    });
}

// Detector 2 — same name in 2+ files AND near-identical bodies.
const byName = new Map();
for (const d of declarations) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
}
for (const [name, group] of byName) {
    const distinctFiles = [...new Set(group.map((d) => d.file))];
    if (distinctFiles.length < 2) continue;
    // Already reported by detector 1 if the bodies are byte-identical.
    if (new Set(group.map((d) => d.hash)).size === 1) continue;

    // Near-identical = >=80% of normalised body lines shared with another copy.
    const similar = [];
    for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
            if (group[a].file === group[b].file) continue;
            const A = new Set(group[a].body.split('\n'));
            const B = new Set(group[b].body.split('\n'));
            const shared = [...A].filter((l) => B.has(l)).length;
            const ratio = shared / Math.max(A.size, B.size);
            if (ratio >= 0.8) similar.push(group[a], group[b]);
        }
    }
    if (!similar.length) continue;
    const sites = [...new Set(similar.map((d) => `${d.file}:${d.line}`))].sort();
    findings.push({
        detector: 'same-name-body',
        key: `same-name-body:${name}:${sites.map((s) => s.split(':')[0]).join('|')}`,
        names: [name],
        sites,
        lines: similar[0].body.split('\n').length,
    });
}

findings.sort((a, b) => b.lines - a.lines || a.key.localeCompare(b.key));

// ---------------------------------------------------------------------------
// Baseline ratchet + reporting
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--update-baseline')) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ keys: findings.map((f) => f.key).sort() }, null, 2)}\n`);
    console.log(`Baseline written: ${findings.length} known finding(s) -> scripts/duplication-baseline.json`);
    process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
    ? new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).keys ?? [])
    : new Set();

const fresh = findings.filter((f) => !baseline.has(f.key));
const known = findings.filter((f) => baseline.has(f.key));

if (args.includes('--json')) {
    console.log(JSON.stringify({ scanned: files.length, fresh, known }, null, 2));
    process.exit(fresh.length ? 1 : 0);
}

console.log(`Rule 10.8 duplication check — ${files.length} source files, ${declarations.length} declarations\n`);

if (fresh.length) {
    console.log(`NEW duplication (${fresh.length}) — must be resolved or baselined:`);
    for (const f of fresh) {
        console.log(`\n  [${f.detector}] ${f.names.join(' / ')}  (${f.lines} lines)`);
        for (const s of f.sites) console.log(`      ${s}`);
    }
    console.log('');
}

if (known.length) console.log(`Known duplication carried in the baseline: ${known.length} (burn-down backlog)`);

if (fresh.length) {
    console.log('\nExtract the shared logic into a module both call sites import (Rule 10.8/10.9).');
    console.log('If a finding is duplication by design, justify it and run --update-baseline.');
    process.exit(1);
}

console.log('No new cross-file duplication.');
