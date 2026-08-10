import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/ecommerce', () => ({
    hasActiveStoreForBillingSubject: vi.fn(),
}));

import { mustBillThroughSalla } from '../../src/services/sallaBilling';
import { hasActiveStoreForBillingSubject } from '../../src/services/ecommerce';

const hasStore = vi.mocked(hasActiveStoreForBillingSubject);

describe('mustBillThroughSalla', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('is true for a Salla merchant with no established Stripe billing', async () => {
        hasStore.mockResolvedValue(true);

        await expect(mustBillThroughSalla('user_1', { status: 'trialing' })).resolves.toBe(true);
        expect(hasStore).toHaveBeenCalledWith('salla', 'user_1');
    });

    it('is false when the account has no active Salla store', async () => {
        hasStore.mockResolvedValue(false);

        await expect(mustBillThroughSalla('user_1', { status: 'trialing' })).resolves.toBe(false);
    });

    /**
     * The owner ruling (2026-08-10): a direct jawab24.com customer already
     * paying through Stripe who later connects a Salla store was never a
     * Salla-sourced sale — their billing rail stays untouched.
     */
    it('exempts an established Stripe payer even when a Salla store is connected', async () => {
        hasStore.mockResolvedValue(true);

        await expect(
            mustBillThroughSalla('user_1', { paymentMethod: 'stripe', status: 'active' }),
        ).resolves.toBe(false);
    });

    it('short-circuits before the store query for an exempt merchant', async () => {
        hasStore.mockResolvedValue(true);

        await mustBillThroughSalla('user_1', { paymentMethod: 'stripe', status: 'active' });

        expect(hasStore).not.toHaveBeenCalled();
    });

    it('still applies when there is no subscription row at all', async () => {
        hasStore.mockResolvedValue(true);

        await expect(mustBillThroughSalla('user_1', null)).resolves.toBe(true);
        await expect(mustBillThroughSalla('user_1', undefined)).resolves.toBe(true);
    });

    /**
     * A canceled Stripe subscription is not a live relationship — the merchant
     * is back to square one and, being Salla-connected, must re-subscribe
     * through Salla rather than Stripe.
     */
    it('applies again once a former Stripe subscription is canceled', async () => {
        hasStore.mockResolvedValue(true);

        await expect(
            mustBillThroughSalla('user_1', { paymentMethod: 'stripe', status: 'canceled' }),
        ).resolves.toBe(true);
    });
});
