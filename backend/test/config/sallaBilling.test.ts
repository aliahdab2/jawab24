import { describe, it, expect } from 'vitest';
import { hasLiveStripeBilling, SALLA_BILLED_CODE } from '../../src/config/sallaBilling';

/**
 * The Article-5 exemption predicate. Its whole job is to answer "is this an
 * established, currently-live Stripe relationship we must not disturb?" — so
 * the tests that matter are the ones that would make the guard useless (a
 * blanket exemption) or hostile (exempting nobody).
 */
describe('hasLiveStripeBilling', () => {
    it('exempts a merchant actively paying through Stripe', () => {
        expect(hasLiveStripeBilling({ paymentMethod: 'stripe', status: 'active' })).toBe(true);
    });

    it.each(['active', 'trialing', 'past_due'])(
        'treats a stripe subscription in %s as live (the shared entitlement boundary)',
        (status) => {
            expect(hasLiveStripeBilling({ paymentMethod: 'stripe', status })).toBe(true);
        },
    );

    it.each(['canceled', 'paused'])(
        'does NOT exempt a stripe subscription in %s — nothing live to protect',
        (status) => {
            expect(hasLiveStripeBilling({ paymentMethod: 'stripe', status })).toBe(false);
        },
    );

    /**
     * THE regression that makes or breaks this feature. Every fresh signup is
     * inserted status='trialing' with payment_method NULL. If the predicate
     * ever exempts on status alone, every user on the platform is exempt and
     * the Article-5 guard silently never fires — which looks exactly like
     * "shipped and working" until Salla delists the app.
     */
    it('does NOT exempt a fresh trial with no payment method (the default signup row)', () => {
        expect(hasLiveStripeBilling({ paymentMethod: null, status: 'trialing' })).toBe(false);
        expect(hasLiveStripeBilling({ status: 'trialing' })).toBe(false);
    });

    it('does NOT exempt other rails — only Stripe is an "already paying us" signal', () => {
        expect(hasLiveStripeBilling({ paymentMethod: 'manual', status: 'active' })).toBe(false);
        expect(hasLiveStripeBilling({ paymentMethod: 'shopify', status: 'active' })).toBe(false);
    });

    it('tolerates a missing status without throwing', () => {
        expect(hasLiveStripeBilling({ paymentMethod: 'stripe' })).toBe(false);
        expect(hasLiveStripeBilling({ paymentMethod: 'stripe', status: null })).toBe(false);
    });

    it('pins the wire code clients switch on', () => {
        expect(SALLA_BILLED_CODE).toBe('SALLA_BILLED');
    });
});
