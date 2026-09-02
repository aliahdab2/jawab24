/**
 * Tests for the Zid App Market → local subscription mirror.
 *
 * These cover ZID_TEST_PLAN §H (H-1…H-9) at the unit level. They are NOT the
 * live validation §H asks for: `EC3` — a Rejected app cannot be installed —
 * blocks every real round-trip, so the response envelope these tests feed in is
 * inferred from Zid's docs, not captured. What they DO pin is that the rail
 * behaves correctly *given* an envelope, and that every uncertain input fails
 * loud instead of guessing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() } }));

vi.mock('../../src/db/schema', () => ({
    subscriptions: {
        id: 'id', userId: 'user_id', planId: 'plan_id', status: 'status',
        externalSubscriptionId: 'external_subscription_id',
        paymentMethod: 'payment_method', zidStoreId: 'zid_store_id',
        currentPeriodStart: 'current_period_start', currentPeriodEnd: 'current_period_end',
        trialEndsAt: 'trial_ends_at', createdAt: 'created_at',
    },
    ecommerceStores: {
        id: 'id', platform: 'platform', isActive: 'is_active',
        userId: 'user_id', workspaceId: 'workspace_id', platformData: 'platform_data',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...conds) => ({ conds, op: 'and' })),
    desc: vi.fn((field) => ({ field, op: 'desc' })),
    inArray: vi.fn((field, values) => ({ field, values, op: 'inArray' })),
    notInArray: vi.fn((field, values) => ({ field, values, op: 'notInArray' })),
}));

const mockApiGet = vi.fn();
const mockResolveCreds = vi.fn();
vi.mock('../../src/services/zid', () => ({
    zidApiGet: (...a: unknown[]) => mockApiGet(...a),
    resolveZidCredentials: (...a: unknown[]) => mockResolveCreds(...a),
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

vi.mock('../../src/services/ecommerce', () => ({
    resolveBillingSubjectUserId: vi.fn(async (store: { userId: string; workspaceId?: string | null }) =>
        store.workspaceId ? 'owner-of-workspace' : store.userId),
}));

vi.mock('../../src/services/demoStore', () => ({
    isDemoStore: vi.fn((s: { platformData?: unknown }) =>
        !!s.platformData && typeof s.platformData === 'object'
        && (s.platformData as Record<string, unknown>).demo === true),
}));

vi.mock('../../src/config', () => ({
    config: { zid: { appId: 'app-7367', appMarketUrl: '' } },
}));

import {
    adoptZidSubscription,
    cancelZidSubscriptionLocal,
    syncZidBilling,
    reconcileZidBilling,
    fetchZidAppSubscription,
    mapZidStatus,
    type ZidAppSubscription,
} from '../../src/services/zidBilling';
import { db } from '../../src/db';
import { subscriptionsService } from '../../src/services/subscriptions';
import { q, mkLog } from '../helpers/drizzleQueryMock';

const STORE = 'store-uuid-1';

const zidSub = (over: Partial<ZidAppSubscription> = {}): ZidAppSubscription => ({
    id: 'zid-sub-77',
    status: 'active',
    planId: '3740',
    planName: 'الأعمال',
    startDate: '2026-08-01T00:00:00Z',
    endDate: '2026-09-01T00:00:00Z',
    isUsageBased: false,
    ...over,
});

const activeStoreRow = {
    id: STORE, platform: 'zid', isActive: true,
    userId: 'u1', workspaceId: null, platformData: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    // mockReset (not just clear): drops leftover mockReturnValueOnce queues a
    // prior test didn't consume — clearAllMocks alone lets them leak forward.
    vi.mocked(db.select).mockReset().mockReturnValue(q([]) as never);
    vi.mocked(db.update).mockReset().mockReturnValue(q([]) as never);
    vi.mocked(db.insert).mockReset().mockReturnValue(q([]) as never);
    mockGetPlanBySlug.mockResolvedValue({ id: 'plan_business_id', slug: 'business' });
    mockResolveCreds.mockResolvedValue({ managerToken: 'mt', authorizationToken: 'at' });
});

describe('mapZidStatus', () => {
    it.each(['active', 'ACTIVE', ' Subscribed '])('treats %j as entitled', raw => {
        expect(mapZidStatus(raw)).toEqual({ kind: 'active', localStatus: 'active' });
    });

    it.each(['trial', 'trialing', 'in_trial'])('treats %j as an entitled trial', raw => {
        expect(mapZidStatus(raw)).toEqual({ kind: 'active', localStatus: 'trialing' });
    });

    it.each(['expired', 'cancelled', 'canceled', 'suspended'])('treats %j as no longer entitled', raw => {
        expect(mapZidStatus(raw)).toEqual({ kind: 'inactive' });
    });

    /**
     * THE safety property of this rail. Zid documents the field but not its
     * values, so an unfamiliar string is expected eventually — and it must never
     * be read as "not entitled", because that would revoke a merchant Zid is
     * actively billing.
     */
    it('reports an unrecognised status as unknown rather than inactive', () => {
        expect(mapZidStatus('pending_renewal')).toEqual({ kind: 'unknown' });
    });
});

describe('fetchZidAppSubscription', () => {
    const creds = { managerToken: 'mt', authorizationToken: 'at' };

    it('sends the app id and both auth credentials', async () => {
        mockApiGet.mockResolvedValue({ subscription_status: 'active', plan_name: 'الأعمال' });

        await fetchZidAppSubscription(creds);

        expect(mockApiGet).toHaveBeenCalledWith(
            expect.stringContaining('app_id=app-7367'),
            creds,
        );
        expect(mockApiGet).toHaveBeenCalledWith(
            expect.stringContaining('https://api.zid.sa/v1/market/app/subscription'),
            creds,
        );
    });

    /**
     * The envelope is uncaptured, so the parser must survive the plausible
     * nestings rather than assume one. Each of these is a shape Zid's docs could
     * reasonably produce.
     *
     * The COMPOSED case is a regression: the first implementation probed the
     * three nestings as alternatives (`raw.subscription ?? raw.data ?? raw`), so
     * `{data:{subscription:{…}}}` resolved to the outer wrapper, found no status
     * there, and reported "no subscription" — which paused a live mirror and cut
     * a paying merchant's auto-replies. See the sync-level case below.
     */
    it.each([
        ['at the root', { subscription_status: 'active', plan_name: 'الأعمال', end_date: '2026-09-01' }],
        ['under data', { data: { subscription_status: 'active', plan_name: 'الأعمال', end_date: '2026-09-01' } }],
        ['under subscription', { subscription: { subscription_status: 'active', plan_name: 'الأعمال', end_date: '2026-09-01' } }],
        ['under data.subscription', { data: { subscription: { subscription_status: 'active', plan_name: 'الأعمال', end_date: '2026-09-01' } } }],
        ['under a nested bare `status`', { data: { status: 'active', plan_name: 'الأعمال', end_date: '2026-09-01' } }],
    ])('reads a payload %s', async (_label, payload) => {
        mockApiGet.mockResolvedValue(payload);

        const result = await fetchZidAppSubscription(creds);

        expect(result.kind).toBe('subscription');
        expect(result.kind === 'subscription' && result.subscription.status).toBe('active');
        expect(result.kind === 'subscription' && result.subscription.planName).toBe('الأعمال');
        expect(result.kind === 'subscription' && result.subscription.endDate).toBe('2026-09-01');
    });

    /**
     * "We could not read it" is NOT "there is no subscription". Only an explicit
     * empty container may mean the latter — everything else must fail loud, or
     * an envelope shaped differently from our guess revokes a paying merchant.
     */
    it.each([
        ['an empty object', {}],
        ['a bare transport wrapper', { status: 'success', message: 'ok' }],
        ['a list under data', { data: [{ subscription_status: 'active' }] }],
        ['a scalar container', { data: 'none' }],
    ])('reports %s as UNREADABLE, never as "no subscription"', async (_label, payload) => {
        mockApiGet.mockResolvedValue(payload);

        const result = await fetchZidAppSubscription(creds);

        expect(result.kind).toBe('unreadable');
    });

    /**
     * H1 regression: a transport-level `"status": "success"` is not a
     * subscription status. Reading it as one booked `unknown_status` at error
     * level for every installed-but-unsubscribed store, every six hours —
     * burying the alert that means Zid really did ship a status we have not
     * seen. An explicit null container is the one positive "nobody is paying".
     */
    it.each([
        ['{"data": null}', { status: 'success', data: null }],
        ['{"subscription": null}', { subscription: null }],
    ])('reads %s as a positive NO SUBSCRIPTION, not as status "success"', async (_label, payload) => {
        mockApiGet.mockResolvedValue(payload);

        await expect(fetchZidAppSubscription(creds)).resolves.toEqual({ kind: 'none' });
    });

    /**
     * A bare `status` beside fields only a subscription carries IS the
     * subscription's — the marker-key test must not be so strict that a
     * perfectly readable flat resource fails loud.
     */
    it('trusts a bare `status` at the root when subscription fields sit beside it', async () => {
        mockApiGet.mockResolvedValue({ id: 'zid-sub-77', status: 'active', plan_name: 'الأعمال' });

        const result = await fetchZidAppSubscription(creds);

        expect(result.kind === 'subscription' && result.subscription.status).toBe('active');
    });

    it('reads a nested plan object', async () => {
        mockApiGet.mockResolvedValue({
            id: 'zid-sub-77',
            subscription_status: 'active',
            plan: { id: 3740, name: 'الأعمال' },
        });

        const result = await fetchZidAppSubscription(creds);

        expect(result.kind === 'subscription' && result.subscription.id).toBe('zid-sub-77');
        expect(result.kind === 'subscription' && result.subscription.planId).toBe('3740');
        expect(result.kind === 'subscription' && result.subscription.planName).toBe('الأعمال');
    });

    /**
     * Regression: a flat envelope's bare `id` is the SUBSCRIPTION's, not the
     * plan's. Reading it as the plan id would discard the `plan_name` sitting
     * beside it and turn a working install into an `unknown_plan` stall.
     */
    it('does NOT mistake the subscription id for the plan id in a flat envelope', async () => {
        mockApiGet.mockResolvedValue({
            id: 'zid-sub-77',
            subscription_status: 'active',
            plan_name: 'الأعمال',
        });

        const result = await fetchZidAppSubscription(creds);

        expect(result.kind === 'subscription' && result.subscription.id).toBe('zid-sub-77');
        expect(result.kind === 'subscription' && result.subscription.planId).toBeNull();
        expect(result.kind === 'subscription' && result.subscription.planName).toBe('الأعمال');
    });
});

describe('adoptZidSubscription', () => {
    // H-5
    it('fails loud on a plan that maps to no slug — no activation, Sentry', async () => {
        const result = await adoptZidSubscription(
            'u1', zidSub({ planId: '9999', planName: 'خطة مجهولة' }), STORE, mkLog(),
        );

        expect(result).toEqual({ outcome: 'unknown_plan', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    /**
     * JAWAB24-BACKEND-27: our own dev store sits on Zid's free «اختبار» plan, which
     * maps to no slug and so paged a human every ~6h with Users Impacted: 0. A KNOWN
     * no-entitlement plan is not an unrecognised identifier — skip it silently, but
     * still activate nothing. A reviewer subscribing to «اختبار» would spam it too.
     */
    it.each([
        ['by id', { planId: '3956', planName: null }],
        ['by name', { planId: null, planName: 'اختبار' }],
    ])('skips the known non-entitling «اختبار» plan silently (%s) — no Sentry, no activation', async (_label, plan) => {
        const result = await adoptZidSubscription('u1', zidSub(plan), STORE, mkLog());

        expect(result).toEqual({ outcome: 'non_entitling_plan', changed: false });
        expect(mockCaptureError).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('fails loud when the mapped slug has no plans row', async () => {
        mockGetPlanBySlug.mockResolvedValue(null);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'unknown_plan', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('fails loud — and writes NOTHING — on an unrecognised status', async () => {
        const result = await adoptZidSubscription('u1', zidSub({ status: 'pending_renewal' }), STORE, mkLog());

        expect(result).toEqual({ outcome: 'unknown_status', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    /** The plan id is the stable identifier; the Arabic name is the fallback. */
    it('maps a plan by its Arabic name when the payload carries no id', async () => {
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);
        mockGetPlanBySlug.mockResolvedValue({ id: 'plan_pro_id', slug: 'pro' });

        const result = await adoptZidSubscription(
            'u1', zidSub({ planId: null, planName: 'الاحترافي' }), STORE, mkLog(),
        );

        expect(result.outcome).toBe('adopted');
        expect(mockGetPlanBySlug).toHaveBeenCalledWith('pro');
    });

    /**
     * Zid's own spelling of a plan name is not contractually pinned. A hamza
     * difference must not demote a paying merchant to unknown_plan.
     */
    it('tolerates an alef spelling drift in the Arabic plan name', async () => {
        vi.mocked(db.insert).mockReturnValue(q([]) as never);

        const result = await adoptZidSubscription(
            'u1', zidSub({ planId: null, planName: 'الاعمال' }), STORE, mkLog(),
        );

        expect(result.outcome).toBe('adopted');
        expect(mockGetPlanBySlug).toHaveBeenCalledWith('business');
    });

    // H-1
    it('mirrors a TRIAL subscription as trialing with the trial clock from Zid', async () => {
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);

        const result = await adoptZidSubscription('u1', zidSub({ status: 'trial' }), STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1',
            planId: 'plan_business_id',
            status: 'trialing',
            paymentMethod: 'zid',
            zidStoreId: STORE,
            trialEndsAt: new Date('2026-09-01T00:00:00Z'),
            stripeCustomerId: null,
            cancelAtPeriodEnd: false,
        }));
    });

    // H-7
    it('refuses to adopt over a LIVE stripe row — Sentry, human decides', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'stripe', status: 'active',
            externalSubscriptionId: 'sub_stripe', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('refuses to adopt over a LIVE sham_cash row — an offline rail is a paying relationship too (D-110)', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'sham_cash', status: 'active',
            externalSubscriptionId: null, currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('adopts over a CANCELED stripe row — the merchant left Stripe and came back through Zid', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'stripe', status: 'canceled',
            externalSubscriptionId: 'sub_stripe', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            paymentMethod: 'zid',
            zidStoreId: STORE,
            status: 'active',
            stripeCustomerId: null,
            stripeCheckoutSessionId: null,
        }));
    });

    it('refuses a cross-store adoption over a live zid mirror — no quota-window ping-pong', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'zid', status: 'active',
            zidStoreId: 'a-different-store', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), expect.any(String),
            expect.objectContaining({ fingerprint: ['zid-billing-cross-store-refused'] }),
        );
    });

    it.each([
        ['shopify'],
        ['salla'],
    ])('refuses to adopt over a live %s mirror — two marketplaces cannot both bill one workspace', async (rail) => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: rail, status: 'active',
            currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
    });

    // H-3
    it('advances a renewal contiguously from the previous period end', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'zid', status: 'active', zidStoreId: STORE,
            planId: 'plan_business_id', externalSubscriptionId: 'zid-sub-77',
            currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
        }));
        expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledWith(
            'u1', new Date('2026-08-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'),
        );
    });

    // H-4
    it('moves plan_id on an upgrade', async () => {
        const chain = q([]);
        mockGetPlanBySlug.mockResolvedValue({ id: 'plan_pro_id', slug: 'pro' });
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'zid', status: 'active', zidStoreId: STORE,
            planId: 'plan_business_id', externalSubscriptionId: 'zid-sub-77',
            currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptZidSubscription(
            'u1', zidSub({ planId: '3741', planName: 'الاحترافي' }), STORE, mkLog(),
        );

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan_pro_id' }));
    });

    it('is idempotent — a re-run with no drift writes nothing', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'zid', status: 'active', zidStoreId: STORE,
            planId: 'plan_business_id', externalSubscriptionId: 'zid-sub-77',
            currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
        }]) as never);

        const result = await adoptZidSubscription('u1', zidSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: false });
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });
});

describe('syncZidBilling', () => {
    it('returns no_store for a store that is not an active zid store', async () => {
        vi.mocked(db.select).mockReturnValue(q([]) as never);

        await expect(syncZidBilling(STORE, mkLog())).resolves.toEqual({
            outcome: 'no_store', changed: false,
        });
    });

    // H-1: the mirror lands on the workspace OWNER, not the connecting member.
    it('resolves the billing subject to the workspace owner', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ ...activeStoreRow, workspaceId: 'ws1' }]) as never)
            .mockReturnValue(q([]) as never);
        vi.mocked(db.insert).mockReturnValue(q([]) as never);
        mockApiGet.mockResolvedValue({ subscription_status: 'active', plan_name: 'الأعمال', end_date: '2026-09-01T00:00:00Z' });

        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);

        const result = await syncZidBilling(STORE, mkLog());

        expect(result.outcome).toBe('adopted');
        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'owner-of-workspace',
        }));
    });

    // H-2
    it('pauses a live mirror when Zid reports an expired subscription', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        vi.mocked(db.update).mockReturnValue(q([{ id: 'row_1', userId: 'u1' }]) as never);
        mockApiGet.mockResolvedValue({ subscription_status: 'expired' });

        const result = await syncZidBilling(STORE, mkLog());

        expect(result).toEqual({ outcome: 'paused', changed: true });
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('reports no_subscription when neither side has anything live', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        vi.mocked(db.update).mockReturnValue(q([]) as never);
        mockApiGet.mockResolvedValue({ subscription_status: 'expired' });

        await expect(syncZidBilling(STORE, mkLog())).resolves.toEqual({
            outcome: 'no_subscription', changed: false,
        });
    });

    /**
     * C1 regression #1 — the composed nesting.
     *
     * `{data:{subscription:{…}}}` IS a live, active subscription. The first
     * parser probed the nestings as ALTERNATIVES (`subscription ?? data ??
     * root`), so it resolved to the outer wrapper, found no status there, and
     * returned null — which fell into the pause branch and cut the auto-replies
     * of a merchant Zid was actively billing. Here it must ADOPT.
     */
    it('adopts a subscription nested under data.subscription instead of pausing', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([activeStoreRow]) as never)
            .mockReturnValue(q([]) as never);
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);
        mockApiGet.mockResolvedValue({
            data: {
                subscription: {
                    subscription_status: 'active',
                    plan_name: 'الأعمال',
                    end_date: '2026-09-01T00:00:00Z',
                },
            },
        });

        const result = await syncZidBilling(STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({
            status: 'active', paymentMethod: 'zid', zidStoreId: STORE,
        }));
    });

    /**
     * C1 regression #2 — the shape we still cannot read.
     *
     * A body we do not understand must write NOTHING and alert, never pause:
     * status 'paused' → `checkSubscriptionStatus` → `subscription_inactive` →
     * auto-replies stop while Zid keeps billing, re-firing every 6h with
     * nothing to heal it. Same fail-loud direction D-070 takes for an unknown
     * status; a stale entitlement costs a little money, a revoked one costs a
     * customer.
     */
    it('fails loud instead of pausing when the body is unreadable', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        mockApiGet.mockResolvedValue({ data: { results: [] } });

        const result = await syncZidBilling(STORE, mkLog());

        expect(result).toEqual({ outcome: 'unreadable', changed: false });
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), expect.any(String),
            expect.objectContaining({ fingerprint: ['zid-billing-unreadable-response'] }),
        );
    });

    /**
     * H1 regression: the transport wrapper. The first parser fell back to the
     * root when `data`/`subscription` were absent and read `"status":"success"`
     * as the subscription status — booking `unknown_status` at error level for
     * every unsubscribed store, every six hours.
     */
    it('does not read a transport "success" as a subscription status', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        mockApiGet.mockResolvedValue({ status: 'success', message: 'ok' });

        const result = await syncZidBilling(STORE, mkLog());

        expect(result.outcome).toBe('unreadable');
        expect(mockCaptureError).not.toHaveBeenCalledWith(
            expect.anything(), expect.any(String),
            expect.objectContaining({ tags: expect.objectContaining({ flow: 'unknown_status' }) }),
        );
    });

    /**
     * The other half of C1: a POSITIVE empty container is still a pause, so
     * §H-2 (trial expiry / unsubscribe → paused) keeps working. Failing loud on
     * everything would trade a wrongly-revoked merchant for one who never loses
     * entitlement at all.
     */
    it('still pauses on an explicit empty container — a positive "nobody is paying"', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        vi.mocked(db.update).mockReturnValue(q([{ id: 'row_1', userId: 'u1' }]) as never);
        mockApiGet.mockResolvedValue({ status: 'success', data: null });

        await expect(syncZidBilling(STORE, mkLog())).resolves.toEqual({
            outcome: 'paused', changed: true,
        });
    });

    /**
     * The inverse of the pause above, and the reason mapZidStatus is three-way:
     * an unfamiliar status must reach the fail-loud path, never the pause.
     */
    it('does NOT pause anyone on an unrecognised status', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        mockApiGet.mockResolvedValue({ subscription_status: 'pending_renewal', plan_name: 'الأعمال' });

        const result = await syncZidBilling(STORE, mkLog());

        expect(result.outcome).toBe('unknown_status');
        expect(db.update).not.toHaveBeenCalled();
    });
});

// H-6
describe('cancelZidSubscriptionLocal', () => {
    it('cancels live mirrors for the store and invalidates their caches', async () => {
        const chain = q([{ id: 'row_1', userId: 'u1' }]);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await expect(cancelZidSubscriptionLocal(STORE, 'zid_app_uninstalled', mkLog())).resolves.toBe(true);
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'canceled',
            cancelReason: 'zid_app_uninstalled',
        }));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('reports false when there was no live mirror to cancel', async () => {
        vi.mocked(db.update).mockReturnValue(q([]) as never);

        await expect(cancelZidSubscriptionLocal(STORE, 'zid_app_uninstalled', mkLog())).resolves.toBe(false);
    });
});

// H-9
describe('reconcileZidBilling', () => {
    it('sweeps active stores and counts what it healed', async () => {
        vi.mocked(db.select)
            // the store list
            .mockReturnValueOnce(q([{ id: STORE, platformData: null }]) as never)
            // syncZidBilling's own store lookup
            .mockReturnValueOnce(q([activeStoreRow]) as never)
            // adopt's current-subscription lookup
            .mockReturnValueOnce(q([]) as never)
            // the orphan sweep
            .mockReturnValue(q([]) as never);
        vi.mocked(db.insert).mockReturnValue(q([]) as never);
        mockApiGet.mockResolvedValue({ subscription_status: 'active', plan_name: 'الأعمال', end_date: '2026-09-01T00:00:00Z' });

        const result = await reconcileZidBilling({ log: mkLog() });

        expect(result.scanned).toBe(1);
        expect(result.healed).toBe(1);
        expect(result.errors).toBe(0);
    });

    it('skips demo-seeded stores — their placeholder tokens cannot reach a real API', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ id: STORE, platformData: { demo: true } }]) as never)
            .mockReturnValue(q([]) as never);

        const result = await reconcileZidBilling({ log: mkLog() });

        expect(result.scanned).toBe(0);
        expect(mockApiGet).not.toHaveBeenCalled();
    });

    it('isolates a per-store failure and raises ONE aggregated Sentry event', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ id: STORE, platformData: null }]) as never)
            .mockReturnValueOnce(q([activeStoreRow]) as never)
            .mockReturnValue(q([]) as never);
        mockApiGet.mockRejectedValue(new Error('Zid 500'));

        const result = await reconcileZidBilling({ log: mkLog() });

        expect(result.errors).toBe(1);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), 'Zid billing reconciliation sweep errors',
            expect.objectContaining({ fingerprint: ['zid-billing-sweep-errors'] }),
        );
    });

    it('flags live mirrors whose store row is gone — a missed uninstall webhook', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([]) as never)
            .mockReturnValue(q([{ id: 'row_1', zidStoreId: 'vanished-store' }]) as never);

        const result = await reconcileZidBilling({ log: mkLog() });

        expect(result.orphaned).toBe(1);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), 'Zid billing reconciliation found orphaned local mirrors',
            expect.objectContaining({ fingerprint: ['zid-billing-orphaned-mirrors'] }),
        );
    });
});

describe('mapZidPlanToSlug — D-120 Starter joins the shelf', () => {
    /**
     * The 56-SAR «المبتدئ» plan was created in the Partner Dashboard on
     * 2026-09-02 as plan id 4177, so the id — what a subscription payload
     * actually carries — is the primary mapping and the Arabic-name fallback
     * is the drift tolerance behind it. Pin both — and pin that unknown
     * identifiers still resolve to null (fail-loud), never to a guessed tier.
     */
    it('resolves the Partner-Dashboard id 4177 to starter', async () => {
        const { mapZidPlanToSlug } = await import('../../src/config/zidBilling');
        expect(mapZidPlanToSlug({ id: '4177' })).toBe('starter');
        expect(mapZidPlanToSlug({ id: 4177 })).toBe('starter');
    });

    it('resolves «المبتدئ» (and the English name) to starter by name fallback', async () => {
        const { mapZidPlanToSlug } = await import('../../src/config/zidBilling');
        expect(mapZidPlanToSlug({ name: 'المبتدئ' })).toBe('starter');
        expect(mapZidPlanToSlug({ name: 'Starter' })).toBe('starter');
    });

    it('still resolves the existing ids and names', async () => {
        const { mapZidPlanToSlug } = await import('../../src/config/zidBilling');
        expect(mapZidPlanToSlug({ id: '3740' })).toBe('business');
        expect(mapZidPlanToSlug({ id: 3741 })).toBe('pro');
        expect(mapZidPlanToSlug({ name: 'الأعمال' })).toBe('business');
    });

    it('unknown identifiers stay fail-loud (null), never a guessed tier', async () => {
        const { mapZidPlanToSlug } = await import('../../src/config/zidBilling');
        expect(mapZidPlanToSlug({ id: '9999', name: 'خطة غامضة' })).toBeNull();
    });
});
