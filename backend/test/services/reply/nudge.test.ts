import { describe, it, expect } from 'vitest';
import { pickNudgeVariation, DEFAULT_NUDGE_VARIATIONS } from '../../../src/services/reply/nudge';

describe('Nudge Variations', () => {
    describe('DEFAULT_NUDGE_VARIATIONS', () => {
        it('should have Arabic variations', () => {
            expect(DEFAULT_NUDGE_VARIATIONS.ar).toBeDefined();
            expect(DEFAULT_NUDGE_VARIATIONS.ar.length).toBeGreaterThanOrEqual(5);
        });

        it('should have English variations', () => {
            expect(DEFAULT_NUDGE_VARIATIONS.en).toBeDefined();
            expect(DEFAULT_NUDGE_VARIATIONS.en.length).toBeGreaterThanOrEqual(5);
        });

        it('all variations must be under 80 characters', () => {
            for (const [lang, variations] of Object.entries(DEFAULT_NUDGE_VARIATIONS)) {
                for (const v of variations) {
                    expect(v.length, `${lang} variation "${v}" exceeds 80 chars`).toBeLessThanOrEqual(80);
                }
            }
        });

        it('all variations must be non-empty', () => {
            for (const variations of Object.values(DEFAULT_NUDGE_VARIATIONS)) {
                for (const v of variations) {
                    expect(v.trim().length).toBeGreaterThan(0);
                }
            }
        });

        it('all variations should be unique within each language', () => {
            for (const [lang, variations] of Object.entries(DEFAULT_NUDGE_VARIATIONS)) {
                const unique = new Set(variations);
                expect(unique.size, `${lang} has duplicate variations`).toBe(variations.length);
            }
        });
    });

    describe('pickNudgeVariation', () => {
        it('should return a string under 80 characters', () => {
            const result = pickNudgeVariation(null, 'ar');
            expect(typeof result).toBe('string');
            expect(result.length).toBeLessThanOrEqual(80);
            expect(result.length).toBeGreaterThan(0);
        });

        it('should pick from custom variations when available for the language', () => {
            const custom = {
                ar: ['رسالة مخصصة 1', 'رسالة مخصصة 2'],
                en: ['Custom 1', 'Custom 2'],
            };

            // Run many times to ensure it always picks from custom
            const results = new Set<string>();
            for (let i = 0; i < 50; i++) {
                results.add(pickNudgeVariation(custom, 'ar'));
            }

            for (const r of results) {
                expect(custom.ar).toContain(r);
            }
        });

        it('should fall back to any custom variation if language not found', () => {
            const custom = {
                ar: ['رسالة عربية'],
            };

            // Request 'en' but only 'ar' exists — should get Arabic
            const result = pickNudgeVariation(custom, 'en');
            expect(result).toBe('رسالة عربية');
        });

        it('should fall back to defaults when no custom variations', () => {
            const result = pickNudgeVariation(null, 'en');
            expect(DEFAULT_NUDGE_VARIATIONS.en).toContain(result);
        });

        it('should fall back to defaults when custom is empty object', () => {
            const result = pickNudgeVariation({}, 'ar');
            expect(DEFAULT_NUDGE_VARIATIONS.ar).toContain(result);
        });

        it('should fall back to Arabic defaults for unknown language', () => {
            const result = pickNudgeVariation(null, 'fr');
            expect(DEFAULT_NUDGE_VARIATIONS.ar).toContain(result);
        });

        it('should truncate variations longer than 80 chars', () => {
            const custom = {
                en: ['A'.repeat(100)],
            };
            const result = pickNudgeVariation(custom, 'en');
            expect(result.length).toBe(80);
        });

        it('should produce different results over multiple calls (randomness)', () => {
            const custom = {
                ar: ['خيار 1', 'خيار 2', 'خيار 3', 'خيار 4', 'خيار 5'],
            };

            const results = new Set<string>();
            for (let i = 0; i < 100; i++) {
                results.add(pickNudgeVariation(custom, 'ar'));
            }

            // With 5 options and 100 picks, we should see at least 2 unique values
            expect(results.size).toBeGreaterThanOrEqual(2);
        });

        it('should skip empty arrays in custom variations', () => {
            const custom = {
                en: [] as string[],
                ar: ['الخيار الوحيد'],
            };
            const result = pickNudgeVariation(custom, 'en');
            // Empty en array should be skipped; falls through to ar custom
            expect(result).toBe('الخيار الوحيد');
        });

        it('should work with undefined variationsMulti', () => {
            const result = pickNudgeVariation(undefined, 'ar');
            expect(DEFAULT_NUDGE_VARIATIONS.ar).toContain(result);
        });
    });
});
