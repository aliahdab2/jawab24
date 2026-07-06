import { describe, it, expect } from 'vitest';
import { CatalogItemSchema, CatalogItemUpdateSchema } from '../../src/utils/validation';

describe('CatalogItemSchema', () => {
    it('accepts a name-only item and applies defaults (Simplicity contract §1)', () => {
        const parsed = CatalogItemSchema.parse({ name: 'دبل صدمات NJT' });
        expect(parsed).toEqual({
            type: 'product',
            name: 'دبل صدمات NJT',
            description: null,
            price: null,
            currency: null,
            isAvailable: true,
        });
    });

    it('rejects an empty/whitespace name', () => {
        expect(CatalogItemSchema.safeParse({ name: '' }).success).toBe(false);
        expect(CatalogItemSchema.safeParse({ name: '   ' }).success).toBe(false);
        expect(CatalogItemSchema.safeParse({}).success).toBe(false);
    });

    it('rejects unknown types and over-long fields', () => {
        expect(CatalogItemSchema.safeParse({ name: 'x', type: 'realestate' }).success).toBe(false);
        expect(CatalogItemSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
        expect(CatalogItemSchema.safeParse({ name: 'x', description: 'y'.repeat(601) }).success).toBe(false);
        expect(CatalogItemSchema.safeParse({ name: 'x', currency: 'y'.repeat(11) }).success).toBe(false);
    });

    describe('price normalization (Simplicity contract §5 — accept what merchants type)', () => {
        const priceOf = (raw: unknown) => CatalogItemSchema.parse({ name: 'x', price: raw }).price;

        it('accepts plain numbers', () => {
            expect(priceOf(3500)).toBe(3500);
            expect(priceOf(49.99)).toBe(49.99);
        });

        it('accepts Arabic-Indic digits', () => {
            expect(priceOf('٣٥٠٠')).toBe(3500);
        });

        it('accepts Eastern Arabic (Persian-style) digits', () => {
            expect(priceOf('۳۵۰۰')).toBe(3500);
        });

        it('accepts thousands separators (Latin and Arabic)', () => {
            expect(priceOf('3,500')).toBe(3500);
            expect(priceOf('٣٬٥٠٠')).toBe(3500);
            expect(priceOf('1 250')).toBe(1250);
        });

        it('accepts the Arabic decimal separator', () => {
            expect(priceOf('٤٩٫٩٩')).toBe(49.99);
        });

        it('treats empty/null as "price on request"', () => {
            expect(priceOf('')).toBeNull();
            expect(priceOf(null)).toBeNull();
            expect(CatalogItemSchema.parse({ name: 'x' }).price).toBeNull();
        });

        it('rejects negatives and garbage', () => {
            expect(CatalogItemSchema.safeParse({ name: 'x', price: -5 }).success).toBe(false);
            expect(CatalogItemSchema.safeParse({ name: 'x', price: 'مجانا تقريبا' }).success).toBe(false);
        });
    });
});

describe('CatalogItemUpdateSchema', () => {
    it('accepts a partial body', () => {
        const parsed = CatalogItemUpdateSchema.parse({ isAvailable: false });
        expect(parsed).toEqual({ isAvailable: false });
    });

    it('accepts sortOrder for reordering', () => {
        expect(CatalogItemUpdateSchema.parse({ sortOrder: 3 })).toEqual({ sortOrder: 3 });
        expect(CatalogItemUpdateSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
    });

    it('rejects an empty body', () => {
        expect(CatalogItemUpdateSchema.safeParse({}).success).toBe(false);
    });
});
