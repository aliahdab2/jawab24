import { describe, it, expect } from 'vitest';
import { findCategoryDefaults, CATEGORY_DEFAULTS } from '../../../src/services/kb/category-defaults';

describe('Category Defaults', () => {

    describe('findCategoryDefaults', () => {
        it('returns defaults for exact key match', () => {
            const result = findCategoryDefaults('restaurant');

            expect(result).not.toBeNull();
            expect(result!.safeFallbacks).toBeDefined();
            expect(result!.safeFallbacks.delivery).toBeDefined();
            expect(result!.safeFallbacks.delivery.ar).toBeTruthy();
            expect(result!.safeFallbacks.delivery.en).toBeTruthy();
        });

        it('returns defaults for Facebook category substring match', () => {
            // Facebook categories often include extra text
            const result = findCategoryDefaults('Restaurant/Cafe');
            expect(result).not.toBeNull();
            expect(result!.safeFallbacks.delivery).toBeDefined();
        });

        it('returns clothing_store defaults for clothing-related categories', () => {
            const result = findCategoryDefaults('Clothing (Brand)');
            expect(result).not.toBeNull();
            expect(result!.safeFallbacks.sizes).toBeDefined();
        });

        it('returns null for unknown category', () => {
            expect(findCategoryDefaults('unknown_business')).toBeNull();
        });

        it('returns null for empty string', () => {
            expect(findCategoryDefaults('')).toBeNull();
        });

        it('returns null for undefined', () => {
            expect(findCategoryDefaults(undefined)).toBeNull();
        });

        it('is case-insensitive', () => {
            const lower = findCategoryDefaults('restaurant');
            const upper = findCategoryDefaults('RESTAURANT');
            const mixed = findCategoryDefaults('Restaurant');

            expect(lower).not.toBeNull();
            expect(upper).not.toBeNull();
            expect(mixed).not.toBeNull();
            // All should resolve to the same category
            expect(lower).toEqual(upper);
            expect(upper).toEqual(mixed);
        });

        it('matches electronics-related categories', () => {
            expect(findCategoryDefaults('Electronics Store')).not.toBeNull();
            expect(findCategoryDefaults('Computer Shop')).not.toBeNull();
            expect(findCategoryDefaults('Mobile Phone Store')).not.toBeNull();
        });

        it('matches salon/beauty categories', () => {
            expect(findCategoryDefaults('Beauty Salon')).not.toBeNull();
            expect(findCategoryDefaults('Barber Shop')).not.toBeNull();
            expect(findCategoryDefaults('Spa & Wellness')).not.toBeNull();
        });

        it('matches education/training categories', () => {
            expect(findCategoryDefaults('Training Center')).not.toBeNull();
            expect(findCategoryDefaults('Education Academy')).not.toBeNull();
        });

        it('matches flower shop categories', () => {
            expect(findCategoryDefaults('Flower Shop')).not.toBeNull();
            expect(findCategoryDefaults('Florist')).not.toBeNull();
        });
    });

    describe('CATEGORY_DEFAULTS structure validation', () => {
        it('all category defaults have ar + en translations for every fallback', () => {
            for (const [categoryKey, categoryData] of Object.entries(CATEGORY_DEFAULTS)) {
                for (const [fallbackKey, fallback] of Object.entries(categoryData.safeFallbacks)) {
                    expect(fallback.ar, `${categoryKey}.${fallbackKey}.ar should be non-empty`).toBeTruthy();
                    expect(fallback.en, `${categoryKey}.${fallbackKey}.en should be non-empty`).toBeTruthy();
                    expect(typeof fallback.ar).toBe('string');
                    expect(typeof fallback.en).toBe('string');
                }
            }
        });

        it('has at least 5 categories defined', () => {
            expect(Object.keys(CATEGORY_DEFAULTS).length).toBeGreaterThanOrEqual(5);
        });

        it('every category has at least 2 fallback topics', () => {
            for (const [categoryKey, categoryData] of Object.entries(CATEGORY_DEFAULTS)) {
                expect(
                    Object.keys(categoryData.safeFallbacks).length,
                    `${categoryKey} should have at least 2 fallback topics`
                ).toBeGreaterThanOrEqual(2);
            }
        });
    });
});
