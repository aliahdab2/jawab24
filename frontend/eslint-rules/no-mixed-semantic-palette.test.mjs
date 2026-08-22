import { test } from 'node:test';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule from './no-mixed-semantic-palette.mjs';

/**
 * Run with: node --test frontend/eslint-rules/  (or via `npm run lint:rules`).
 *
 * The fixtures are the real shapes from the codebase, not synthetic ones:
 *  - the invalid object is the pre-2026-08 notificationUtils row, verbatim
 *  - the valid cases are the three places a naive palette rule WOULD have
 *    flagged and must not — they are what makes this rule keepable.
 *
 * Mutation check: loosen SEMANTIC to drop `notif`, or make RAW_NON_GRADIENT
 * include `from`/`to`, and a named case below fails.
 */

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('no-mixed-semantic-palette', () => tester.run('no-mixed-semantic-palette', rule, {
  valid: [
    // A fully semantic row — the fixed notificationUtils shape.
    { code: `const s = { icon: X, hue: 'amber', className: 'notif-amber' };` },

    // StatusControl's private map: raw palette, but NO semantic class beside
    // it. That is a product decision about lead colours, not a half-migration.
    {
      code: `const DOT = { contacted: 'bg-amber-500', converted: 'bg-emerald-500' };`,
    },

    // Instagram brand gradient. Gradient stops are identity, not a status hue,
    // and a naive purple rule would have tripped here.
    {
      code: `const c = clsx(isIg ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white' : 'bg-surface-200 text-icon-muted');`,
    },

    // SmartStatusBanner: rose utilities on a .card, no semantic class — the
    // utilities are there to win on specificity and must stay.
    {
      code: `const c = clsx('overflow-hidden', 'bg-rose-50 text-rose-900 border border-rose-200', 'dark:bg-rose-900 dark:text-rose-200', 'border-s-4 border-s-rose-500');`,
    },

    // A semantic class next to NON-palette utilities is fine.
    { code: `const c = clsx('status-warning border', 'px-2 py-1 rounded-lg', muted && 'opacity-50');` },

    // Two semantic classes together is the goal state.
    { code: `<div className="alert-critical icon-bg-critical border border-s-4" />` },

    // Scale tokens are the OTHER gate's job (scaleTokenContrast); not raw here.
    { code: `const c = clsx('status-brand', 'bg-surface-50 text-brand-700');` },
  ],

  invalid: [
    // The defect that shipped, verbatim: semantic ring + raw bg/text in one row.
    {
      code: `const S = { stale_message: { icon: Mail, iconColor: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-900/30', ringColor: 'notif-ring-orange' } };`,
      errors: [{ messageId: 'mixed' }],
    },
    // Same hue split across a clsx() call.
    {
      code: `const c = clsx('status-error border', 'text-red-600');`,
      errors: [{ messageId: 'mixed' }],
    },
    // Same hue split inside one string.
    {
      code: `<span className="alert-warning bg-amber-100 border" />`,
      errors: [{ messageId: 'mixed' }],
    },
    // A dark: variant is still a raw palette utility.
    {
      code: `const c = clsx('icon-bg-amber', 'dark:text-amber-300');`,
      errors: [{ messageId: 'mixed' }],
    },
    // Ternary branches inside clsx() count — the AiUsageWarningBanner shape:
    // a semantic class on one branch, raw sky on the other, for the same slot.
    {
      code: `const palette = clsx(stopped ? 'alert-critical' : onTopup ? 'bg-sky-50 text-sky-900' : 'alert-usage-warning');`,
      errors: [{ messageId: 'mixed' }],
    },
  ],
}));
