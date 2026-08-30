import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/ecommerce', () => ({
    hasActiveStoreForBillingSubject: vi.fn(),
    getActiveStoreForBillingSubject: vi.fn(),
}));

// The Zid manage link is built from config (app id) + the store's merchant id;
// pinned here so the assertions below do not depend on the test runner's env.
vi.mock('../../src/config', () => ({
    config: {
        zid: { appId: '7367', appMarketUrl: '' },
        salla: { appStoreUrl: '', appId: '' },
        shopify: {},
    },
}));

import { resolveMarketplaceBilling } from '../../src/services/marketplaceBilling';
import { hasActiveStoreForBillingSubject, getActiveStoreForBillingSubject } from '../../src/services/ecommerce';

const hasStore = vi.mocked(hasActiveStoreForBillingSubject);
const getStore = vi.mocked(getActiveStoreForBillingSubject);

/** The dev store's identity, as captured at install. */
const ZID_STORE = { id: 'store-zid', platformData: { merchantId: '3195980' } };
const ZID_PLANS_URL = 'https://dashboard.zid.sa/ar-sa/stores/3195980/apps/7367/plans';

/** Nobody has a marketplace store unless a test says so. */
const noStores = () => {
    hasStore.mockResolvedValue(false);
    getStore.mockResolvedValue(null);
};
/** Only `platform` has an active store for the subject. */
const onlyStore = (platform: string, store = ZID_STORE) => {
    hasStore.mockImplementation(async (p: string) => p === platform);
    getStore.mockImplementation(async (p: string) => (p === platform ? store : null));
};

describe('resolveMarketplaceBilling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Salla (Article 5) — behaviour carried over from mustBillThroughSalla', () => {
        it('applies to a Salla merchant with no established Stripe billing', async () => {
            onlyStore('salla');

            const verdict = await resolveMarketplaceBilling('user_1', { status: 'trialing' });

            expect(verdict?.marketplace).toBe('salla');
            expect(verdict?.code).toBe('SALLA_BILLED');
            expect(hasStore).toHaveBeenCalledWith('salla', 'user_1');
        });

        it('does not apply when the account has no active Salla store', async () => {
            noStores();

            await expect(
                resolveMarketplaceBilling('user_1', { status: 'trialing' }),
            ).resolves.toBeNull();
        });

        /**
         * The owner ruling (2026-08-10): a direct jawab24.com customer already
         * paying through Stripe who later connects a Salla store was never a
         * Salla-sourced sale — their billing rail stays untouched.
         */
        it('exempts an established Stripe payer even when a Salla store is connected', async () => {
            onlyStore('salla');

            await expect(
                resolveMarketplaceBilling('user_1', { paymentMethod: 'stripe', status: 'active' }),
            ).resolves.toBeNull();
        });

        it('short-circuits before the store queries for an exempt merchant', async () => {
            onlyStore('salla');

            await resolveMarketplaceBilling('user_1', { paymentMethod: 'stripe', status: 'active' });

            expect(hasStore).not.toHaveBeenCalled();
        });

        it('still applies when there is no subscription row at all', async () => {
            onlyStore('salla');

            expect((await resolveMarketplaceBilling('user_1', null))?.marketplace).toBe('salla');
            expect((await resolveMarketplaceBilling('user_1', undefined))?.marketplace).toBe('salla');
        });

        /**
         * A canceled Stripe subscription is not a live relationship — the
         * merchant is back to square one and, being Salla-connected, must
         * re-subscribe through Salla rather than Stripe.
         */
        it('applies again once a former Stripe subscription is canceled', async () => {
            onlyStore('salla');

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'stripe',
                status: 'canceled',
            });

            expect(verdict?.marketplace).toBe('salla');
        });

        it('offers no manage URL until SALLA_APP_STORE_URL is configured (post-publish)', async () => {
            onlyStore('salla');

            const verdict = await resolveMarketplaceBilling('user_1', null);

            expect(verdict?.manageUrl).toBeUndefined();
        });

        // --- Row-based (D-104): a live salla mirror is positive proof Salla is
        // charging this merchant — no store query, and it outranks the Stripe
        // exemption like the other row-based rails. ---

        it('applies to a live salla mirror without any store query', async () => {
            noStores();

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'salla',
                status: 'active',
            });

            expect(verdict?.marketplace).toBe('salla');
            expect(verdict?.code).toBe('SALLA_BILLED');
            expect(hasStore).not.toHaveBeenCalled();
        });

        it('does NOT apply to a canceled mirror — an uninstalled merchant may return via Stripe', async () => {
            noStores();

            await expect(
                resolveMarketplaceBilling('user_1', { paymentMethod: 'salla', status: 'canceled' }),
            ).resolves.toBeNull();
        });

        it('still applies to a paused mirror — re-subscribing inside Salla is the recovery path', async () => {
            noStores();

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'salla',
                status: 'paused',
            });

            expect(verdict?.marketplace).toBe('salla');
        });
    });

    describe('Shopify (D-G) — row-based, unchanged', () => {
        it('applies to a live shopify mirror without any store query', async () => {
            noStores();

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'shopify',
                status: 'active',
            });

            expect(verdict?.marketplace).toBe('shopify');
            expect(verdict?.code).toBe('SHOPIFY_BILLED');
            expect(hasStore).not.toHaveBeenCalled();
        });

        it('does NOT apply to a canceled mirror — the merchant may return via Stripe', async () => {
            noStores();

            await expect(
                resolveMarketplaceBilling('user_1', { paymentMethod: 'shopify', status: 'canceled' }),
            ).resolves.toBeNull();
        });

        it('still applies to a paused mirror — re-picking a plan inside Shopify is the recovery path', async () => {
            noStores();

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'shopify',
                status: 'paused',
            });

            expect(verdict?.marketplace).toBe('shopify');
        });
    });

    describe('Zid (App Market)', () => {
        it('applies to a live zid mirror without any store query', async () => {
            noStores();

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'zid',
                status: 'active',
            });

            expect(verdict?.marketplace).toBe('zid');
            expect(verdict?.code).toBe('ZID_BILLED');
            expect(hasStore).not.toHaveBeenCalled();
        });

        it('does NOT apply to a canceled mirror — an uninstalled merchant may return via Stripe', async () => {
            noStores();

            await expect(
                resolveMarketplaceBilling('user_1', { paymentMethod: 'zid', status: 'canceled' }),
            ).resolves.toBeNull();
        });

        it('still applies to a paused mirror — re-subscribing inside Zid is the recovery path', async () => {
            noStores();

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'zid',
                status: 'paused',
            });

            expect(verdict?.marketplace).toBe('zid');
        });

        it('applies to a connected Zid store that has no mirror yet', async () => {
            onlyStore('zid');

            const verdict = await resolveMarketplaceBilling('user_1', { status: 'trialing' });

            expect(verdict?.marketplace).toBe('zid');
            // The Zid leg reads the ROW (it needs the merchant id for the link).
            expect(getStore).toHaveBeenCalledWith('zid', 'user_1');
        });

        it('exempts an established Stripe payer who later connects a Zid store', async () => {
            onlyStore('zid');

            await expect(
                resolveMarketplaceBilling('user_1', { paymentMethod: 'stripe', status: 'active' }),
            ).resolves.toBeNull();
        });

        /**
         * The dashboard URL shape was observed live on 2026-08-30 (the app's
         * Overview page links "Manage" to `/plans`), so the verdict now names the
         * merchant's own plans page — built from the store's captured merchant id.
         */
        it('links a store-based verdict to the plans page of our app inside the merchant\'s dashboard', async () => {
            onlyStore('zid');

            const verdict = await resolveMarketplaceBilling('user_1', null);

            expect(verdict?.marketplace).toBe('zid');
            expect(verdict?.manageUrl).toBe(ZID_PLANS_URL);
        });

        it('links a mirror-based verdict the same way, from the same store', async () => {
            onlyStore('zid');

            const verdict = await resolveMarketplaceBilling('user_1', { paymentMethod: 'zid', status: 'active' });

            expect(verdict?.manageUrl).toBe(ZID_PLANS_URL);
            expect(getStore).toHaveBeenCalledWith('zid', 'user_1');
        });

        /**
         * A store row that predates the captured merchant id has no link to
         * offer — and an absent link must never be read as "no suppression".
         */
        it('suppresses Stripe with no link when the store carries no merchant id', async () => {
            onlyStore('zid', { id: 'store-zid', platformData: {} });

            const verdict = await resolveMarketplaceBilling('user_1', null);

            expect(verdict?.marketplace).toBe('zid');
            expect(verdict?.manageUrl).toBeUndefined();
        });
    });

    describe('order between rails', () => {
        /**
         * A row-based rail is positive proof a marketplace is already charging
         * this merchant, so it must outrank the Stripe exemption — otherwise a
         * merchant with both would be sent to a second checkout.
         */
        it('a live zid mirror outranks the Stripe exemption', async () => {
            noStores();

            const verdict = await resolveMarketplaceBilling('user_1', {
                paymentMethod: 'zid',
                status: 'active',
            });

            expect(verdict?.marketplace).toBe('zid');
        });

        it('Salla is answered before Zid when a merchant somehow has both stores', async () => {
            hasStore.mockResolvedValue(true);

            const verdict = await resolveMarketplaceBilling('user_1', { status: 'trialing' });

            expect(verdict?.marketplace).toBe('salla');
        });
    });
});
