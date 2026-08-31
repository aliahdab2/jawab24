import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plan } from '@jawab24/shared';

const mockOpenExternalUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/openExternalUrl', () => ({ openExternalUrl: mockOpenExternalUrl }));

const framed = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/embeddedBreakout', () => ({ isFramed: () => framed.value }));

import { openMarketplaceManageUrl, localizeZidDashboardUrl, visiblePlansFor } from '@/lib/marketplaceBilling';

const ZID_PLANS = 'https://dashboard.zid.sa/ar-sa/stores/3195980/apps/7367/plans';

describe('localizeZidDashboardUrl', () => {
    it('swaps the dashboard locale segment to the language the merchant is reading us in', () => {
        expect(localizeZidDashboardUrl(ZID_PLANS, 'en')).toBe('https://dashboard.zid.sa/en-sa/stores/3195980/apps/7367/plans');
        expect(localizeZidDashboardUrl('https://dashboard.zid.sa/en-sa/stores/1/apps/7367/plans', 'ar'))
            .toBe('https://dashboard.zid.sa/ar-sa/stores/1/apps/7367/plans');
    });

    it('leaves the URL alone for an unknown locale, and never touches a non-Zid URL', () => {
        expect(localizeZidDashboardUrl(ZID_PLANS, undefined)).toBe(ZID_PLANS);
        expect(localizeZidDashboardUrl(ZID_PLANS, 'fr')).toBe(ZID_PLANS);
        expect(localizeZidDashboardUrl('https://admin.shopify.com/store/x/charges', 'en'))
            .toBe('https://admin.shopify.com/store/x/charges');
    });
});

describe('openMarketplaceManageUrl', () => {
    let assign: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        framed.value = false;
        assign = vi.fn();
        vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as unknown as Window);
    });

    afterEach(() => vi.restoreAllMocks());

    // Mutation-checked: removing the isFramed() branch fails this (a new tab
    // would open a second Zid dashboard beside the one framing us).
    it('inside a platform frame, navigates the TOP window in place — the destination IS the dashboard framing us', async () => {
        framed.value = true;

        await openMarketplaceManageUrl(ZID_PLANS, 'en');

        expect(assign).toHaveBeenCalledWith('https://dashboard.zid.sa/en-sa/stores/3195980/apps/7367/plans');
        expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });

    it('outside a frame, takes the external-URL path (new tab on web, in-app browser on native)', async () => {
        await openMarketplaceManageUrl(ZID_PLANS, 'ar');

        expect(mockOpenExternalUrl).toHaveBeenCalledWith(ZID_PLANS);
        expect(assign).not.toHaveBeenCalled();
    });
});

describe('visiblePlansFor', () => {
    const plan = (slug: string, ecommerceEnabled: boolean, isActive = true) =>
        ({ id: slug, slug, ecommerceEnabled, isActive } as unknown as Plan);
    const grid = [plan('basic', false), plan('starter', false), plan('business', true), plan('pro', true), plan('legacy', true, false)];

    it('shows every active plan to a merchant billed by us', () => {
        expect(visiblePlansFor(grid, null).map((p) => p.slug)).toEqual(['basic', 'starter', 'business', 'pro']);
    });

    // D-103/D-120: a marketplace lists only the plans its own shelf sells —
    // Zid sells Starter since D-120, Salla still does not. The fuller per-shelf
    // matrix lives in marketplaceBilling.test.ts; this stays as the smoke pin.
    it('shows a marketplace-billed merchant only the plans the marketplace sells', () => {
        expect(visiblePlansFor(grid, { marketplace: 'zid' }).map((p) => p.slug)).toEqual(['starter', 'business', 'pro']);
        expect(visiblePlansFor(grid, { marketplace: 'salla' }).map((p) => p.slug)).toEqual(['business', 'pro']);
    });
});
