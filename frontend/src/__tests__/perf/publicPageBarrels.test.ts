/**
 * Barrel guard for the public pages.
 *
 * A public visitor on a slow link downloads the landing's whole client bundle
 * before anything paints, so a single barrel import there is expensive in a way
 * the same import on an authed screen is not.
 *
 * Two barrels chained to put 147.7 kB gzip of authed-app code on the landing
 * (measured 2026-08-18, prod, Slow 3G — see frontend/scripts/perf/README.md):
 *
 *   landing component -> '@/components/ui'      (43 re-exports)
 *     -> NotificationBell -> '@/hooks'          (53 re-exports)
 *       -> usePostReplySetup -> PostTriggerModal -> '@jawab24/shared'
 *     -> WhatsAppHelpButton / FeedSnippet / FlagTag / CtaButtonPill
 *                                               -> '@jawab24/shared'
 *     -> InfoPopover -> '@radix-ui/react-popover' + '@floating-ui'
 *
 * '@jawab24/shared' is the expensive one: it is compiled to CommonJS
 * ("module": "commonjs" in packages/shared/tsconfig.json) with no `exports`
 * map and no `sideEffects: false`, and webpack cannot tree-shake CommonJS. So
 * ONE named import — a regex constant was enough — pulls the entire barrel,
 * including zod and libphonenumber-js, for 66.1 kB gzip. Until that package
 * ships an ESM build, treat any `@jawab24/shared` import as all of it.
 *
 * This test walks the real value-import graph rather than grepping single
 * files, because the cost arrives transitively: every import site here was
 * several hops away from the page that paid for it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

/** Barrels/packages that must not be reachable from a public page's components. */
const FORBIDDEN = ['@jawab24/shared', '@/components/ui', '@/hooks'] as const;

/**
 * Entry points whose *component* graph must stay barrel-free.
 *
 * Deliberately NOT the `pages/*` modules: those also import `@/i18n/getMessages`
 * for `getStaticProps`, which Next's SSG transform strips from the client
 * bundle. Starting at the component root asserts the rule that actually governs
 * shipped bytes, without encoding an assumption about that transform.
 */
const ENTRIES = [
  '@/components/landing/LandingPageContent',
  // Imported by the landing footer, 404, 500, /pricing/scale and the
  // sanctioned-country notice — all public. Kept dependency-free on purpose.
  '@/lib/whatsapp',
];

function resolveModule(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare package — not a file we walk into
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const index of ['index.tsx', 'index.ts']) {
    const p = path.join(base, index);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const IMPORT_RE =
  /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|export\s+(type\s+)?\*?\s*(?:\{[\s\S]*?\})?\s*from\s*['"]([^'"]+)['"]/g;

/**
 * Static value imports only.
 *
 * `import type` and all-inline-type clauses are erased by the compiler, and
 * `import('x')` is deliberately NOT matched: webpack splits a dynamic import
 * into its own chunk, so it is not part of the initial payload this guard
 * protects. (It is also how `import('@jawab24/shared').FlagMeta` appears in
 * lib/api.ts — a type position, erased, and not a bundle cost either.)
 * A barrel that is genuinely worth loading lazily is the FIX here, not a
 * violation.
 */
function valueImports(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    if (m[1] || m[4]) continue;
    const spec = m[3] || m[5];
    if (!spec) continue;
    const clause = m[2];
    if (clause && /^\{[^}]*\}$/.test(clause.trim())) {
      const names = clause.trim().slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith('type '))) continue;
    }
    specs.push(spec);
  }
  return specs;
}

/** Every forbidden import in the graph, each with the chain that pulled it in. */
function findForbidden(entry: string): string[] {
  const start = resolveModule(entry, path.join(SRC, 'index.ts'));
  if (!start) throw new Error(`entry not resolvable: ${entry}`);

  const parent = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  const violations: string[] = [];

  const chain = (file: string): string => {
    const parts: string[] = [];
    let cur: string | null = file;
    while (cur) {
      parts.unshift(path.relative(SRC, cur));
      cur = parent.get(cur) ?? null;
    }
    return parts.join(' -> ');
  };

  while (queue.length) {
    const file = queue.shift() as string;
    for (const spec of valueImports(file)) {
      if ((FORBIDDEN as readonly string[]).includes(spec)) {
        violations.push(`${path.relative(SRC, file)} imports "${spec}"\n    via ${chain(file)}`);
      }
      const next = resolveModule(spec, file);
      if (!next || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return violations;
}

describe('public pages stay off the app barrels', () => {
  it.each(ENTRIES)('%s reaches no barrel', (entry) => {
    const violations = findForbidden(entry);
    expect(
      violations,
      `Import a component/hook from its own file instead of the barrel ` +
        `(e.g. '@/components/ui/Button', '@/hooks/useTheme'). For ` +
        `'@jawab24/shared', move the consumer off the public path — the ` +
        `package is CommonJS and cannot be tree-shaken.\n\n${violations.join('\n\n')}`,
    ).toEqual([]);
  });

  it('walks far enough to be meaningful', () => {
    // A guard that resolves nothing would pass silently. The landing graph was
    // 158 modules before the fix and 56 after; anything near zero means the
    // resolver broke, not that the graph got clean.
    const entry = resolveModule(ENTRIES[0], path.join(SRC, 'index.ts'))!;
    expect(valueImports(entry).length).toBeGreaterThan(5);
    expect(resolveModule('@/components/ui/Button', entry)).toBeTruthy();
    expect(resolveModule('@jawab24/shared', entry)).toBeNull();
  });
});
