/**
 * Tests for the Shopify App Pricing → local subscription mirror.
 *
 * Why this module is paranoid: Shopify delivers NO webhook for App Pricing
 * enrollments (post-2026-04-28), so a missed sync means a paying merchant is
 * never activated — the same silent-failure class as the Stripe linking bug
 * (2026-07-25, $39 charged, trial served). Every rule here (D-A…D-J) exists to
 * keep that from recurring on the Shopify rail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() } }));

vi.mock('../../src/db/schema', () => ({
    subscriptions: {
        id: 'id', userId: 'user_id', planId: 'plan_id', status: 'status',
        externalSubscriptionId: 'external_subscription_id',
        paymentMethod: 'payment_method', shopifyShopDomain: 'shopify_shop_domain',
        currentPeriodStart: 'current_period_start', currentPeriodEnd: 'current_period_end',
        trialEndsAt: 'trial_ends_at', createdAt: 'created_at',
    },
    ecommerceStores: {
        id: 'id', platform: 'platform', storeDomain: 'store_domain',
        isActive: 'is_active', accessToken: 'access_token',
        accessTokenIv: 'access_token_iv', userId: 'user_id', workspaceId: 'workspace_id',
    },
    workspaces: { id: 'id', ownerId: 'owner_id' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...conds) => ({ conds, op: 'and' })),
    desc: vi.fn((field) => ({ field, op: 'desc' })),
    inArray: vi.fn((field, values) => ({ field, values, op: 'inArray' })),
    notInArray: vi.fn((field, values) => ({ field, values, op: 'notInArray' })),
}));

const mockGraphQL = vi.fn();
vi.mock('../../src/services/shopify', () => ({
    shopifyGraphQL: (...a: unknown[]) => mockGraphQL(...a),
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    decrypt: vi.fn(() => 'decrypted-token'),
}));

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        invalidateStatusCache: vi.fn().mockResolvedValue(undefined),
        initializeUsagePeriod: vi.fn().mockResolvedValue(undefined),
    },
}));

const mockGetPlanBySlug = vi.fn();
vi.mock('../../src/services/plans', () => ({
    plansService: { getPlanBySlug: (...a: unknown[]) => mockGetPlanBySlug(...a) },
}));

import {
    adoptShopifySubscription,
    cancelShopifySubscriptionLocal,
    syncShopifyBilling,
    reconcileShopifyBilling,
    type ShopifyAppSubscription,
} from '../../src/services/shopifyBilling';
import { db } from '../../src/db';
import { subscriptionsService } from '../../src/services/subscriptions';
import { q, mkLog } from '../helpers/drizzleQueryMock';

const GID = 'gid://shopify/AppSubscription/123';
const SHOP = 'jawab24-dev.myshopify.com';

const appSub = (over: Partial<ShopifyAppSubscription> = {}): ShopifyAppSubscription => ({
    id: GID,
    name: 'Business',
    status: 'ACTIVE',
    test: true,
    trialDays: 0,
    createdAt: '2026-07-01T00:00:00Z',
    currentPeriodEnd: '2026-09-01T00:00:00Z',
    ...over,
});

const graphqlActive = (subs: ShopifyAppSubscription[]) => ({
    data: { currentAppInstallation: { activeSubscriptions: subs } },
});

beforeEach(() => {
    vi.clearAllMocks();
    // mockReset (not just clear): drops leftover mockReturnValueOnce queues a
    // prior test didn't consume — clearAllMocks alone lets them leak forward.
    vi.mocked(db.select).mockReset().mockReturnValue(q([]) as never);
    vi.mocked(db.update).mockReset().mockReturnValue(q([]) as never);
    vi.mocked(db.insert).mockReset().mockReturnValue(q([]) as never);
    mockGetPlanBySlug.mockResolvedValue({ id: 'plan_business_id', slug: 'business' });
});

describe('adoptShopifySubscription', () => {
    it('fails loud on a plan name that maps to no slug (D-I) — no activation, Sentry', async () => {
        const result = await adoptShopifySubscription('u1', appSub({ name: 'Enterprise Gold' }), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'unknown_plan', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('fails loud when the mapped slug has no plans row (D-I)', async () => {
        mockGetPlanBySlug.mockResolvedValue(null);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'unknown_plan', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('refuses to adopt over a LIVE stripe row (D-H) — Sentry, human decides', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'stripe', status: 'active',
            externalSubscriptionId: 'sub_stripe', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('adopts over a CANCELED stripe row — the merchant left Stripe and came back through Shopify', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'stripe', status: 'canceled',
            externalSubscriptionId: 'sub_stripe', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1',
            planId: 'plan_business_id',
            status: 'active',
            externalSubscriptionId: GID,
            paymentMethod: 'shopify',
            shopifyShopDomain: SHOP,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            cancelReason: null,
        }));
    });

    it('inserts a fresh mirror and initializes the usage window + cache', async () => {
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({
            externalSubscriptionId: GID,
            paymentMethod: 'shopify',
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
        }));
        expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledWith(
            'u1', expect.any(Date), new Date('2026-09-01T00:00:00Z'),
        );
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('mirrors a Shopify-managed trial as trialing (D-J: Shopify owns the trial clock)', async () => {
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);
        const startedYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        await adoptShopifySubscription('u1', appSub({ trialDays: 14, createdAt: startedYesterday }), SHOP, mkLog());

        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({
            status: 'trialing',
            trialEndsAt: expect.any(Date),
        }));
    });

    it('is idempotent: a no-drift re-run writes nothing', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'shopify', status: 'active',
            externalSubscriptionId: GID, planId: 'plan_business_id',
            shopifyShopDomain: SHOP,
            currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
        }]) as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: false });
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
        expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();
    });

    it('advances the period contiguously on renewal: new start = previous end', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'shopify', status: 'active',
            externalSubscriptionId: GID, planId: 'plan_business_id',
            shopifyShopDomain: SHOP,
            currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await adoptShopifySubscription('u1', appSub({ currentPeriodEnd: '2026-09-01T00:00:00Z' }), SHOP, mkLog());

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
        }));
    });
});

describe('cancelShopifySubscriptionLocal', () => {
    it('cancels the live mirror by shop domain and invalidates the cache (D-D)', async () => {
        const chain = q([{ id: 'row_1', userId: 'u1' }]);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await cancelShopifySubscriptionLocal(SHOP, 'shopify_app_uninstalled', mkLog());

        expect(result).toBe(true);
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'canceled',
            cancelReason: 'shopify_app_uninstalled',
            canceledAt: expect.any(Date),
        }));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('returns false when no live mirror exists — an uninstall replay is a no-op', async () => {
        vi.mocked(db.update).mockReturnValue(q([]) as never);

        await expect(cancelShopifySubscriptionLocal(SHOP, 'x', mkLog())).resolves.toBe(false);
        expect(subscriptionsService.invalidateStatusCache).not.toHaveBeenCalled();
    });
});

describe('syncShopifyBilling', () => {
    const store = {
        id: 'store_1', userId: 'connector_user', workspaceId: 'ws_1',
        storeDomain: SHOP, accessToken: 'enc', accessTokenIv: 'iv', isActive: true,
    };

    it('returns no_store when the shop has no active store row', async () => {
        vi.mocked(db.select).mockReturnValue(q([]) as never);

        await expect(syncShopifyBilling(SHOP, mkLog())).resolves.toEqual({ outcome: 'no_store', changed: false });
        expect(mockGraphQL).not.toHaveBeenCalled();
    });

    it('mirrors onto the WORKSPACE OWNER, not the connecting member (D-E)', async () => {
        const insertChain = q([]);
        vi.mocked(db.select)
            .mockReturnValueOnce(q([store]) as never)                       // store lookup
            .mockReturnValueOnce(q([{ ownerId: 'owner_user' }]) as never)   // workspace owner
            .mockReturnValueOnce(q([]) as never);                           // current sub row (none)
        vi.mocked(db.insert).mockReturnValue(insertChain as never);
        mockGraphQL.mockResolvedValue(graphqlActive([appSub()]));

        const result = await syncShopifyBilling(SHOP, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner_user' }));
    });

    // The pause/no-op branches never resolve the workspace owner (that lookup
    // lives inside the adopt branch), so these tests queue ONLY the store row.

    it('pauses the live local mirror when Shopify shows no active subscription (D-B)', async () => {
        const updateChain = q([{ userId: 'owner_user' }]);
        vi.mocked(db.select).mockReturnValueOnce(q([store]) as never);
        vi.mocked(db.update).mockReturnValue(updateChain as never);
        mockGraphQL.mockResolvedValue(graphqlActive([]));

        const result = await syncShopifyBilling(SHOP, mkLog());

        expect(result).toEqual({ outcome: 'paused', changed: true });
        expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'paused' }));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('owner_user');
    });

    it('returns no_subscription when neither side has anything', async () => {
        vi.mocked(db.select).mockReturnValueOnce(q([store]) as never);
        vi.mocked(db.update).mockReturnValue(q([]) as never);
        mockGraphQL.mockResolvedValue(graphqlActive([]));

        await expect(syncShopifyBilling(SHOP, mkLog())).resolves.toEqual({
            outcome: 'no_subscription', changed: false,
        });
    });

    it('ignores non-ACTIVE app subscriptions (DECLINED/EXPIRED never activate)', async () => {
        vi.mocked(db.select).mockReturnValueOnce(q([store]) as never);
        vi.mocked(db.update).mockReturnValue(q([]) as never);
        mockGraphQL.mockResolvedValue(graphqlActive([appSub({ status: 'DECLINED' })]));

        await expect(syncShopifyBilling(SHOP, mkLog())).resolves.toEqual({
            outcome: 'no_subscription', changed: false,
        });
        expect(db.insert).not.toHaveBeenCalled();
    });
});

describe('reconcileShopifyBilling', () => {
    it('sweeps every active store, counts writes as healed, and flags orphaned mirrors', async () => {
        vi.mocked(db.select)
            // store list for the sweep
            .mockReturnValueOnce(q([{ storeDomain: SHOP }]) as never)
            // syncShopifyBilling: store lookup → no active row this time
            .mockReturnValueOnce(q([]) as never)
            // orphan scan: one live mirror with no active store behind it
            .mockReturnValueOnce(q([{ id: 'row_9', shopifyShopDomain: 'ghost.myshopify.com' }]) as never);

        const result = await reconcileShopifyBilling({ log: mkLog() });

        expect(result).toEqual(expect.objectContaining({
            scanned: 1, healed: 0, orphaned: 1,
        }));
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.stringContaining('orphaned'),
            expect.objectContaining({ tags: { cron: 'shopify_billing_reconcile' } }),
        );
    });

    it('isolates one shop failing from the rest of the sweep', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ storeDomain: 'a.myshopify.com' }, { storeDomain: 'b.myshopify.com' }]) as never)
            // shop a: store lookup throws inside sync
            .mockImplementationOnce(() => { throw new Error('db hiccup'); })
            // shop b: no store row → clean no_store
            .mockReturnValueOnce(q([]) as never)
            // orphan scan: none
            .mockReturnValueOnce(q([]) as never);

        const result = await reconcileShopifyBilling({ log: mkLog() });

        expect(result).toEqual(expect.objectContaining({ scanned: 2, errors: 1, orphaned: 0 }));
    });
});

describe('adoptShopifySubscription — additional refusal surfaces', () => {
    it('refuses cross-shop adoption over a live shopify mirror (two-store thrash guard)', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'shopify', status: 'active',
            externalSubscriptionId: 'gid://shopify/AppSubscription/999',
            shopifyShopDomain: 'other-store.myshopify.com',
            currentPeriodStart: null, currentPeriodEnd: null,
        }]) as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
        // The quota window must NOT be reset by a refused adoption.
        expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();
    });

    it('still allows same-shop adoption under a new GID (plan upgrade, O-2)', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'shopify', status: 'active',
            externalSubscriptionId: 'gid://shopify/AppSubscription/999',
            shopifyShopDomain: SHOP, planId: 'plan_starter_id',
            currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
    });

    it('refuses over a live manual (comp) row like a stripe one (D-H)', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'manual', status: 'active',
            externalSubscriptionId: null, currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
    });

    // The zid/salla adopts have always refused over a live shopify row; without
    // the mirror-image refusal here, which marketplace "won" a doubly-billed
    // workspace depended on which rail's sync ran last.
    it.each([
        ['zid'],
        ['salla'],
    ])('refuses over a live %s mirror — two marketplaces cannot both bill one workspace (D-H)', async (rail) => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: rail, status: 'active',
            externalSubscriptionId: null, currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
    });

    it('clears stale Stripe identity when taking over a canceled stripe row', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'stripe', status: 'canceled',
            externalSubscriptionId: 'sub_old', stripeCustomerId: 'cus_old',
            currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await adoptShopifySubscription('u1', appSub(), SHOP, mkLog());

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            stripeCustomerId: null,
            stripeCheckoutSessionId: null,
        }));
    });
});

describe('reconcileShopifyBilling — sweep-error visibility', () => {
    it('raises ONE aggregated Sentry event when stores fail to sync', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ storeDomain: 'a.myshopify.com' }]) as never)
            .mockImplementationOnce(() => { throw new Error('token dead'); })
            .mockReturnValueOnce(q([]) as never);

        await reconcileShopifyBilling({ log: mkLog() });

        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            'Shopify billing reconciliation sweep errors',
            expect.objectContaining({ fingerprint: ['shopify-billing-sweep-errors'] }),
        );
    });
});
