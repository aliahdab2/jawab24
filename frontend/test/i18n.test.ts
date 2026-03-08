import { describe, it, expect } from 'vitest';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

/** Recursively collect all leaf key paths from a nested object */
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

/** Resolve a dot-notation key from nested object */
function resolve(obj: Record<string, unknown>, key: string): string | undefined {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'string' ? current : undefined;
}

describe('Internationalization (i18n)', () => {
    it('English and Arabic translation files should have the same keys', () => {
        const enKeys = collectKeys(en).sort();
        const arKeys = collectKeys(ar as Record<string, unknown>).sort();

        const missingInAr = enKeys.filter(key => !arKeys.includes(key));
        const extraInAr = arKeys.filter(key => !enKeys.includes(key));

        expect(missingInAr, `Missing keys in ar.json: ${missingInAr.join(', ')}`).toEqual([]);
        expect(extraInAr, `Extra keys in ar.json (not in en.json): ${extraInAr.join(', ')}`).toEqual([]);
    });

    it('No translation value should be an empty string', () => {
        for (const key of collectKeys(en)) {
            const value = resolve(en, key);
            expect(value?.trim(), `Empty translation value for English key: ${key}`).not.toBe('');
        }
        for (const key of collectKeys(ar as Record<string, unknown>)) {
            const value = resolve(ar as Record<string, unknown>, key);
            expect(value?.trim(), `Empty translation value for Arabic key: ${key}`).not.toBe('');
        }
    });

    it('Parameterized strings should have matching placeholders', () => {
        // ICU MessageFormat uses {var, plural, ...} — skip these and only check simple {var} placeholders
        const isICUPlural = (value: string) => /\{[^}]+,\s*plural\s*,/.test(value);

        // Extract simple placeholders like {name}, {amount} — not ICU syntax
        const getSimplePlaceholders = (value: string) => {
            if (isICUPlural(value)) return [];
            const matches = [...value.matchAll(/\{([a-zA-Z_]+)\}/g)].map(m => m[1]);
            return matches.sort();
        };

        for (const key of collectKeys(en)) {
            const enValue = resolve(en, key);
            const arValue = resolve(ar as Record<string, unknown>, key);
            if (!enValue || !arValue) continue;

            // Skip ICU plural keys — their structure differs between languages by design
            if (isICUPlural(enValue) || isICUPlural(arValue)) continue;

            const enPlaceholders = getSimplePlaceholders(enValue);
            const arPlaceholders = getSimplePlaceholders(arValue);

            expect(arPlaceholders, `Placeholder mismatch for key "${key}". \nEnglish: "${enValue}" \nArabic: "${arValue}"`).toEqual(enPlaceholders);
        }
    });

    it('Nesting should not exceed 3 levels', () => {
        function maxDepth(obj: Record<string, unknown>, depth = 1): number {
            let max = depth;
            for (const value of Object.values(obj)) {
                if (typeof value === 'object' && value !== null) {
                    max = Math.max(max, maxDepth(value as Record<string, unknown>, depth + 1));
                }
            }
            return max;
        }

        expect(maxDepth(en), 'EN nesting exceeds 3 levels').toBeLessThanOrEqual(3);
        expect(maxDepth(ar as Record<string, unknown>), 'AR nesting exceeds 3 levels').toBeLessThanOrEqual(3);
    });
});
