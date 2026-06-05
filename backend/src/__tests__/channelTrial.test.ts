/**
 * Tests for the channel-trial anti-abuse gate.
 *
 * Rule under test: a connected channel (FB page / IG account / WhatsApp number)
 * gets ONE free trial, bound to the first account that enabled it. A different,
 * non-paying account that reconnects the same channel is blocked from enabling
 * auto-reply for free; a paying account (or the original owner) is allowed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.select(...).from(...).where(...) resolves to whatever we stage here.
const { mockWhere, mockHasPaid } = vi.hoisted(() => ({
    mockWhere: vi.fn(),
    mockHasPaid: vi.fn(),
}));

vi.mock('../db', () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
        from: vi.fn(),
        where: mockWhere,
    };
    chain.from.mockReturnValue(chain);
    return { db: { select: vi.fn().mockReturnValue(chain) } };
});

// Keep the real isPayingCustomer; stub only the async service method.
vi.mock('../services/subscriptions', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/subscriptions')>();
    return {
        ...actual,
        subscriptionsService: { ...actual.subscriptionsService, hasPaidSubscription: mockHasPaid },
    };
});

import { channelTrialService } from '../services/channelTrial';
import { isPayingCustomer } from '../services/subscriptions';

describe('isPayingCustomer', () => {
    it('treats a free-signup trial (no Stripe ids, no payment method) as NOT paying', () => {
        expect(isPayingCustomer({ status: 'trialing', externalSubscriptionId: null, stripeCustomerId: null, paymentMethod: null })).toBe(false);
    });

    it('treats a lapsed/canceled trial with no billing artifacts as NOT paying', () => {
        expect(isPayingCustomer({ status: 'canceled', externalSubscriptionId: null, stripeCustomerId: null, paymentMethod: null })).toBe(false);
        expect(isPayingCustomer({ status: 'past_due', externalSubscriptionId: null, stripeCustomerId: null, paymentMethod: null })).toBe(false);
    });

    it('treats a Stripe subscription as paying even mid Stripe-managed trial', () => {
        expect(isPayingCustomer({ status: 'trialing', externalSubscriptionId: 'sub_123', stripeCustomerId: 'cus_1', paymentMethod: 'stripe' })).toBe(true);
        expect(isPayingCustomer({ status: 'active', externalSubscriptionId: 'sub_123', stripeCustomerId: 'cus_1', paymentMethod: 'stripe' })).toBe(true);
    });

    it('treats an active manual (comp) account as paying, but not a canceled comp', () => {
        expect(isPayingCustomer({ status: 'active', externalSubscriptionId: null, stripeCustomerId: null, paymentMethod: 'manual' })).toBe(true);
        expect(isPayingCustomer({ status: 'canceled', externalSubscriptionId: null, stripeCustomerId: null, paymentMethod: 'manual' })).toBe(false);
    });
});

describe('channelTrialService.channelsForPage', () => {
    it('includes only the channels present on the page', () => {
        expect(channelTrialService.channelsForPage({ facebookPageId: 'fb1' })).toEqual([
            { type: 'facebook', id: 'fb1' },
        ]);
        expect(channelTrialService.channelsForPage({
            facebookPageId: 'fb1', instagramAccountId: 'ig1', whatsappPhoneNumberId: 'wa1',
        })).toEqual([
            { type: 'facebook', id: 'fb1' },
            { type: 'instagram', id: 'ig1' },
            { type: 'whatsapp', id: 'wa1' },
        ]);
        expect(channelTrialService.channelsForPage({ facebookPageId: null, instagramAccountId: null })).toEqual([]);
    });
});

describe('channelTrialService.evaluate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows when no channels are supplied (never hits the db)', async () => {
        const result = await channelTrialService.evaluate('user-A', []);
        expect(result).toEqual({ blocked: false });
        expect(mockWhere).not.toHaveBeenCalled();
        expect(mockHasPaid).not.toHaveBeenCalled();
    });

    it('allows when the channel has no prior claim', async () => {
        mockWhere.mockResolvedValueOnce([]);
        const result = await channelTrialService.evaluate('user-A', [{ type: 'facebook', id: 'fb1' }]);
        expect(result).toEqual({ blocked: false });
        expect(mockHasPaid).not.toHaveBeenCalled(); // no need to check billing
    });

    it('allows when the channel is claimed by the SAME user (own re-connect)', async () => {
        mockWhere.mockResolvedValueOnce([{ firstUserId: 'user-A' }]);
        const result = await channelTrialService.evaluate('user-A', [{ type: 'facebook', id: 'fb1' }]);
        expect(result).toEqual({ blocked: false });
        expect(mockHasPaid).not.toHaveBeenCalled();
    });

    it('BLOCKS when claimed by a different, non-paying user (the abuse case)', async () => {
        mockWhere.mockResolvedValueOnce([{ firstUserId: 'user-A' }]);
        mockHasPaid.mockResolvedValueOnce(false);
        const result = await channelTrialService.evaluate('user-B', [{ type: 'facebook', id: 'fb1' }]);
        expect(result).toEqual({ blocked: true });
    });

    it('allows when claimed by a different but PAYING user (legit takeover)', async () => {
        mockWhere.mockResolvedValueOnce([{ firstUserId: 'user-A' }]);
        mockHasPaid.mockResolvedValueOnce(true);
        const result = await channelTrialService.evaluate('user-B', [{ type: 'facebook', id: 'fb1' }]);
        expect(result).toEqual({ blocked: false });
    });

    it('BLOCKS a fresh non-paying account even when the original owner is gone (null claim)', async () => {
        mockWhere.mockResolvedValueOnce([{ firstUserId: null }]);
        mockHasPaid.mockResolvedValueOnce(false);
        const result = await channelTrialService.evaluate('user-B', [{ type: 'instagram', id: 'ig1' }]);
        expect(result).toEqual({ blocked: true });
    });
});
