import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

/**
 * No source file may format a DATE or TIME in the browser's locale.
 *
 * `toLocaleDateString()` / `toLocaleTimeString()` with no locale, and any
 * `toLocale*String(undefined, …)`, resolve to the BROWSER's locale — the
 * device's language, not the app's. An Arabic dashboard on an English-locale
 * phone then prints «4 Sept 2026, 00:22» in English, inside RTL copy.
 *
 * WHY THIS PIN IS REPO-WIDE, AND NOT ONE MORE PER-FILE ASSERTION
 * ---------------------------------------------------------------
 * It started as a single-file pin on `pages/integrations.tsx` (2026-09-04,
 * store card's last-sync line). Reviewing that fix found the SAME defect in two
 * more places the single-file pin could never see:
 *
 *   LegalPageLayout.tsx  the «© 2026 Jawab24 • v<date>» stamp on /privacy —
 *                        the URL published as the Salla listing's privacy
 *                        policy, so a store reviewer reads it
 *   what-is-jawab24.tsx  a byte-identical copy of that same stamp
 *
 * A pin that names one file documents one fix; a pin that scans the tree
 * prevents the class. Rule 14 — prevention over detection.
 *
 * THE APP LOCALE is `getIntlLocale(locale)` from `@/utils/locale`
 * (`ar-SA-u-nu-latn` / `en-US`), reached via `useLanguage().intlLocale` in the
 * dashboard or `getIntlLocale(useLocale())` on public pages. Prefer the shared
 * helpers in `@/utils/dateUtils`, which also carry the null/NaN fallback.
 *
 * ⚠️ SCOPE. Bare `value.toLocaleString()` on a NUMBER is deliberately NOT
 * matched here. It has the same browser-locale weakness (Arabic-Indic digits on
 * an ar-EG device, defeating the `-u-nu-latn` tag), but it appears at ~50 call
 * sites and cleaning it up is its own change with its own review. This pin
 * covers the date/time forms, which are all currently clean. Widening it to
 * numbers is the obvious follow-up.
 *
 * Mutation check: put `toLocaleDateString()` back in VersionStamp.tsx, or
 * `toLocaleString(undefined,` back in AnalyticsKpiGrid.tsx — either must turn
 * this red and name the file.
 */

const SRC = resolve(__dirname, '../../');

/** Directories with no runtime source in them. */
const SKIP_DIRS = new Set(['__tests__', 'node_modules', '.next']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec|component\.test)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** Comments explain the very shapes this test forbids — strip them first. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/**
 * Browser-locale date/time formatting. Each pattern is the whole defect:
 * an explicit `undefined` locale, or none at all.
 */
const FORBIDDEN: ReadonlyArray<{ re: RegExp; why: string }> = [
  {
    re: /toLocale(?:Date|Time)?String\(\s*undefined\b/,
    why: "toLocale*String(undefined, …) formats in the browser's locale, not the app's",
  },
  {
    re: /toLocale(?:Date|Time)String\(\s*\)/,
    why: 'toLocaleDateString() / toLocaleTimeString() with no locale formats in the browser\'s locale',
  },
];

describe('date and time formatting uses the app locale', () => {
  it('has no browser-locale date/time formatting anywhere in frontend/src', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      for (const { re, why } of FORBIDDEN) {
        if (re.test(code)) offenders.push(`${relative(SRC, file)} — ${why}`);
      }
    }

    expect(
      offenders,
      `Format with the app locale instead: getIntlLocale(locale) from @/utils/locale, or a helper from @/utils/dateUtils.\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('scans a realistic number of files (guards against a broken walker)', () => {
    // A walker that silently returns [] would make the pin above vacuously
    // green. The tree held ~450 source files when this was written.
    expect(sourceFiles(SRC).length).toBeGreaterThan(200);
  });
});
