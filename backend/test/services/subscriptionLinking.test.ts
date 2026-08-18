/**
 * Tests for linking paid Stripe subscriptions to their local row.
 *
 * Regression (2026-07-25, production): `externalSubscriptionId` was only ever
 * written by the webhook handler for `checkout.session.completed` — an event
 * Stripe fires only for Checkout Sessions. Checkout moved to the embedded
 * PaymentElement, which creates no Session, so nothing linked the two sides.
 * Every downstream handler resolves our row by external_subscription_id and so
 * matched zero rows: merchants were charged and never activated, with the
 * webhook still returning success. One merchant paid $39 and stayed on his
 * signup trial; only 1 of 66 subscription rows was linked at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

vi.mock('../../src/db', () => ({ db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() } }));

vi.mock('../../src/db/schema', () => ({
    subscriptions: {
        id: 'id', userId: 'user_id', createdAt: 'created_at',
        externalSubscriptionId: 'external_subscription_id',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    desc: vi.fn((field) => ({ field, op: 'desc' })),
}));

vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        listSubscriptions: vi.fn(),
        // Adoption verifies that an `active` subscription's latest invoice is
        // actually paid before writing a period and a quota window — `active`
        // alone is not proof (Stripe advances the period at invoice CREATION).
        // The default here is the ordinary case: a settled invoice.
        getSubscriptionWithLatestInvoice: vi.fn().mockImplementation(async (id: string) => ({
            id,
            latest_invoice: { id: `in_${id}`, status: 'paid' },
        })),
    },
    stripeRefId: (ref: string | { id: string } | null | undefined) =>
        (!ref ? null : typeof ref === 'string' ? ref : ref.id),
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

import { adoptStripeSubscription, reconcileStripeSubscriptions } from '../../src/services/subscriptionLinking';
import { db } from '../../src/db';
import { stripeService } from '../../src/services/stripe';
import { subscriptionsService } from '../../src/services/subscriptions';
import { q, mkLog } from '../helpers/drizzleQueryMock';

const paidSub = (over: Record<string, unknown> = {}) => ({
    id: 'sub_new',
    status: 'active',
    customer: 'cus_1',
    metadata: { userId: 'u1', planId: 'plan_business' },
    ...over,
} as unknown as Stripe.Subscription);

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.select).mockReturnValue(q([]) as never);
    vi.mocked(db.update).mockReturnValue(q([]) as never);
    vi.mocked(db.insert).mockReturnValue(q([]) as never);
});

describe('adoptStripeSubscription', () => {
    it("takes over the user's existing row so the stale trial stops being served", async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await expect(adoptStripeSubscription(paidSub(), mkLog())).resolves.toBe(true);

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1',
            planId: 'plan_business',
            status: 'active',
            externalSubscriptionId: 'sub_new',
            paymentMethod: 'stripe',
            stripeCustomerId: 'cus_1',
        }));
        expect(db.insert).not.toHaveBeenCalled();
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('inserts when the user has no row at all', async () => {
        const chain = q([]);
        vi.mocked(db.insert).mockReturnValue(chain as never);

        await expect(adoptStripeSubscription(paidSub(), mkLog())).resolves.toBe(true);

        expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({ externalSubscriptionId: 'sub_new' }));
        expect(db.update).not.toHaveBeenCalled();
    });

    // Without this the merchant is activated but keeps the usage row their
    // SIGNUP TRIAL created — wrong period boundaries and trial-era quota
    // accounting for someone who is now paying. handlePaymentSucceeded does it
    // on its normal path; the adoption path returns before reaching that.
    it('opens the quota window for the period just paid for', async () => {
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);

        await adoptStripeSubscription(paidSub({
            current_period_start: 1_800_000_000,
            current_period_end: 1_802_592_000,
        }), mkLog());

        expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledWith(
            'u1', expect.any(Date), expect.any(Date),
        );
    });

    it('warns instead of throwing when Stripe returns no period boundaries', async () => {
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);
        const log = mkLog();

        await expect(adoptStripeSubscription(paidSub(), log)).resolves.toBe(true);

        expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });

    it('adopts a trialing subscription — a card is on file, it is a real commitment', async () => {
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);
        await expect(adoptStripeSubscription(paidSub({ status: 'trialing' }), mkLog())).resolves.toBe(true);
    });

    // The guard that stops retry-spam from hijacking the row. A merchant who
    // reloads checkout racks up several `default_incomplete` subscriptions
    // before paying; adopting one would mark an unpaid account active.
    it('refuses to adopt a subscription that has not been paid for', async () => {
        await expect(adoptStripeSubscription(paidSub({ status: 'incomplete' }), mkLog())).resolves.toBe(false);
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('refuses to adopt when the metadata is missing', async () => {
        const log = mkLog();
        await expect(adoptStripeSubscription(paidSub({ metadata: {} }), log)).resolves.toBe(false);
        expect(db.update).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });

    /**
     * `active` is not proof the current period was paid for. Stripe advances the
     * period when it CREATES the renewal invoice and degrades the status about an
     * hour later if the charge fails — measured on the 2026-08-13 incident, where
     * the advancing event carried status=active alongside an open, amount_paid=0
     * invoice. Adoption writes BOTH the period and the quota window, so adopting
     * inside that window hands out an unpaid month.
     */
    it('refuses an active subscription whose latest invoice is still open', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscriptionWithLatestInvoice).mockResolvedValue({
            id: 'sub_1',
            latest_invoice: { id: 'in_1', status: 'open' },
        } as never);

        await expect(adoptStripeSubscription(paidSub(), mkLog())).resolves.toBe(false);
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
        expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();
    });

    /**
     * The rule is "refuse a CONTRADICTED period", not "demand proof of payment":
     * a fully-discounted subscription has no invoice to check, and refusing it
     * would strand a legitimate merchant forever.
     */
    it('still adopts an active subscription that has no invoice at all', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscriptionWithLatestInvoice).mockResolvedValue({
            id: 'sub_1',
            latest_invoice: null,
        } as never);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);

        await expect(adoptStripeSubscription(paidSub(), mkLog())).resolves.toBe(true);
    });

    /** A trial has no invoice to pay — the check must not reach for one. */
    it('does not consult the invoice for a trialing subscription', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscriptionWithLatestInvoice).mockClear();
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);

        await expect(adoptStripeSubscription(paidSub({ status: 'trialing' }), mkLog())).resolves.toBe(true);
        expect(stripeService.getSubscriptionWithLatestInvoice).not.toHaveBeenCalled();
    });
});

describe('reconcileStripeSubscriptions', () => {
    it('heals a merchant who paid but was never linked', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([paidSub()])   // active
            .mockResolvedValueOnce([]);           // trialing
        // Row lookup by external id misses, then adoption's user lookup hits.
        vi.mocked(db.select)
            .mockReturnValueOnce(q([]) as never)
            .mockReturnValueOnce(q([{ id: 'row_1' }]) as never);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r).toMatchObject({ scanned: 1, healed: 1, alreadyLinked: 0, orphaned: 0, errors: 0 });
        expect(db.update).toHaveBeenCalled();
    });

    it('leaves an already-linked subscription alone', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([paidSub()])
            .mockResolvedValueOnce([]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r).toMatchObject({ scanned: 1, healed: 0, alreadyLinked: 1 });
        expect(db.update).not.toHaveBeenCalled();
    });

    it('counts a paid-but-un-adoptable subscription as orphaned rather than healing it', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([paidSub({ metadata: {} })])
            .mockResolvedValueOnce([]);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r).toMatchObject({ scanned: 1, healed: 0, orphaned: 1 });
    });

    it('isolates a failure so one bad subscription cannot stall the sweep', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([paidSub({ id: 'sub_bad' }), paidSub({ id: 'sub_ok' })])
            .mockResolvedValueOnce([]);
        vi.mocked(db.select)
            .mockImplementationOnce(() => { throw new Error('db blew up'); })
            .mockReturnValueOnce(q([]) as never)
            .mockReturnValueOnce(q([{ id: 'row_1' }]) as never);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r).toMatchObject({ scanned: 2, errors: 1, healed: 1 });
    });

    // A merchant Stripe says is PAID that we cannot link is money taken with no
    // account activated, and nothing will fix it on its own. The cron scaffold
    // only alerts on `healed`, so without this it stays buried in a log line.
    it('raises a Sentry alert when a paid subscription cannot be linked', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([paidSub({ metadata: {} })])
            .mockResolvedValueOnce([]);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r.orphaned).toBe(1);
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        expect(mockCaptureError.mock.calls[0][1]).toContain('orphaned paid subscriptions');
    });

    it('stays silent when every paid subscription is accounted for', async () => {
        vi.mocked(stripeService.listSubscriptions).mockResolvedValue([]);
        await reconcileStripeSubscriptions({ log: mkLog() });
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    // A bounded sweep must never look like a complete one.
    it('warns when the page cap is hit so a silent truncation cannot pass as full coverage', async () => {
        const log = mkLog();
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([paidSub(), paidSub({ id: 'sub_b' })])
            .mockResolvedValueOnce([]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'row_1' }]) as never);

        await reconcileStripeSubscriptions({ limit: 2, log });

        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'active', limit: 2 }),
            expect.stringContaining('page cap'),
        );
    });

    it('sweeps both paid states', async () => {
        vi.mocked(stripeService.listSubscriptions).mockResolvedValue([]);
        await reconcileStripeSubscriptions({ log: mkLog() });

        expect(stripeService.listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
        expect(stripeService.listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ status: 'trialing' }));
    });
});

describe('adoptStripeSubscription — D-H twin (Shopify mirror protection)', () => {
    it('refuses to overwrite a live shopify-billed row and alerts Sentry', async () => {
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'shopify', status: 'active',
        }]) as never);

        await expect(adoptStripeSubscription(paidSub(), mkLog())).resolves.toBe(false);

        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.stringContaining('Shopify mirror'),
            expect.objectContaining({ fingerprint: ['stripe-adopt-refused-shopify-mirror'] }),
        );
    });

    it('still adopts over a canceled shopify row — the merchant came back through Stripe', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{
            id: 'row_1', paymentMethod: 'shopify', status: 'canceled',
        }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await expect(adoptStripeSubscription(paidSub(), mkLog())).resolves.toBe(true);

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'stripe' }));
    });
});
