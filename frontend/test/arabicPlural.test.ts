import { describe, it, expect } from 'vitest';
import IntlMessageFormat from 'intl-messageformat';

/**
 * The gate the Arabic plurals never had.
 *
 * `icuPlural.test.ts` globs `en/*.json` only — by design, since it checks the
 * vitest mock against production for the locale the mock loads. `npm run
 * translation:validate` strips ICU before comparing keys, and every reply-mode
 * E2E case runs `/en/settings`. So an Arabic plural could lose a branch, or
 * carry a malformed one, and the whole suite stayed green while every Arabic
 * merchant — the majority of the fleet — saw a raw key or a broken sentence.
 *
 * Arabic has SIX plural categories (zero/one/two/few/many/other) against
 * English's two. That is exactly why the gap matters here and not there: a
 * message written by someone thinking in English is short by four branches, and
 * the missing ones only surface at counts nobody types into a test by hand.
 */
const AR = Object.entries(
    import.meta.glob('../src/i18n/ar/*.json', { eager: true }) as Record<string, { default: unknown }>,
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

/** One count per Arabic CLDR category. */
const BY_CATEGORY: Array<[string, number]> = [
    ['zero', 0], ['one', 1], ['two', 2], ['few', 3], ['many', 11], ['other', 100],
];

/**
 * Plurals that predate this gate and are missing a branch. Carried, not fixed:
 * they live in five unrelated namespaces and Arabic copy is owner-reviewed, so
 * correcting them belongs in its own change — the same reason
 * `scripts/duplication-baseline.json` exists. Anything NEW fails.
 *
 * All six are the `zero` branch, where ICU falls back to `other` and renders
 * «0 …» — grammatical, merely not the phrasing Rule 5 asks for.
 */
const KNOWN_MISSING: string[] = [
    'admin.playground.historyCount:zero',
    'notifications.groupSummary:zero',
    'onboarding.pageLimitReached:zero',
    'onboarding.pageLimitInfo:zero',
    'pricing.daysLeftCount:zero',
    'team.limitHint:zero',
];

const argsFor = (raw: string, n: number) => {
    const args: Record<string, unknown> = {};
    for (const m of raw.matchAll(/\{(\w+)\s*,\s*plural/g)) args[m[1]] = n;
    for (const m of raw.matchAll(/\{(\w+)\}/g)) if (!(m[1] in args)) args[m[1]] = String(n);
    return args;
};

describe('Arabic plural messages', () => {
    it('has a corpus — an empty glob would make every assertion below vacuous', () => {
        expect(AR.length).toBeGreaterThan(0);
    });

    // Formatting only — NOT non-emptiness. An empty branch is a legitimate
    // authoring choice for a count the component never renders (`business.lists
    // .datesRowsRetired` writes `zero {}` on purpose, as does this PR's own
    // dead-end warning, whose guard is `count > 0`).
    it.each(BY_CATEGORY)('every AR plural formats at the %s category (count %i)', (_cat, n) => {
        const broken: string[] = [];
        for (const { id, raw } of AR) {
            try {
                const out = new IntlMessageFormat(raw, 'ar').format(argsFor(raw, n));
                if (typeof out !== 'string') broken.push(`${id}: non-string render`);
            } catch (err) {
                broken.push(`${id}: ${(err as Error).message}`);
            }
        }
        expect(broken.join('\n')).toBe('');
    });

    /**
     * The mutation this kills: delete `other {…}` (or any single branch) from an
     * Arabic plural. `intl-messageformat` then falls back to another branch and
     * renders the WRONG grammatical form rather than throwing, so a
     * formats-without-error check alone would pass.
     */
    it('declares all six categories on every AR plural', () => {
        const missing: string[] = [];
        for (const { id, raw } of AR) {
            for (const [cat] of BY_CATEGORY) {
                if (!new RegExp(`(^|[\\s{])${cat}\\s*\\{`).test(raw)) missing.push(`${id}:${cat}`);
            }
        }
        const unexpected = missing.filter((m) => !KNOWN_MISSING.includes(m));
        expect(unexpected.join('\n')).toBe('');
    });

    // The baseline must not rot: fix one of these and this fails until it is
    // removed from the list, so the backlog can only shrink. Same contract as
    // `scripts/duplication-baseline.json`.
    it('carries no stale baseline entries', () => {
        const present: string[] = [];
        for (const { id, raw } of AR) {
            for (const [cat] of BY_CATEGORY) {
                if (!new RegExp(`(^|[\\s{])${cat}\\s*\\{`).test(raw)) present.push(`${id}:${cat}`);
            }
        }
        expect(KNOWN_MISSING.filter((k) => !present.includes(k))).toEqual([]);
    });
});
