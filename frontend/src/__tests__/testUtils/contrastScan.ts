import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { css } from './cssSource';

/**
 * Measures the contrast of every `bg-*` / `text-*` pairing written in the app
 * source, in BOTH themes.
 *
 * Why this exists: the surface, brand and accent scales are deliberately
 * INVERTED in dark mode (`--surface-800` is near-black in light and near-white
 * in dark). That inversion is load-bearing for text tokens — `text-surface-800`
 * must be near-white in dark — but it is a trap for any element that pairs a
 * scale background with a foreground that does NOT flip with it. The background
 * moves, the foreground stays, and the text vanishes in exactly one theme.
 *
 * It has shipped twice, in both directions:
 *   - `.offline-banner` was `bg-surface-800 text-white` — 14.39:1 light,
 *     1.41:1 dark.
 *   - the collapsed-sidebar tooltips were `bg-surface-200 text-white` —
 *     18.08:1 dark, 1.23:1 light (invisible on the DEFAULT theme).
 *
 * Neither was caught by review, because reading a class string tells you
 * nothing about what the token resolves to in the other theme. Only measuring
 * does.
 *
 * Scope: source text only. This resolves the two palettes declared in
 * globals.css and does arithmetic on them. It cannot see the cascade, so
 * anything whose effective color depends on what is painted BEHIND it —
 * an opacity modifier (`dark:bg-brand-900/30`), an arbitrary value, a gradient
 * — is reported as unresolvable and skipped rather than guessed at. Guessing
 * there produced false positives against correctly-themed classes such as
 * `.status-brand`.
 */

const SRC = resolve(__dirname, '../..');

/** Replace comment bodies with spaces, preserving offsets and line count. */
export const stripComments = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

/**
 * A CSS `@apply` may wrap across lines, putting the `dark:` half on a later
 * line than the base half. Fold each statement onto its first line, blanking
 * the continuations so reported line numbers stay honest.
 */
const foldApply = (lines: string[]): string[] => {
  const out = lines.slice();
  for (let i = 0; i < out.length; i++) {
    if (!/@apply\b/.test(out[i]) || out[i].includes(';')) continue;
    for (let j = i + 1; j < out.length; j++) {
      out[i] += ' ' + out[j].trim();
      const done = out[j].includes(';');
      out[j] = '';
      if (done) break;
    }
  }
  return out;
};

// ── palette ────────────────────────────────────────────────────────────────

const PARSEABLE = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

const tokensIn = (selector: string): Record<string, [number, number, number]> => {
  const out: Record<string, [number, number, number]> = {};
  const re = new RegExp(`(?:^|[},])\\s*${selector}\\s*\\{([^{}]*)\\}`, 'g');
  for (const [, body] of PARSEABLE.matchAll(re)) {
    for (const m of body.matchAll(/--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
      out[m[1]] = [+m[2], +m[3], +m[4]];
    }
  }
  return out;
};

const LIGHT = tokensIn(':root');
/** Dark redefines only some tokens; the rest fall through to :root. */
const DARK = { ...LIGHT, ...tokensIn('\\.dark') };

export type Theme = 'light' | 'dark';

const SCALES = 'surface|brand|accent';

const resolveToken = (name: string, theme: Theme): [number, number, number] | null => {
  if (name === 'white') return [255, 255, 255];
  if (name === 'black') return [0, 0, 0];
  return (theme === 'dark' ? DARK : LIGHT)[name] ?? null;
};

const luminance = ([r, g, b]: [number, number, number]): number => {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export const contrast = (
  a: [number, number, number],
  b: [number, number, number],
): number => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

// ── scanning ───────────────────────────────────────────────────────────────

const solidRe = (kind: 'bg' | 'text') =>
  new RegExp(`(?:^|\\s)(dark:)?${kind}-(?:(${SCALES})-(\\d+)|(white|black))(?![\\w/-])`, 'g');
/** A dark override we cannot resolve: opacity modifier or arbitrary value. */
const opaqueRe = (kind: 'bg' | 'text') =>
  new RegExp(`(?:^|\\s)dark:${kind}-(?:(?:${SCALES})-\\d+/\\d+|\\[)`);

const collect = (chunk: string, kind: 'bg' | 'text') => {
  let light: string | null = null;
  let dark: string | null = null;
  for (const m of chunk.matchAll(solidRe(kind))) {
    const tok = m[4] ?? `${m[2]}-${m[3]}`;
    if (m[1]) dark = tok;
    else if (light === null) light = tok;
  }
  return { light, dark };
};

export interface Pairing {
  file: string;
  line: number;
  /** Ratio and resolved tokens per theme. */
  light: { ratio: number; fg: string; bg: string };
  dark: { ratio: number; fg: string; bg: string };
}

/** Extract every measurable pairing from one chunk of class text. */
export const pairingsInChunk = (chunk: string): Omit<Pairing, 'file' | 'line'>[] => {
  const bg = collect(chunk, 'bg');
  const fg = collect(chunk, 'text');
  if (bg.light === null || fg.light === null) return [];
  // A translucent/arbitrary dark override means the effective dark color is
  // unknown; do not pretend the light token still applies.
  if (bg.dark === null && opaqueRe('bg').test(chunk)) return [];
  if (fg.dark === null && opaqueRe('text').test(chunk)) return [];

  const per: Record<Theme, { ratio: number; fg: string; bg: string }> = {} as never;
  for (const theme of ['light', 'dark'] as Theme[]) {
    const b = theme === 'dark' ? bg.dark ?? bg.light : bg.light;
    const g = theme === 'dark' ? fg.dark ?? fg.light : fg.light;
    const bc = resolveToken(b, theme);
    const gc = resolveToken(g, theme);
    if (!bc || !gc) return [];
    per[theme] = { ratio: contrast(gc, bc), fg: g, bg: b };
  }
  return [{ light: per.light, dark: per.dark }];
};

/**
 * Shipped UI source only. Specs are skipped because their fixtures quote the
 * broken pairings on purpose — this file's own mutation check would otherwise
 * be reported as a live bug.
 */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p, out);
    } else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
};

/** Every measurable pairing written anywhere under frontend/src. */
export const allPairings = (): Pairing[] => {
  const found: Pairing[] = [];
  for (const file of walk(SRC)) {
    const raw = stripComments(readFileSync(file, 'utf-8'));
    let lines = raw.split('\n');
    if (file.endsWith('.css')) lines = foldApply(lines);
    lines.forEach((line, i) => {
      // Quotes and braces bound a class string; a pairing only counts when both
      // halves sit in the SAME string, since that is what ships on one element.
      for (const chunk of line.split(/['"`{}]/)) {
        for (const p of pairingsInChunk(chunk)) {
          found.push({ ...p, file: relative(SRC, file), line: i + 1 });
        }
      }
    });
  }
  return found;
};

/** AA floor for normal-size text. */
export const AA = 4.5;

/** Pairings that pass in one theme and fail in the other — the inversion trap. */
export const inversionBugs = (ps = allPairings()): Pairing[] =>
  ps.filter((p) => p.light.ratio >= AA !== (p.dark.ratio >= AA));
