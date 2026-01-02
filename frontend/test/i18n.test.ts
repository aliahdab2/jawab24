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
        const placeholderRegex = /\{([^}]+)\}/g;

        Object.entries(en).forEach(([key, enValue]) => {
            const arValue = (ar as Record<string, string>)[key];
            if (!arValue) return;

            const enPlaceholders = [...enValue.matchAll(placeholderRegex)].map(m => m[1]).sort();
            const arPlaceholders = [...arValue.matchAll(placeholderRegex)].map(m => m[1]).sort();

            expect(arPlaceholders, `Placeholder mismatch for key "${key}". \nEnglish: "${enValue}" \nArabic: "${arValue}"`).toEqual(enPlaceholders);
        });
    });
});
