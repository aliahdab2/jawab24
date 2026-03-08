import { describe, it, expect } from 'vitest';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

describe('Internationalization (i18n)', () => {
    it('English and Arabic translation files should have the same keys', () => {
        const enKeys = Object.keys(en).sort();
        const arKeys = Object.keys(ar).sort();

        // Check for missing keys in Arabic
        const missingInAr = enKeys.filter(key => !arKeys.includes(key));
        // Check for extra keys in Arabic
        const extraInAr = arKeys.filter(key => !enKeys.includes(key));

        expect(missingInAr, `Missing keys in ar.json: ${missingInAr.join(', ')}`).toEqual([]);
        expect(extraInAr, `Extra keys in ar.json (not in en.json): ${extraInAr.join(', ')}`).toEqual([]);
    });

    it('No translation value should be an empty string', () => {
        Object.entries(en).forEach(([key, value]) => {
            expect(value.trim(), `Empty translation value for English key: ${key}`).not.toBe('');
        });
        Object.entries(ar).forEach(([key, value]) => {
            expect(value.trim(), `Empty translation value for Arabic key: ${key}`).not.toBe('');
        });
    });

    it('Parameterized strings should have matching placeholders', () => {
        // ICU MessageFormat uses {var, plural, ...} — skip these and only check simple {var} placeholders
        const isICUPlural = (value: string) => /\{[^}]+,\s*plural\s*,/.test(value);

        // Extract simple placeholders like {name}, {amount} — not ICU syntax
        const getSimplePlaceholders = (value: string) => {
            // Remove ICU plural blocks first (they have nested braces)
            if (isICUPlural(value)) return [];
            const matches = [...value.matchAll(/\{([a-zA-Z_]+)\}/g)].map(m => m[1]);
            return matches.sort();
        };

        Object.entries(en).forEach(([key, enValue]) => {
            const arValue = (ar as Record<string, string>)[key];
            if (!arValue) return;

            // Skip ICU plural keys — their structure differs between languages by design
            // (Arabic has 6 plural forms, English has 2, and some Arabic forms embed the count in the word)
            if (isICUPlural(enValue) || isICUPlural(arValue)) return;

            const enPlaceholders = getSimplePlaceholders(enValue);
            const arPlaceholders = getSimplePlaceholders(arValue);

            expect(arPlaceholders, `Placeholder mismatch for key "${key}". \nEnglish: "${enValue}" \nArabic: "${arValue}"`).toEqual(enPlaceholders);
        });
    });
});
