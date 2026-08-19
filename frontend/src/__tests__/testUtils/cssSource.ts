import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Shared reader for assertions against the globals.css SOURCE.
 *
 * Some CSS contracts are only checkable as text — a rule that must exist, a
 * declaration two selectors must share, a gate that must NOT be present. These
 * helpers were duplicated in every such spec; they live here so a change to the
 * parsing (e.g. nested at-rules) is made once.
 *
 * Scope: source text only. Anything that depends on the CASCADE (specificity,
 * media queries, presentational-hint precedence) is NOT provable here and
 * belongs in an E2E spec against a real browser — see e2e/safe-area-cascade.spec.ts
 * and e2e/complete-profile.spec.ts for the two live examples.
 */
export const css = readFileSync(
  resolve(__dirname, '../../styles/globals.css'),
  'utf-8',
);

/**
 * Comments are dropped before parsing: a `/* … *\/` block immediately above a
 * rule is otherwise swallowed into that rule's selector text, and this file is
 * heavily commented.
 */
const PARSEABLE = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Every `<selector list> { <body> }` in the sheet. `[^{}]` cannot cross a brace,
 * so an at-rule prelude (`@media (...) {`) never matches as a selector and the
 * rules NESTED inside one are found on their own — which is what callers want.
 */
const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;

const normalizeSelector = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Does `candidate` target what `wanted` names? True for an exact selector, and
 * for a more specific one that ENDS with it — `html.is-native .bottom-safe-bg`
 * answers a query for `.is-native .bottom-safe-bg`.
 *
 * `.` / `#` / `[` / `:` are self-delimiting, so a suffix starting with one can
 * never land mid-identifier (`.my-bottom-safe-bg` does not answer
 * `.bottom-safe-bg`). A bare element name has no such guard, so it must sit on
 * a non-identifier boundary.
 */
const targets = (candidate: string, wanted: string): boolean => {
  if (candidate === wanted) return true;
  if (!candidate.endsWith(wanted)) return false;
  if (/^[.#[:]/.test(wanted)) return true;
  return !/[\w-]/.test(candidate[candidate.length - wanted.length - 1]);
};

/**
 * Bodies of every rule that targets `selector`.
 *
 * Matches per comma-separated selector in the list, not just the last one — a
 * rule written across two lines (`input[…],\ntextarea[…] { }`) targets both, and
 * an earlier version of this helper silently saw only the second. Suffix match
 * on a descendant combinator, so `.bottom-safe-bg` also finds
 * `html.is-native .bottom-safe-bg`.
 */
export const bodiesOf = (selector: string): string[] => {
  const wanted = normalizeSelector(selector);
  const out: string[] = [];
  for (const [, selectors, body] of PARSEABLE.matchAll(RULE_RE)) {
    if (selectors.split(',').map(normalizeSelector).some((s) => targets(s, wanted))) {
      out.push(body);
    }
  }
  return out;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The value of `prop` inside a rule body, or null when the rule does not set it. */
export const declaration = (body: string, prop: string): string | null => {
  const m = body.match(new RegExp(`(?:^|;|\\s)${escape(prop)}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};
