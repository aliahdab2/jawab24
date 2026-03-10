import { describe, it, expect } from 'vitest';

// Load all namespace files from both languages eagerly
const enModules = import.meta.glob('../src/i18n/en/*.json', { eager: true });
const arModules = import.meta.glob('../src/i18n/ar/*.json', { eager: true });

function getNamespace(path: string): string {
    return path.replace(/.*\/([^/]+)\.json$/, '$1');
}

function mergeNamespaces(modules: Record<string, unknown>): Record<string, Record<string, unknown>> {
    const merged: Record<string, Record<string, unknown>> = {};
    for (const [path, mod] of Object.entries(modules)) {
        const ns = getNamespace(path);
        merged[ns] = (mod as { default: Record<string, unknown> }).default;
    }
    return merged;
}

const EN = mergeNamespaces(enModules);
const AR = mergeNamespaces(arModules);

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            keys.push(fullKey);
        } else if (typeof value === 'object' && value !== null) {
            keys.push(...collectKeys(value as Record<string, unknown>, fullKey));
        }
    }
    return keys;
}

function resolve(obj: Record<string, unknown>, key: string): string | undefined {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'string' ? current : undefined;
}

const enNamespaces = Object.keys(EN).sort();
const arNamespaces = Object.keys(AR).sort();

describe('i18n namespace files', () => {
    it('EN and AR have the same set of namespace files', () => {
        const missingInAr = enNamespaces.filter(ns => !arNamespaces.includes(ns));
        const extraInAr = arNamespaces.filter(ns => !enNamespaces.includes(ns));
        expect(missingInAr, `Namespaces missing in ar/: ${missingInAr.join(', ')}`).toEqual([]);
        expect(extraInAr, `Extra namespaces in ar/ not in en/: ${extraInAr.join(', ')}`).toEqual([]);
    });

    it('each namespace has the same keys in EN and AR', () => {
        for (const ns of enNamespaces) {
            if (!AR[ns]) continue;
            const enKeys = collectKeys(EN[ns]).sort();
            const arKeys = collectKeys(AR[ns]).sort();
            const missingInAr = enKeys.filter(k => !arKeys.includes(k));
            const extraInAr = arKeys.filter(k => !enKeys.includes(k));
            expect(missingInAr, `[${ns}] Missing in ar: ${missingInAr.join(', ')}`).toEqual([]);
            expect(extraInAr, `[${ns}] Extra in ar: ${extraInAr.join(', ')}`).toEqual([]);
        }
    });

    it('no translation value should be an empty string', () => {
        for (const ns of enNamespaces) {
            for (const key of collectKeys(EN[ns])) {
                const value = resolve(EN[ns], key);
                expect(value?.trim(), `[en/${ns}] Empty value for key: ${key}`).not.toBe('');
            }
        }
        for (const ns of arNamespaces) {
            for (const key of collectKeys(AR[ns])) {
                const value = resolve(AR[ns], key);
                expect(value?.trim(), `[ar/${ns}] Empty value for key: ${key}`).not.toBe('');
            }
        }
    });

    it('parameterized strings have matching placeholders in EN and AR', () => {
        const isICUPlural = (v: string) => /\{[^}]+,\s*plural\s*,/.test(v);
        const getSimplePlaceholders = (v: string) => {
            if (isICUPlural(v)) return [];
            return [...v.matchAll(/\{([a-zA-Z_]+)\}/g)].map(m => m[1]).sort();
        };
        for (const ns of enNamespaces) {
            if (!AR[ns]) continue;
            for (const key of collectKeys(EN[ns])) {
                const enValue = resolve(EN[ns], key);
                const arValue = resolve(AR[ns], key);
                if (!enValue || !arValue) continue;
                if (isICUPlural(enValue) || isICUPlural(arValue)) continue;
                expect(
                    getSimplePlaceholders(arValue),
                    `[${ns}] Placeholder mismatch for "${key}"\n  EN: "${enValue}"\n  AR: "${arValue}"`
                ).toEqual(getSimplePlaceholders(enValue));
            }
        }
    });

    it('nesting should not exceed 2 levels within each namespace file', () => {
        function maxDepth(obj: Record<string, unknown>, depth = 1): number {
            let max = depth;
            for (const value of Object.values(obj)) {
                if (typeof value === 'object' && value !== null) {
                    max = Math.max(max, maxDepth(value as Record<string, unknown>, depth + 1));
                }
            }
            return max;
        }
        for (const ns of enNamespaces) {
            expect(maxDepth(EN[ns]), `[en/${ns}] nesting exceeds 2 levels`).toBeLessThanOrEqual(2);
        }
        for (const ns of arNamespaces) {
            expect(maxDepth(AR[ns]), `[ar/${ns}] nesting exceeds 2 levels`).toBeLessThanOrEqual(2);
        }
    });

    it('no translation value should use the (s) plural workaround', () => {
        // ICU plural format must be used instead of "(s)" suffixes.
        // ❌ "item(s)" → ✅ "{count, plural, one {# item} other {# items}}"
        const sWorkaround = /\(\s*s\s*\)/i;
        for (const ns of enNamespaces) {
            for (const key of collectKeys(EN[ns])) {
                const value = resolve(EN[ns], key);
                expect(
                    value,
                    `[en/${ns}.${key}] Uses "(s)" workaround — use ICU plural: "{count, plural, one {# item} other {# items}}"`
                ).not.toMatch(sWorkaround);
            }
        }
        // Arabic plural workarounds (e.g. "صفحة/صفحات") are enforced via the ICU consistency tests below:
        // if a key has an EN ICU plural, the AR version must also use ICU plural (not a slash workaround).
    });

    it('ICU plural strings in AR include the 5 required CLDR forms', () => {
        // Arabic requires: one, two, few, many, other (zero is optional — handled by "other")
        const icuPluralPattern = /\{[^}]+,\s*plural\s*,/;
        const requiredForms = ['one', 'two', 'few', 'many', 'other'];
        for (const ns of arNamespaces) {
            for (const key of collectKeys(AR[ns])) {
                const value = resolve(AR[ns], key);
                if (!value || !icuPluralPattern.test(value)) continue;
                for (const form of requiredForms) {
                    expect(
                        value,
                        `[ar/${ns}.${key}] ICU plural missing "${form}" form — Arabic requires one, two, few, many, other`
                    ).toContain(`${form} {`);
                }
            }
        }
    });

    it('ICU plural strings in EN include the required one and other forms', () => {
        const icuPluralPattern = /\{[^}]+,\s*plural\s*,/;
        for (const ns of enNamespaces) {
            for (const key of collectKeys(EN[ns])) {
                const value = resolve(EN[ns], key);
                if (!value || !icuPluralPattern.test(value)) continue;
                expect(value, `[en/${ns}.${key}] ICU plural missing "one" form`).toContain('one {');
                expect(value, `[en/${ns}.${key}] ICU plural missing "other" form`).toContain('other {');
            }
        }
    });

    it('keys using ICU plural in one language also use ICU plural in the other', () => {
        // Prevents mixing ICU in EN with (s) workaround in AR, or vice versa.
        const isICUPlural = (v: string) => /\{[^}]+,\s*plural\s*,/.test(v);
        for (const ns of enNamespaces) {
            if (!AR[ns]) continue;
            for (const key of collectKeys(EN[ns])) {
                const enValue = resolve(EN[ns], key);
                const arValue = resolve(AR[ns], key);
                if (!enValue || !arValue) continue;
                if (isICUPlural(enValue)) {
                    expect(
                        isICUPlural(arValue),
                        `[${ns}.${key}] EN uses ICU plural but AR does not`
                    ).toBe(true);
                }
                if (isICUPlural(arValue)) {
                    expect(
                        isICUPlural(enValue),
                        `[${ns}.${key}] AR uses ICU plural but EN does not`
                    ).toBe(true);
                }
            }
        }
    });
});
