import { describe, it, expect } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { resolveICUPlural } from './icuPlural';

/**
 * The mock that stands in for `next-intl` in every suite must render what
 * PRODUCTION renders. When it does not, the failure is silent in the worst
 * way: a message comes back as plausible-looking text (raw ICU, or the wrong
 * branch) rather than throwing, so an assertion on it passes or fails for a
 * reason that has nothing to do with the code under test.
 *
 * That is not hypothetical. Two separate defects shipped this way and were
 * found only by writing this file (2026-08-20):
 *   1. a single-level regex could not match a plural whose branch body carried
 *      its own placeholder, so `lists.deleteListMessage`,
 *      `pages.pageLimitSkippedWarning`, `pages.trialUsedSkippedWarning` and
 *      `admin.waitlist.extraEmailsInvalid` rendered as RAW ICU in tests;
 *   2. an explicit `=0 {No products yet}` branch was ignored in favour of the
 *      locale category, so seven messages rendered «0 products» in tests while
 *      production rendered «No products yet».
 *
 * So the assertion is not "the resolver behaves the way I think". It is
 * "the resolver agrees with `intl-messageformat`" — the formatter next-intl
 * itself uses — over the REAL corpus. A message added tomorrow with a shape
 * the mock cannot handle fails here instead of quietly corrupting a suite.
 */

/** The mock's full pipeline: resolve plurals, then naive `{k}` substitution. */
const render = (raw: string, params: Record<string, unknown>): string =>
    Object.entries(params).reduce(
        (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
        resolveICUPlural(raw, params),
    );

/** Every EN message carrying a plural. EN only — the mock loads no other locale. */
const CORPUS: { id: string; raw: string }[] = Object.entries(
    import.meta.glob('../src/i18n/en/*.json', { eager: true }) as Record<string, { default: unknown }>,
).flatMap(([file, mod]) => {
    const ns = file.split('/').pop()?.replace('.json', '') ?? file;
    const out: { id: string; raw: string }[] = [];
    const walk = (node: unknown, keyPath: string) => {
        if (typeof node === 'string') {
            if (node.includes('plural')) out.push({ id: `${ns}.${keyPath}`, raw: node });
        } else if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) walk(v, keyPath ? `${keyPath}.${k}` : k);
        }
    };
    walk(mod.default, '');
    return out;
});

/**
 * Plausible arguments for one message: every `{name}` it mentions, with the
 * plural variables (and anything count-shaped) bound to `n`. Non-count
 * placeholders get a marker rather than a number so a branch that prints one
 * cannot accidentally agree by rendering the same digits.
 */
const argsFor = (raw: string, n: number): Record<string, unknown> => {
    const args: Record<string, unknown> = {};
    for (const m of raw.matchAll(/\{(\w+)(?=[},])/g)) args[m[1]] = `<${m[1]}>`;
    for (const m of raw.matchAll(/\{(\w+),\s*plural/g)) args[m[1]] = n;
    for (const k of Object.keys(args)) if (/count|num|total|shown|limit|minutes/i.test(k)) args[k] = n;
    return args;
};

/** 0 and 1 catch the explicit-`=0` and `one` branches; the rest exercise `other`. */
const COUNTS = [0, 1, 2, 3, 11, 100];

describe('the vitest next-intl mock renders what production renders', () => {
    it('has a corpus to check — an empty glob would make every assertion below vacuous', () => {
        expect(CORPUS.length).toBeGreaterThan(50);
    });

    it.each(COUNTS)('agrees with intl-messageformat on every EN plural message at count %i', (n) => {
        const mismatches: string[] = [];
        for (const { id, raw } of CORPUS) {
            const args = argsFor(raw, n);
            const truth = new IntlMessageFormat(raw, 'en').format(args);
            if (typeof truth !== 'string') continue;
            const mock = render(raw, args);
            if (mock !== truth) mismatches.push(`${id}\n  production: ${truth}\n  mock      : ${mock}`);
        }
        expect(mismatches.join('\n\n')).toBe('');
    });
});

describe('resolveICUPlural — the shapes the corpus does not currently contain', () => {
    it('reads a branch body that carries its own placeholder', () => {
        // Defect 1. A `[^{}]`-based pattern leaves this whole string untouched.
        const raw = '{count, plural, one {«{list}» and its # row} other {«{list}» and its # rows}}';
        expect(resolveICUPlural(raw, { count: 1, list: 'الأسعار' })).toBe('«{list}» and its 1 row');
    });

    it('prefers an explicit =N branch over the locale category', () => {
        // Defect 2. `Intl.PluralRules('en').select(0)` is 'other', so category-only
        // selection silently rendered the «0 products» branch.
        const raw = '{count, plural, =0 {No products yet} one {# product} other {# products}}';
        expect(resolveICUPlural(raw, { count: 0 })).toBe('No products yet');
        expect(resolveICUPlural(raw, { count: 1 })).toBe('1 product');
    });

    it('resolves a plural nested inside another plural branch', () => {
        const raw = '{count, plural, one {{pageNames} was not connected} other {{count} pages were not connected}}'
            + ' because your plan includes {limit, plural, one {one page} other {# pages}}';
        expect(resolveICUPlural(raw, { count: 1, limit: 3, pageNames: 'X' }))
            .toBe('{pageNames} was not connected because your plan includes 3 pages');
    });

    it('leaves a malformed message alone instead of hanging', () => {
        // An unbalanced message must not spin the `for` loop forever.
        const raw = '{count, plural, one {unclosed';
        expect(resolveICUPlural(raw, { count: 1 })).toBe(raw);
    });

    it('does not treat a category word inside a branch body as a branch', () => {
        const raw = '{count, plural, one {the other {thing}} other {many}}';
        expect(resolveICUPlural(raw, { count: 1 })).toBe('the other {thing}');
    });
});
