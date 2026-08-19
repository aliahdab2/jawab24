/**
 * The ICU subset the vitest `next-intl` mock understands.
 *
 * Its own module, not a private corner of `setup.ts`, for one reason: it can be
 * tested. `setup.ts` runs `vi.mock` at module scope, so importing it from a
 * test would re-arm every mock in the suite — which is exactly why this code
 * went unverified long enough to ship four silently-wrong messages.
 * `icuPlural.test.ts` now checks it against the real `intl-messageformat`, the
 * formatter production actually uses, over every plural-bearing EN message in
 * the repo.
 */

/**
 * Resolve ICU plural format: "{count, plural, one {# item} other {# items}}".
 *
 * Brace-BALANCED, not a single-level regex. Branch bodies routinely carry
 * their own placeholders — «{count, plural, one {«{list}» and its # row…}}» —
 * and a `[^{}]`-based pattern silently fails to match those, leaving the raw
 * ICU string in the DOM. It renders as plausible-looking text, so an assertion
 * on it passes or fails for the wrong reason instead of erroring; four shipped
 * messages were already in that state when this was found (2026-08-19).
 * Production next-intl handles the nesting, so the mock must too.
 */
export function resolveICUPlural(str: string, params: Record<string, unknown>): string {
  const opener = /\{(\w+),\s*plural\s*,/;
  // Each pass consumes exactly one plural block, so a body that itself holds a
  // nested plural is resolved by the next pass and the loop still terminates.
  for (let m = opener.exec(str); m; m = opener.exec(str)) {
    const end = matchingBrace(str, m.index);
    if (end === -1) break;
    const cases = str.slice(m.index + m[0].length, end);
    const count = Number(params[m[1]] ?? 0);
    // ICU matches an EXPLICIT `=N` branch BEFORE consulting the locale's plural
    // rules, and seven shipped messages use `=0 {No products yet}` for their
    // empty state. Selecting by category alone rendered «0 products» in tests
    // while production rendered «No products yet» — measured against
    // intl-messageformat over every plural-bearing EN message (2026-08-20).
    const body = pluralBranch(cases, `=${count}`)
      ?? pluralBranch(cases, new Intl.PluralRules('en').select(count))
      ?? pluralBranch(cases, 'other')
      ?? String(count);
    str = str.slice(0, m.index) + body.replace(/#/g, String(count)) + str.slice(end + 1);
  }
  return str;
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

/** The body of one `<form> {…}` branch, brace-balanced so a body containing
 *  «{list}» is returned whole rather than truncated at its first `}`. `form` is
 *  escaped because it can be an explicit selector (`=0`, and `=1.5` carries a
 *  regex metacharacter). */
function pluralBranch(cases: string, form: string): string | undefined {
  const at = new RegExp(`(?:^|[\\s}])${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`).exec(cases);
  if (!at) return undefined;
  const open = at.index + at[0].length - 1;
  const end = matchingBrace(cases, open);
  return end === -1 ? undefined : cases.slice(open + 1, end).trim();
}
