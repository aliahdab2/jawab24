/**
 * The ICU subset the vitest `next-intl` mock understands.
 *
 * Its own module, not a private corner of `setup.ts`, for one reason: it can be
 * tested. `setup.ts` runs `vi.mock` at module scope, so importing it from a
 * test would re-arm every mock in the suite — which is exactly why this code
 * went unverified long enough to ship several silently-wrong messages.
 * `icuPlural.test.ts` now checks it against the real `intl-messageformat`, the
 * formatter production actually uses, over every plural-bearing EN message in
 * the repo.
 */

/**
 * Resolve ICU plural format: "{count, plural, one {# item} other {# items}}".
 *
 * Four things this has to get right, every one of which was wrong at some point
 * and every one of which fails as PLAUSIBLE TEXT rather than as an error — so a
 * test asserting on the output passes or fails for reasons unrelated to the
 * code under test. That is the whole hazard of this file.
 *
 *  1. BRACE-BALANCED, not a single-level regex. Branch bodies routinely carry
 *     their own placeholders — «one {«{list}» and its # row}» — and a `[^{}]`
 *     pattern cannot match those, leaving raw ICU in the DOM (four shipped
 *     messages were in that state).
 *  2. An EXPLICIT `=N` branch wins over the locale category. Seven messages use
 *     `=0 {No products yet}`, and `Intl.PluralRules('en').select(0)` is
 *     'other', so category-only selection rendered «0 products».
 *  3. Branches are read SEQUENTIALLY at the top level of the case list, never
 *     by searching the whole string for `<form> {`. A body containing the word
 *     "other" followed by a brace would otherwise be mistaken for the `other`
 *     branch.
 *  4. `#` binds to the NEAREST enclosing plural and is formatted with the
 *     locale's number format. Production renders «4,500 Smart Replies», not
 *     «4500», and «2 pages of 4», not «4 pages of 4».
 */
export function resolveICUPlural(str: string, params: Record<string, unknown>): string {
  const m = /\{(\w+),\s*plural\s*,/.exec(str);
  if (!m) return str;
  const end = matchingBrace(str, m.index);
  if (end === -1) return str; // malformed — leave it alone rather than hang

  const count = Number(params[m[1]] ?? 0);
  const branches = pluralBranches(str.slice(m.index + m[0].length, end));
  const body =
    branches.get(`=${count}`)
    ?? branches.get(new Intl.PluralRules('en').select(count))
    ?? branches.get('other')
    ?? String(count);

  // Nested plurals first, so their own `#` is already bound to their own count
  // before this level claims whatever `#` remains.
  const resolved = resolveICUPlural(body, params)
    .replace(/#/g, new Intl.NumberFormat('en').format(count));

  return str.slice(0, m.index) + resolved + resolveICUPlural(str.slice(end + 1), params);
}

/** Index of the `}` closing the `{` at `open`, or -1 when unbalanced. */
function matchingBrace(str: string, open: number): number {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The `selector -> body` pairs of one plural's case list, read left to right at
 * the TOP level only. A body is taken by brace matching, so a body that itself
 * contains `other {…}` is consumed whole instead of being mistaken for the next
 * branch.
 */
function pluralBranches(cases: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < cases.length) {
    while (i < cases.length && /\s/.test(cases[i])) i++;
    const start = i;
    while (i < cases.length && !/[\s{]/.test(cases[i])) i++;
    const selector = cases.slice(start, i);
    while (i < cases.length && /\s/.test(cases[i])) i++;
    if (cases[i] !== '{') break;
    const close = matchingBrace(cases, i);
    if (close === -1) break;
    if (selector && !out.has(selector)) out.set(selector, cases.slice(i + 1, close));
    i = close + 1;
  }
  return out;
}
