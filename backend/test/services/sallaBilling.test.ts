/**
 * Tests for the Salla App Store → local subscription mirror.
 *
 * These are NOT the live validation — no paid Salla subscription has ever
 * round-tripped (the app is unpublished, paid checkout does not exist yet), so
 * the envelopes these tests feed in are inferred from docs.salla.dev, not
 * captured. What they DO pin is that the rail behaves correctly *given* an
 * envelope, and that every uncertain input fails loud instead of guessing.
 *
 * The two Salla-specific derivations under test, and why they are dangerous:
 * the read carries NO status field (state is derived from `end_date`) and base
 * plans carry NO plan id (mapping is name-first, D-103 price fallback).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() } }));

vi.mock('../../src/db/schema', () => ({
    subscriptions: {
        id: 'id', userId: 'user_id', planId: 'plan_id', status: 'status',
        externalSubscriptionId: 'external_subscription_id',
        paymentMethod: 'payment_method', sallaStoreId: 'salla_store_id',
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
vi.mock('../../src/services/salla', () => ({
    sallaApiGet: (...a: unknown[]) => mockApiGet(...a),
    resolveStoreCredentials: (...a: unknown[]) => mockResolveCreds(...a),
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
    config: { salla: { appId: '665811310', appStoreUrl: '' } },
}));

import {
    adoptSallaSubscription,
    cancelSallaSubscriptionLocal,
    syncSallaBilling,
    reconcileSallaBilling,
    fetchSallaAppSubscription,
    mapSallaSubscriptionState,
    type SallaAppSubscription,
} from '../../src/services/sallaBilling';
import { db } from '../../src/db';
import { subscriptionsService } from '../../src/services/subscriptions';
import { q, mkLog } from '../helpers/drizzleQueryMock';

const STORE = 'store-uuid-1';

// Far-future dates: mapSallaSubscriptionState derives entitlement from the
// clock, and tests must not start failing when the calendar catches up.
const FUTURE_END = '2099-09-01T00:00:00Z';
const FUTURE_START = '2099-08-01T00:00:00Z';

const sallaSub = (over: Partial<SallaAppSubscription> = {}): SallaAppSubscription => ({
    id: 'salla-sub-9',
    planName: 'الأعمال',
    planType: 'recurring',
    planPeriod: '1',
    price: '146.00',
    startDate: FUTURE_START,
    endDate: FUTURE_END,
    ...over,
});

/** A documented-shape base-plan entry for the read endpoint [provisional]. */
const planEntry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'salla-sub-9',
    item_type: 'plan',
    item_slug: null,
    plan_type: 'recurring',
    plan_name: 'الأعمال',
    plan_period: '1',
    price: '146.00',
    start_date: FUTURE_START,
    end_date: FUTURE_END,
    ...over,
});

const activeStoreRow = {
    id: STORE, platform: 'salla', isActive: true,
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
    mockResolveCreds.mockResolvedValue('access-token-1');
});

describe('mapSallaSubscriptionState', () => {
    it('derives ENTITLED/active from a future end_date with a real price', () => {
        expect(mapSallaSubscriptionState(sallaSub())).toEqual({
            kind: 'entitled', localStatus: 'active',
        });
    });

    /**
     * [provisional] The docs' trial read example carries null pricing fields —
     * a null price on an entitled entry is read as the trial window. Both
     * statuses entitle identically, so a wrong guess mislabels, never revokes.
     */
    it('derives ENTITLED/trialing from a future end_date with null pricing', () => {
        expect(mapSallaSubscriptionState(sallaSub({ price: null }))).toEqual({
            kind: 'entitled', localStatus: 'trialing',
        });
    });

    it('derives INACTIVE from an end_date in the past', () => {
        expect(mapSallaSubscriptionState(sallaSub({ endDate: '2020-01-01T00:00:00Z' })))
            .toEqual({ kind: 'inactive' });
    });

    it('treats plan_type "free" as a known non-entitling plan', () => {
        expect(mapSallaSubscriptionState(sallaSub({ planType: 'free', endDate: null })))
            .toEqual({ kind: 'non_entitling' });
    });

    /**
     * THE safety property of this rail. Salla's read has no status enum, so an
     * entry whose end_date we cannot parse is a shape we do not understand —
     * and it must never be read as "not entitled", because that would revoke a
     * merchant Salla is actively billing.
     */
    it.each([
        ['missing', null],
        ['unparseable', 'ثلاثة أشهر'],
    ])('reports an %s end_date as unknown rather than inactive', (_label, endDate) => {
        expect(mapSallaSubscriptionState(sallaSub({ endDate }))).toMatchObject({ kind: 'unknown' });
    });
});

describe('fetchSallaAppSubscription', () => {
    it('asks the App Subscription Details endpoint for OUR app id', async () => {
        mockApiGet.mockResolvedValue({ status: 200, success: true, data: [planEntry()] });

        await fetchSallaAppSubscription('access-token-1');

        expect(mockApiGet).toHaveBeenCalledWith(
            'https://api.salla.dev/admin/v2/apps/665811310/subscriptions',
            'access-token-1',
        );
    });

    it('reads the documented {status, success, data:[…]} envelope', async () => {
        mockApiGet.mockResolvedValue({ status: 200, success: true, data: [planEntry()] });

        const result = await fetchSallaAppSubscription('t');

        expect(result.kind).toBe('subscription');
        expect(result.kind === 'subscription' && result.subscription.planName).toBe('الأعمال');
        expect(result.kind === 'subscription' && result.subscription.endDate).toBe(FUTURE_END);
    });

    /** `subscription_id` (when present) outranks `id` as the external id. */
    it('prefers subscription_id over id for the external identifier', async () => {
        mockApiGet.mockResolvedValue({ data: [planEntry({ subscription_id: 1510766049, id: 6789012345 })] });

        const result = await fetchSallaAppSubscription('t');

        expect(result.kind === 'subscription' && result.subscription.id).toBe('1510766049');
    });

    /**
     * The docs mandate the item_type check: add-ons fire the SAME event names
     * and appear in the SAME read. An add-on entry must never be adopted as the
     * base plan — that would grant a tier off an add-on price.
     */
    it('ignores add-on entries and reads the base plan beside them', async () => {
        mockApiGet.mockResolvedValue({
            data: [
                planEntry({ item_type: 'addon', item_slug: 'addon_chat_support', plan_name: 'Addon Chat Support', price: '10.00' }),
                planEntry(),
            ],
        });

        const result = await fetchSallaAppSubscription('t');

        expect(result.kind === 'subscription' && result.subscription.planName).toBe('الأعمال');
    });

    it('reports a positive NO SUBSCRIPTION for an add-on-only array', async () => {
        mockApiGet.mockResolvedValue({
            data: [planEntry({ item_type: 'addon', item_slug: 'addon_chat_support' })],
        });

        await expect(fetchSallaAppSubscription('t')).resolves.toEqual({ kind: 'none' });
    });

    it.each([
        ['an empty data array', { status: 200, success: true, data: [] }],
        ['an explicit null data container', { status: 200, success: true, data: null }],
    ])('reads %s as a positive NO SUBSCRIPTION', async (_label, payload) => {
        mockApiGet.mockResolvedValue(payload);

        await expect(fetchSallaAppSubscription('t')).resolves.toEqual({ kind: 'none' });
    });

    /**
     * "We could not read it" is NOT "there is no subscription". Only an
     * explicit empty container may mean the latter — everything else must fail
     * loud, or an envelope shaped differently from our guess revokes a paying
     * merchant.
     */
    it.each([
        ['a body with no data key', { status: 'success', message: 'ok' }],
        ['a scalar data container', { data: 'none' }],
        ['an object data container', { data: { subscription: planEntry() } }],
        ['a scalar body', 'ok'],
        ['a null body', null],
    ])('reports %s as UNREADABLE, never as "no subscription"', async (_label, payload) => {
        mockApiGet.mockResolvedValue(payload);

        const result = await fetchSallaAppSubscription('t');

        expect(result.kind).toBe('unreadable');
    });

    /** Defensive: a bare array body is readable even without the wrapper. */
    it('tolerates a bare array body', async () => {
        mockApiGet.mockResolvedValue([planEntry()]);

        const result = await fetchSallaAppSubscription('t');

        expect(result.kind).toBe('subscription');
    });

    /**
     * An entry with no item_type is accepted only when it positively looks
     * like a plan — plan markers present. An unrecognisable entry degrades to
     * "none" (pause guards apply), never to an adoption.
     */
    it('accepts a marker-bearing entry that lacks item_type', async () => {
        const entry = planEntry();
        delete entry.item_type;
        mockApiGet.mockResolvedValue({ data: [entry] });

        const result = await fetchSallaAppSubscription('t');

        expect(result.kind).toBe('subscription');
    });

    /** Several base-plan entries [provisional]: the furthest end_date decides NOW. */
    it('picks the entry whose end_date reaches furthest', async () => {
        mockApiGet.mockResolvedValue({
            data: [
                planEntry({ plan_name: 'الأعمال', end_date: '2020-01-01T00:00:00Z' }),
                planEntry({ plan_name: 'الاحترافي', price: '296.00', end_date: FUTURE_END }),
            ],
        });

        const result = await fetchSallaAppSubscription('t');

        expect(result.kind === 'subscription' && result.subscription.planName).toBe('الاحترافي');
    });
});

describe('adoptSallaSubscription', () => {
    it('fails loud on a plan that maps to no slug — no activation, Sentry', async () => {
        const result = await adoptSallaSubscription(
            'u1', sallaSub({ planName: 'خطة مجهولة', price: '999.00' }), STORE, mkLog(),
        );

        expect(result).toEqual({ outcome: 'unknown_plan', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('skips a known free plan silently — no Sentry, no activation', async () => {
        const result = await adoptSallaSubscription(
            'u1', sallaSub({ planType: 'free', planName: null, price: null, endDate: null }), STORE, mkLog(),
        );

        expect(result).toEqual({ outcome: 'non_entitling_plan', changed: false });
        expect(mockCaptureError).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('fails loud when the mapped slug has no plans row', async () => {
        mockGetPlanBySlug.mockResolvedValue(null);

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'unknown_plan', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('fails loud — and writes NOTHING — when entitlement is underivable', async () => {
        const result = await adoptSallaSubscription('u1', sallaSub({ endDate: null }), STORE, mkLog());

        expect(result).toEqual({ outcome: 'unknown_state', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    /**
     * The documented payloads show plan_name: null for recurring base plans —
     * the D-103 ex-VAT price is the fallback identity. 146 ≠ 296 by
     * construction, which is what makes a price an acceptable key at all.
     */
    it.each([
        ['"146.00" → business', '146.00', 'business'],
        ['146 → business', 146, 'business'],
        ['"296.00" → pro', '296.00', 'pro'],
    ])('maps a null plan_name by its D-103 price (%s)', async (_label, price, slug) => {
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);
        mockGetPlanBySlug.mockResolvedValue({ id: `plan_${slug}_id`, slug });

        const result = await adoptSallaSubscription(
            'u1', sallaSub({ planName: null, price }), STORE, mkLog(),
        );

        expect(result.outcome).toBe('adopted');
        expect(mockGetPlanBySlug).toHaveBeenCalledWith(slug);
    });

    /**
     * Salla's own spelling of a plan name is not contractually pinned. A hamza
     * difference must not demote a paying merchant to unknown_plan.
     */
    it('tolerates an alef spelling drift in the Arabic plan name', async () => {
        vi.mocked(db.insert).mockReturnValue(q([]) as never);

        const result = await adoptSallaSubscription(
            // The drifted name resolves by NAME — the price is deliberately
            // unmappable so a price fallback cannot mask a broken name fold.
            'u1', sallaSub({ planName: 'الاعمال', price: '999.00' }), STORE, mkLog(),
        );

        expect(result.outcome).toBe('adopted');
        expect(mockGetPlanBySlug).toHaveBeenCalledWith('business');
    });

    /** The name is the human-stated identity — it outranks the price fallback. */
    it('lets the plan name win over a contradicting price', async () => {
        vi.mocked(db.insert).mockReturnValue(q([]) as never);
        mockGetPlanBySlug.mockResolvedValue({ id: 'plan_pro_id', slug: 'pro' });

        const result = await adoptSallaSubscription(
            'u1', sallaSub({ planName: 'الاحترافي', price: '146.00' }), STORE, mkLog(),
        );

        expect(result.outcome).toBe('adopted');
        expect(mockGetPlanBySlug).toHaveBeenCalledWith('pro');
    });

    it('mirrors a null-priced entitled window as trialing with the trial clock from Salla', async () => {
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);

        const result = await adoptSallaSubscription(
            'u1', sallaSub({ planName: 'الأعمال', price: null }), STORE, mkLog(),
        );

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1',
            planId: 'plan_business_id',
            status: 'trialing',
            paymentMethod: 'salla',
            sallaStoreId: STORE,
            trialEndsAt: new Date(FUTURE_END),
            stripeCustomerId: null,
            cancelAtPeriodEnd: false,
        }));
    });

    it('refuses to adopt over a LIVE stripe row — Sentry, human decides', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'stripe', status: 'active',
            externalSubscriptionId: 'sub_stripe', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

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

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
        expect(mockCaptureError).toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('adopts over a CANCELED stripe row — the merchant left Stripe and came back through Salla', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'stripe', status: 'canceled',
            externalSubscriptionId: 'sub_stripe', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            paymentMethod: 'salla',
            sallaStoreId: STORE,
            status: 'active',
            stripeCustomerId: null,
            stripeCheckoutSessionId: null,
        }));
    });

    it('refuses a cross-store adoption over a live salla mirror — no quota-window ping-pong', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'salla', status: 'active',
            sallaStoreId: 'a-different-store', currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), expect.any(String),
            expect.objectContaining({ fingerprint: ['salla-billing-cross-store-refused'] }),
        );
    });

    it.each([
        ['shopify'],
        ['zid'],
    ])('refuses to adopt over a live %s mirror — two marketplaces cannot both bill one workspace', async (rail) => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: rail, status: 'active',
            currentPeriodEnd: null, currentPeriodStart: null,
        }]) as never);

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'refused', changed: false });
    });

    it('advances a renewal contiguously from the previous period end', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'salla', status: 'active', sallaStoreId: STORE,
            planId: 'plan_business_id', externalSubscriptionId: 'salla-sub-9',
            currentPeriodStart: new Date('2099-07-01T00:00:00Z'),
            currentPeriodEnd: new Date('2099-08-01T00:00:00Z'),
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            currentPeriodStart: new Date('2099-08-01T00:00:00Z'),
            currentPeriodEnd: new Date(FUTURE_END),
        }));
        expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledWith(
            'u1', new Date('2099-08-01T00:00:00Z'), new Date(FUTURE_END),
        );
    });

    it('moves plan_id on an upgrade', async () => {
        const chain = q([]);
        mockGetPlanBySlug.mockResolvedValue({ id: 'plan_pro_id', slug: 'pro' });
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'salla', status: 'active', sallaStoreId: STORE,
            planId: 'plan_business_id', externalSubscriptionId: 'salla-sub-9',
            currentPeriodStart: new Date('2099-08-01T00:00:00Z'),
            currentPeriodEnd: new Date(FUTURE_END),
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        const result = await adoptSallaSubscription(
            'u1', sallaSub({ planName: 'الاحترافي', price: '296.00' }), STORE, mkLog(),
        );

        expect(result).toEqual({ outcome: 'adopted', changed: true });
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan_pro_id' }));
    });

    it('is idempotent — a re-run with no drift writes nothing', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'salla', status: 'active', sallaStoreId: STORE,
            planId: 'plan_business_id', externalSubscriptionId: 'salla-sub-9',
            currentPeriodStart: new Date(FUTURE_START),
            currentPeriodEnd: new Date(FUTURE_END),
        }]) as never);

        const result = await adoptSallaSubscription('u1', sallaSub(), STORE, mkLog());

        expect(result).toEqual({ outcome: 'adopted', changed: false });
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });
});

describe('syncSallaBilling', () => {
    it('returns no_store for a store that is not an active salla store', async () => {
        vi.mocked(db.select).mockReturnValue(q([]) as never);

        await expect(syncSallaBilling(STORE, mkLog())).resolves.toEqual({
            outcome: 'no_store', changed: false,
        });
    });

    it('returns no_store when the token cannot be resolved — never a guess', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        mockResolveCreds.mockResolvedValue(null);

        await expect(syncSallaBilling(STORE, mkLog())).resolves.toEqual({
            outcome: 'no_store', changed: false,
        });
        expect(mockApiGet).not.toHaveBeenCalled();
    });

    it('resolves the billing subject to the workspace owner', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ ...activeStoreRow, workspaceId: 'ws1' }]) as never)
            .mockReturnValue(q([]) as never);
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);
        mockApiGet.mockResolvedValue({ data: [planEntry()] });

        const result = await syncSallaBilling(STORE, mkLog());

        expect(result.outcome).toBe('adopted');
        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'owner-of-workspace',
        }));
    });

    it('pauses a live mirror when Salla reports an expired subscription', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        vi.mocked(db.update).mockReturnValue(q([{ id: 'row_1', userId: 'u1' }]) as never);
        mockApiGet.mockResolvedValue({ data: [planEntry({ end_date: '2020-01-01T00:00:00Z' })] });

        const result = await syncSallaBilling(STORE, mkLog());

        expect(result).toEqual({ outcome: 'paused', changed: true });
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('still pauses on an explicit empty container — a positive "nobody is paying"', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        vi.mocked(db.update).mockReturnValue(q([{ id: 'row_1', userId: 'u1' }]) as never);
        mockApiGet.mockResolvedValue({ status: 200, success: true, data: [] });

        await expect(syncSallaBilling(STORE, mkLog())).resolves.toEqual({
            outcome: 'paused', changed: true,
        });
    });

    it('reports no_subscription when neither side has anything live', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        vi.mocked(db.update).mockReturnValue(q([]) as never);
        mockApiGet.mockResolvedValue({ data: [] });

        await expect(syncSallaBilling(STORE, mkLog())).resolves.toEqual({
            outcome: 'no_subscription', changed: false,
        });
    });

    /**
     * A body we do not understand must write NOTHING and alert, never pause:
     * status 'paused' → checkSubscriptionStatus → subscription_inactive →
     * auto-replies stop while Salla keeps billing, re-firing every 6h with
     * nothing to heal it. The exact failure class the Zid rail's C1 regression
     * shipped — pinned here so Salla can never reach it.
     */
    it('fails loud instead of pausing when the body is unreadable', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        mockApiGet.mockResolvedValue({ status: 'success', message: 'ok' });

        const result = await syncSallaBilling(STORE, mkLog());

        expect(result).toEqual({ outcome: 'unreadable', changed: false });
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), expect.any(String),
            expect.objectContaining({ fingerprint: ['salla-billing-unreadable-response'] }),
        );
    });

    /**
     * The inverse of the pause: an entry whose entitlement is underivable must
     * reach the fail-loud path, never the pause.
     */
    it('does NOT pause anyone on an underivable end_date', async () => {
        vi.mocked(db.select).mockReturnValue(q([activeStoreRow]) as never);
        mockApiGet.mockResolvedValue({ data: [planEntry({ end_date: null })] });

        const result = await syncSallaBilling(STORE, mkLog());

        expect(result.outcome).toBe('unknown_state');
        expect(db.update).not.toHaveBeenCalled();
    });
});

describe('cancelSallaSubscriptionLocal', () => {
    it('cancels live mirrors for the store and invalidates their caches', async () => {
        const chain = q([{ id: 'row_1', userId: 'u1' }]);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await expect(cancelSallaSubscriptionLocal(STORE, 'salla_app_uninstalled', mkLog())).resolves.toBe(true);
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'canceled',
            cancelReason: 'salla_app_uninstalled',
        }));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('reports false when there was no live mirror to cancel', async () => {
        vi.mocked(db.update).mockReturnValue(q([]) as never);

        await expect(cancelSallaSubscriptionLocal(STORE, 'salla_app_uninstalled', mkLog())).resolves.toBe(false);
    });
});

describe('reconcileSallaBilling', () => {
    it('sweeps active stores and counts what it healed', async () => {
        vi.mocked(db.select)
            // the store list
            .mockReturnValueOnce(q([{ id: STORE, platformData: null }]) as never)
            // syncSallaBilling's own store lookup
            .mockReturnValueOnce(q([activeStoreRow]) as never)
            // adopt's current-subscription lookup
            .mockReturnValueOnce(q([]) as never)
            // the orphan sweep
            .mockReturnValue(q([]) as never);
        vi.mocked(db.insert).mockReturnValue(q([]) as never);
        mockApiGet.mockResolvedValue({ data: [planEntry()] });

        const result = await reconcileSallaBilling({ log: mkLog() });

        expect(result.scanned).toBe(1);
        expect(result.healed).toBe(1);
        expect(result.errors).toBe(0);
    });

    it('skips demo-seeded stores — their placeholder tokens cannot reach a real API', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ id: STORE, platformData: { demo: true } }]) as never)
            .mockReturnValue(q([]) as never);

        const result = await reconcileSallaBilling({ log: mkLog() });

        expect(result.scanned).toBe(0);
        expect(mockApiGet).not.toHaveBeenCalled();
    });

    it('isolates a per-store failure and raises ONE aggregated Sentry event', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([{ id: STORE, platformData: null }]) as never)
            .mockReturnValueOnce(q([activeStoreRow]) as never)
            .mockReturnValue(q([]) as never);
        mockApiGet.mockRejectedValue(new Error('Salla 500'));

        const result = await reconcileSallaBilling({ log: mkLog() });

        expect(result.errors).toBe(1);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), 'Salla billing reconciliation sweep errors',
            expect.objectContaining({ fingerprint: ['salla-billing-sweep-errors'] }),
        );
    });

    it('flags live mirrors whose store row is gone — a missed uninstall webhook', async () => {
        vi.mocked(db.select)
            .mockReturnValueOnce(q([]) as never)
            .mockReturnValue(q([{ id: 'row_1', sallaStoreId: 'vanished-store' }]) as never);

        const result = await reconcileSallaBilling({ log: mkLog() });

        expect(result.orphaned).toBe(1);
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.anything(), 'Salla billing reconciliation found orphaned local mirrors',
            expect.objectContaining({ fingerprint: ['salla-billing-orphaned-mirrors'] }),
        );
    });
});
