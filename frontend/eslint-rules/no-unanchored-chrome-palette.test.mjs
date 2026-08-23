import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule, { isChromeFile, RAW_NEUTRAL } from './no-unanchored-chrome-palette.mjs';

/**
 * Run with: node --test frontend/eslint-rules/  (or via `npm run lint:rules`).
 *
 * Fixtures are the real strings this rule was written for, not synthetic ones:
 *  - the invalid cases are the exact class lists that stood in Sidebar.tsx,
 *    ThemeToggleButton.tsx and AdminLayout.tsx before they were anchored
 *  - the valid cases are the shapes the rule must NEVER flag, because flagging
 *    them is what would get it switched off
 *
 * Mutation check: drop `zinc` from RAW_NEUTRAL, or make CHROME_FILES match
 * every file, and a named case below fails.
 */

const CHROME = '/repo/frontend/src/components/layout/Sidebar.tsx';
const ORDINARY = '/repo/frontend/src/components/dashboard/SmartStatusBanner.tsx';

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('no-unanchored-chrome-palette', () => {
  tester.run('no-unanchored-chrome-palette', rule, {
    valid: [
      {
        name: 'the anchored replacement — a semantic class, no palette step',
        filename: CHROME,
        code: `const c = 'flex items-center sidebar-nav-item group/nav relative';`,
      },
      {
        name: 'opacity scrims and absolutes carry no palette step',
        filename: CHROME,
        code: `const c = 'bg-white/5 text-white hover:bg-black/40';`,
      },
      {
        name: 'non-neutral hues are already anchored tokens (active nav states)',
        filename: CHROME,
        code: `const c = 'bg-brand-400/10 text-brand-400 shadow-brand-400/20';`,
      },
      {
        name: 'amber admin-active state is deliberate and must stay usable',
        filename: CHROME,
        code: `const c = 'bg-amber-600 text-white shadow-xl shadow-amber-600/20';`,
      },
      {
        name: 'THE KEEPABILITY CASE: raw palette outside chrome is out of scope',
        filename: ORDINARY,
        code: `const c = 'bg-rose-50 text-rose-900 border-rose-200 bg-slate-100';`,
      },
      {
        name: 'a bare word that merely contains a colour name is not a utility',
        filename: CHROME,
        code: `const c = 'zinc-ish slate-roof gray';`,
      },
    ],
    invalid: [
      {
        name: 'the rail hue that had three sources of truth',
        filename: CHROME,
        code: `const c = 'text-zinc-400 hover:bg-white/5 hover:text-white';`,
        errors: [{ messageId: 'unanchored' }],
      },
      {
        name: 'section label',
        filename: CHROME,
        code: `const c = 'text-[11px] font-bold text-zinc-500 uppercase';`,
        errors: [{ messageId: 'unanchored' }],
      },
      {
        name: 'sign-out row (neutral at rest, destructive on hover)',
        filename: CHROME,
        code: `const c = 'rounded-2xl text-zinc-200 hover:bg-red-500 hover:text-white';`,
        errors: [{ messageId: 'unanchored' }],
      },
      {
        name: 'the admin bar slab',
        filename: '/repo/frontend/src/components/layout/AdminLayout.tsx',
        code: `const c = 'sticky top-0 z-40 bg-zinc-900 text-white shadow-lg';`,
        errors: [{ messageId: 'unanchored' }],
      },
      {
        name: 'variant-prefixed hover step is still a palette step',
        filename: '/repo/frontend/src/components/ui/ThemeToggleButton.tsx',
        code: `const c = 'p-1.5 hover:bg-zinc-800 rounded-lg';`,
        errors: [{ messageId: 'unanchored' }],
      },
      {
        name: 'inside clsx(), reported once per string not once per hit',
        filename: CHROME,
        code: `const c = clsx('text-zinc-400 border-zinc-700', open && 'text-zinc-500');`,
        errors: [{ messageId: 'unanchored' }, { messageId: 'unanchored' }],
      },
      {
        name: 'template literal chunk',
        filename: CHROME,
        // eslint-disable-next-line no-template-curly-in-string
        code: 'const c = `px-3 text-slate-400 ${x}`;',
        errors: [{ messageId: 'unanchored' }],
      },
    ],
  });
});

test('isChromeFile matches only the declared chrome components', () => {
  assert.equal(isChromeFile('/repo/frontend/src/components/layout/Sidebar.tsx'), true);
  assert.equal(isChromeFile('/repo/frontend/src/components/ui/ThemeToggleButton.tsx'), true);
  // Windows separators must not defeat the check.
  assert.equal(isChromeFile('C:\\repo\\frontend\\src\\components\\layout\\AdminLayout.tsx'), true);
  // A same-named file elsewhere is not chrome.
  assert.equal(isChromeFile('/repo/frontend/src/components/blog/Sidebar.tsx'), false);
  assert.equal(isChromeFile(undefined), false);
});

test('RAW_NEUTRAL covers variants and opacity but not absolutes', () => {
  assert.match('hover:bg-zinc-800', RAW_NEUTRAL);
  assert.match('dark:text-slate-300/60', RAW_NEUTRAL);
  assert.match('group-hover:border-gray-200', RAW_NEUTRAL);
  assert.doesNotMatch('bg-white/5', RAW_NEUTRAL);
  assert.doesNotMatch('text-brand-400', RAW_NEUTRAL);
});
