import { describe, it, expect } from 'vitest';
import { CATALOG_VERTICALS, CATALOG_VERTICAL_DEFAULT_TYPE, verticalFromFbCategory } from '../index';

describe('verticalFromFbCategory — Meta page category → catalog vertical', () => {
    it('maps the real categories of the studied merchant archetypes', () => {
        // The four businesses the feature was designed against (2026-07-12 study)
        expect(verticalFromFbCategory('Computer company')).toBe('electronics');      // النبع للحاسبات
        expect(verticalFromFbCategory('Car dealership')).toBe('vehicles');           // معرض الأحمد
        expect(verticalFromFbCategory('Education')).toBe('education');               // الفريق الدمشقي
        expect(verticalFromFbCategory('Mobile phone shop')).toBe('electronics');     // شركة الامتياز (Borofone)
    });

    it('maps common Meta category strings per vertical', () => {
        expect(verticalFromFbCategory('Automotive repair shop')).toBe('vehicles');
        expect(verticalFromFbCategory('Tutor/Teacher')).toBe('education');
        expect(verticalFromFbCategory('Restaurant')).toBe('restaurant');
        expect(verticalFromFbCategory('Beauty salon')).toBe('beauty');
        expect(verticalFromFbCategory("Women's clothing store")).toBe('fashion');
        expect(verticalFromFbCategory('Real estate agent')).toBe('real_estate');
        expect(verticalFromFbCategory('Furniture store')).toBe('home_goods');
        expect(verticalFromFbCategory('Cleaning service')).toBe('services');
    });

    it('understands Arabic category strings (localized Graph responses)', () => {
        expect(verticalFromFbCategory('معرض سيارات')).toBe('vehicles');
        expect(verticalFromFbCategory('معهد تدريب')).toBe('education');
        expect(verticalFromFbCategory('صالون تجميل')).toBe('beauty');
        expect(verticalFromFbCategory('متجر ملابس')).toBe('fashion');
    });

    it('prefers the specific vertical over the generic "services" catch-all', () => {
        // "service" appears in the string, but the domain word must win.
        expect(verticalFromFbCategory('Mobile phone repair service')).toBe('electronics');
        expect(verticalFromFbCategory('Automotive service')).toBe('vehicles');
    });

    it('returns null for unknown, empty, or absent categories (caller falls back)', () => {
        expect(verticalFromFbCategory('Public figure')).toBeNull();
        expect(verticalFromFbCategory('')).toBeNull();
        expect(verticalFromFbCategory(null)).toBeNull();
        expect(verticalFromFbCategory(undefined)).toBeNull();
    });

    it('every vertical has a default item type (exhaustive record)', () => {
        for (const v of CATALOG_VERTICALS) {
            expect(CATALOG_VERTICAL_DEFAULT_TYPE[v]).toBeTruthy();
        }
        expect(CATALOG_VERTICAL_DEFAULT_TYPE.vehicles).toBe('vehicle');
        expect(CATALOG_VERTICAL_DEFAULT_TYPE.education).toBe('course');
    });
});
