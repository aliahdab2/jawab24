import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { css } from '../testUtils/cssSource';

/**
 * The animation vocabulary is split across two files by necessity: only
 * tailwind.config.js can generate variant forms (`group-hover:animate-shimmer`),
 * and only globals.css can hold hand-written keyframes. That split is fine. Two
 * definitions of the SAME name is not, and it bit twice:
 *
 *  - `float` was 8px/3s in the config and 20px/6s in globals. Globals won, so
 *    `float-delayed` and `float-slow` — config entries — silently ran a travel
 *    2.5× larger than they were written for.
 *  - `shimmer` was the reverse: globals looked like it should win, but Tailwind
 *    emits variant utilities and their keyframes LAST, so the config's version
 *    won. Anyone deleting the config half as "dead" would have changed the
 *    shine on every button in the app.
 *
 * Whichever way the cascade happens to fall is not something a reader should
 * have to work out, so: one definition per name.
 *
 * Mutation check: re-add `float: { … }` to the config's keyframes, or a second
 * `.animate-pulse-soft` rule to globals.css, and the first test fails naming it.
 */

const config = readFileSync(
  resolve(__dirname, '../../../tailwind.config.js'),
  'utf-8',
);

const section = (src: string, key: string): string => {
  const start = src.indexOf(`${key}: {`);
  if (start < 0) return '';
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(from, i);
};

/** `animate-*` utilities the config generates, name → declaration. */
const configAnimations = new Map<string, string>();
for (const m of section(config, 'animation').matchAll(/'([\w-]+)':\s*'([^']+)'/g)) {
  configAnimations.set(m[1], m[2]);
}

/** `@keyframes` names the config owns. */
const configKeyframes = new Set(
  [...section(config, 'keyframes').matchAll(/^\s{8}([\w-]+):\s*\{/gm)].map((m) => m[1]),
);

/** Strip comments so documentation prose is never parsed as CSS. */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** `.animate-*` rules written by hand in globals.css. */
const globalsAnimations = new Set(
  [...cssCode.matchAll(/(?<![\w.-])\.animate-([\w-]+)\s*\{/g)].map((m) => m[1]),
);
/** `@keyframes` written by hand in globals.css. */
const globalsKeyframes = new Set(
  [...cssCode.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => m[1]),
);

const reduceBlock = (() => {
  const i = cssCode.indexOf('@media (prefers-reduced-motion: reduce)');
  expect(i).toBeGreaterThan(-1);
  let depth = 0;
  let j = cssCode.indexOf('{', i);
  const from = j;
  for (; j < cssCode.length; j++) {
    if (cssCode[j] === '{') depth++;
    else if (cssCode[j] === '}') { depth--; if (depth === 0) break; }
  }
  return cssCode.slice(from, j);
})();

/** Matches `.animate-x`, and the `[class*="animate-x"]` form used for variants. */
const coveredByReduceBlock = (name: string) =>
  new RegExp(`animate-${name}(?![\\w-])`).test(reduceBlock);

describe('the animation vocabulary has one definition per name', () => {
  it('never defines the same animate-* utility in both files', () => {
    const both = [...configAnimations.keys()].filter((n) => globalsAnimations.has(n));
    expect(both).toEqual([]);
  });

  it('never defines the same @keyframes in both files', () => {
    const both = [...configKeyframes].filter((n) => globalsKeyframes.has(n));
    expect(both).toEqual([]);
  });

  it('leaves no config animation referencing keyframes it does not own', () => {
    // A config utility pointing at globals.css keyframes is the cross-file
    // coupling that made `float-delayed` run the wrong distance.
    const orphans: string[] = [];
    for (const [name, decl] of configAnimations) {
      const keyframeName = decl.trim().split(/\s+/)[0];
      if (!configKeyframes.has(keyframeName)) orphans.push(`${name} -> ${keyframeName}`);
    }
    expect(orphans).toEqual([]);
  });
});

describe('prefers-reduced-motion reaches every infinite animation', () => {
  it('covers every infinite animation defined in tailwind.config.js', () => {
    const uncovered = [...configAnimations]
      .filter(([, decl]) => decl.includes('infinite'))
      .map(([name]) => name)
      .filter((name) => !coveredByReduceBlock(name));
    // These were ALL missing until 2026-08: the reduce block only ever listed
    // animations defined in globals.css.
    expect(uncovered).toEqual([]);
  });

  it('covers every infinite animation defined in globals.css', () => {
    const uncovered = [...globalsAnimations].filter((name) => {
      const rule = cssCode.match(
        new RegExp(`(?<![\\w.-])\\.animate-${name}\\s*\\{([^}]*)\\}`),
      );
      return rule?.[1].includes('infinite') && !coveredByReduceBlock(name);
    });
    expect(uncovered).toEqual([]);
  });

  it('covers the infinite Tailwind built-ins the app actually uses', () => {
    // `spin` is the deliberate exception — it only marks a request in flight,
    // which WCAG 2.2.2 treats as essential activity.
    for (const name of ['pulse', 'bounce', 'ping']) {
      expect(coveredByReduceBlock(name), `animate-${name} not covered`).toBe(true);
    }
  });

  it('covers shimmer in its variant form, which a bare class cannot match', () => {
    // Shipped only as `group-hover:animate-shimmer` (Button) — Tailwind emits
    // that as a DIFFERENT class name, so `.animate-shimmer` never matches it.
    expect(reduceBlock).toMatch(/\[class\*=["']animate-shimmer["']\]/);
  });
});
