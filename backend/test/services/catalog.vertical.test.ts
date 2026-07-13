import { describe, it, expect } from 'vitest';
import { resolveCatalogVertical } from '../../src/services/catalog';

/**
 * Pure vertical resolution: merchant override → FB category (merged profile,
 * merchant half wins) → 'other'. The `source` drives the UI (the picker hides
 * when Facebook already told us the type), so provenance is asserted too.
 */
describe('resolveCatalogVertical', () => {
    const profileWith = (category: string) => ({ merchant: {}, suggestions: { category } });

    it('merchant override wins over everything', () => {
        expect(resolveCatalogVertical('vehicles', profileWith('Computer company')))
            .toEqual({ effective: 'vehicles', source: 'merchant' });
    });

    it('derives from the FB page category when no override is stored', () => {
        expect(resolveCatalogVertical(null, profileWith('Car dealership')))
            .toEqual({ effective: 'vehicles', source: 'facebook' });
    });

    it('a merchant-edited category (merged profile) beats the FB suggestion', () => {
        const profile = { merchant: { category: 'Education' }, suggestions: { category: 'Computer company' } };
        expect(resolveCatalogVertical(null, profile))
            .toEqual({ effective: 'education', source: 'facebook' });
    });

    it('handles the stringified-jsonb storage form (drizzle jsonb-as-string gotcha)', () => {
        expect(resolveCatalogVertical(null, JSON.stringify(profileWith('Beauty salon')) as never))
            .toEqual({ effective: 'beauty', source: 'facebook' });
    });

    it('falls back to other/default for empty profiles and unmapped categories', () => {
        expect(resolveCatalogVertical(null, {})).toEqual({ effective: 'other', source: 'default' });
        expect(resolveCatalogVertical(null, null)).toEqual({ effective: 'other', source: 'default' });
        expect(resolveCatalogVertical(null, profileWith('Public figure')))
            .toEqual({ effective: 'other', source: 'default' });
    });

    it('an invalid stored value (enum drift) falls through to derivation, never breaks', () => {
        expect(resolveCatalogVertical('spaceships', profileWith('Car dealership')))
            .toEqual({ effective: 'vehicles', source: 'facebook' });
    });
});
