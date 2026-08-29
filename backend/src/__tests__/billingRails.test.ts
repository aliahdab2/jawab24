/**
 * The one cross-rail predicate the three marketplace adopt-over guards share.
 * Before it, each guard carried a literal list that omitted every OFFLINE
 * method — a Salla install could rewrite a paid Sham Cash row to a trial.
 */
import { describe, it, expect } from 'vitest';
import { OFFLINE_PAYMENT_METHODS } from '@jawab24/shared';
import { collidesWithLiveRail, MANAGED_PAYMENT_METHODS } from '../config/billingRails';

describe('collidesWithLiveRail', () => {
    it.each([...OFFLINE_PAYMENT_METHODS])('protects a live %s row from every marketplace', (method) => {
        expect(collidesWithLiveRail(method, 'salla')).toBe(true);
        expect(collidesWithLiveRail(method, 'zid')).toBe(true);
        expect(collidesWithLiveRail(method, 'shopify')).toBe(true);
    });

    it.each([...MANAGED_PAYMENT_METHODS])('protects a live %s row from the OTHER marketplaces', (method) => {
        for (const self of ['salla', 'zid', 'shopify'] as const) {
            expect(collidesWithLiveRail(method, self)).toBe(method !== self);
        }
    });

    it('lets a rail re-adopt its own row, and ignores a fresh trial with no method', () => {
        expect(collidesWithLiveRail('salla', 'salla')).toBe(false);
        expect(collidesWithLiveRail(null, 'salla')).toBe(false);
        expect(collidesWithLiveRail(undefined, 'zid')).toBe(false);
        expect(collidesWithLiveRail('', 'shopify')).toBe(false);
    });

    it('does not protect an unknown string — a typo is not a paying relationship', () => {
        expect(collidesWithLiveRail('shamcash', 'salla')).toBe(false);
    });
});
