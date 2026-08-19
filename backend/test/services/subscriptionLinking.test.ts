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
        status: 'status', currentPeriodEnd: 'current_period_end',
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

const mockHandlePaymentRecovery = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/dunningNotices', () => ({
    handlePaymentRecovery: (...a: unknown[]) => mockHandlePaymentRecovery(...a),
}));

import {
    adoptStripeSubscription,
    healStripeSubscriptionPeriod,
    reconcileStripeSubscriptions,
} from '../../src/services/subscriptionLinking';
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

// ---------------------------------------------------------------------------
// Wire fixtures for the period healer.
//
// Taken from the LIVE Stripe API on 2026-08-19, not invented: the earlier
// #817 regression test asserted a payload shape Stripe never sends
// (`past_due` carrying an advanced period) and passed while the defect was
// fully live. Both shapes below were read with `stripe subscriptions list
// --live` / `stripe invoices retrieve --live`.
//
// Note the period lives on the subscription ITEM, not the subscription: on the
// endpoint's API version `current_period_start/end` are absent at the top level
// (confirmed null on all three live subscriptions), which is exactly what
// getSubscriptionPeriod's fallback exists for.
// ---------------------------------------------------------------------------

const JUL_13 = 1_783_971_704; // 2026-07-13T19:41:44Z
const AUG_13 = 1_786_650_104; // 2026-08-13T19:41:44Z
const SEP_13 = 1_789_328_504; // 2026-09-13T19:41:44Z

/** A subscription whose ITEM carries the period, with an expanded invoice. */
const wireSub = (over: {
    status?: string;
    start?: number;
    end?: number;
    invoice?: unknown;
    id?: string;
} = {}) => ({
    id: over.id ?? 'sub_linked',
    status: over.status ?? 'active',
    customer: 'cus_1',
    metadata: { userId: 'u1', planId: 'plan_business' },
    items: { data: [{ current_period_start: over.start ?? AUG_13, current_period_end: over.end ?? SEP_13 }] },
    ...('invoice' in over ? { latest_invoice: over.invoice } : { latest_invoice: { id: 'in_paid', status: 'paid' } }),
} as unknown as Stripe.Subscription);

/** The local row as the sweep selects it. */
const localRow = (over: Record<string, unknown> = {}) => ({
    id: 'row_1',
    userId: 'u1',
    status: 'active',
    paymentMethod: 'stripe',
    currentPeriodEnd: new Date(AUG_13 * 1000),
    ...over,
});

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

        expect(r).toMatchObject({ scanned: 1, healed: 1, periodsHealed: 0, alreadyLinked: 0, orphaned: 0, errors: 0 });
        expect(db.update).toHaveBeenCalled();
    });

    it('leaves an already-linked subscription alone when Stripe agrees with it', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([wireSub({ start: JUL_13, end: AUG_13 })])
            .mockResolvedValueOnce([]);
        vi.mocked(db.select).mockReturnValue(q([localRow({ currentPeriodEnd: new Date(AUG_13 * 1000) })]) as never);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r).toMatchObject({ scanned: 1, healed: 0, periodsHealed: 0, alreadyLinked: 1 });
        expect(db.update).not.toHaveBeenCalled();
    });

    /**
     * The gap this sweep used to have: `if (linked) continue` meant it repaired
     * every merchant EXCEPT the correctly-linked, paying ones — the only
     * population that a missed `invoice.payment_succeeded` can block.
     *
     * Mutation check: restore `if (linked) { alreadyLinked++; continue; }` and
     * this case fails (periodsHealed 1 → 0) while every other sweep case passes.
     */
    it('advances a linked row whose renewal webhook never arrived', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([wireSub()])
            .mockResolvedValueOnce([]);
        vi.mocked(db.select).mockReturnValue(q([localRow()]) as never);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r).toMatchObject({ scanned: 1, healed: 0, periodsHealed: 1, alreadyLinked: 0, errors: 0 });
    });

    /**
     * The sweep must not become the free-month leak #817 closed. Nourva's live
     * shape: a linked row, an item period Stripe advanced, an invoice still open.
     */
    it('does not advance a linked row whose advanced period was never paid for', async () => {
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([wireSub({ invoice: { id: 'in_open', status: 'open' } })])
            .mockResolvedValueOnce([]);
        vi.mocked(db.select).mockReturnValue(q([localRow()]) as never);

        const r = await reconcileStripeSubscriptions({ log: mkLog() });

        expect(r).toMatchObject({ periodsHealed: 0, alreadyLinked: 1 });
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

    /**
     * `latest_invoice` present but NOT expanded is "unknown", not "absent". Only
     * absence is the fully-discounted exemption; conflating the two would adopt
     * on an unread invoice, which is the unpaid-month defect via a side door.
     */
    it('refuses when latest_invoice arrives as a bare id it cannot read', async () => {
        vi.mocked(stripeService.getSubscriptionWithLatestInvoice).mockResolvedValue({
            id: 'sub_1',
            latest_invoice: 'in_not_expanded',
        } as never);

        await expect(adoptStripeSubscription(paidSub(), mkLog())).resolves.toBe(false);
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });
});

/**
 * The healer for a missed `invoice.payment_succeeded`.
 *
 * Since #817 that event is the ONLY writer of `current_period_*`, which closed a
 * free-month leak and opened the opposite failure: a dropped delivery freezes a
 * PAYING merchant's paid-through, the 3-day grace expires, and they are blocked
 * while their customers' messages go unanswered. The sweep used to `continue`
 * past every linked row, so the merchants it skipped were exactly the paying
 * ones.
 *
 * Every fixture here is a shape read off the LIVE API on 2026-08-19 (see
 * wireSub) — the #817 lesson was that a hypothesised payload passes while the
 * defect ships.
 */
describe('healStripeSubscriptionPeriod', () => {
    it('advances a frozen paid-through when Stripe has been paid for the newer period', async () => {
        const chain = q([]);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await expect(healStripeSubscriptionPeriod(wireSub(), localRow(), mkLog()))
            .resolves.toBe('advanced');

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'active',
            currentPeriodStart: new Date(AUG_13 * 1000),
            currentPeriodEnd: new Date(SEP_13 * 1000),
        }));
    });

    /**
     * ⛔ THE test. Nourva's live shape at 2026-08-13 19:41:52: Stripe had already
     * advanced the item period to 09-13 while the subscription still read
     * `active`, with an OPEN, amount_paid=0 invoice — it only degraded to
     * past_due an hour later. A healer gated on the STATUS would fire here and
     * hand out the unpaid month #817 removed; the invoice is the discriminator.
     *
     * Mutation check: replace `isCurrentPeriodPaidFor(...)` in the healer with
     * `isPaidStripeStatus(stripeSubscription.status)` and this case fails while
     * the happy-path case above still passes.
     */
    it('refuses the period Stripe advanced but was never paid — the invoice is still open', async () => {
        const outcome = await healStripeSubscriptionPeriod(
            wireSub({ invoice: { id: 'in_open', status: 'open' } }),
            localRow({ currentPeriodEnd: new Date(AUG_13 * 1000) }),
            mkLog(),
        );

        expect(outcome).toBe('unpaid');
        expect(db.update).not.toHaveBeenCalled();
        expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();
        expect(mockHandlePaymentRecovery).not.toHaveBeenCalled();
    });

    /** Same reasoning one layer out: an unreadable invoice fails closed. */
    it('refuses when the listed subscription carries an unexpanded invoice id', async () => {
        const outcome = await healStripeSubscriptionPeriod(
            wireSub({ invoice: 'in_bare_id' }), localRow(), mkLog(),
        );

        expect(outcome).toBe('unpaid');
        expect(db.update).not.toHaveBeenCalled();
    });

    /**
     * Forward only. A Stripe period ending EARLIER than ours cannot be a repair
     * — and retracting it would block a merchant who paid, the exact harm this
     * function exists to prevent.
     */
    it('never retracts a paid-through boundary', async () => {
        const outcome = await healStripeSubscriptionPeriod(
            wireSub({ start: JUL_13, end: AUG_13 }),
            localRow({ currentPeriodEnd: new Date(SEP_13 * 1000) }),
            mkLog(),
        );

        expect(outcome).toBe('no_drift');
        expect(db.update).not.toHaveBeenCalled();
    });

    /**
     * This runs every 15 minutes over every paying merchant. Writing on a no-op
     * would churn `updated_at` fleet-wide — the only proxy we have for when a
     * row last genuinely changed.
     */
    it('writes nothing when Stripe already agrees with the row', async () => {
        const outcome = await healStripeSubscriptionPeriod(
            wireSub({ start: JUL_13, end: AUG_13 }),
            localRow({ currentPeriodEnd: new Date(AUG_13 * 1000) }),
            mkLog(),
        );

        expect(outcome).toBe('no_drift');
        expect(db.update).not.toHaveBeenCalled();
        expect(subscriptionsService.invalidateStatusCache).not.toHaveBeenCalled();
    });

    /**
     * `past_due` with a NULL period reads as ALLOWED FOREVER — the grace check
     * only applies when there is a period to apply it to. A missing boundary is
     * therefore not "later than Stripe's"; healing it is the whole point.
     */
    it('heals a row that has no paid-through boundary at all', async () => {
        const chain = q([]);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await expect(healStripeSubscriptionPeriod(
            wireSub(), localRow({ status: 'past_due', currentPeriodEnd: null }), mkLog(),
        )).resolves.toBe('advanced');

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'active',
            currentPeriodEnd: new Date(SEP_13 * 1000),
        }));
    });

    /**
     * Status and period move TOGETHER. A revision of #817 shipped them decoupled
     * and was strictly worse than the defect it replaced.
     */
    it('restores the status on the same write that advances the period', async () => {
        const chain = q([]);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await healStripeSubscriptionPeriod(wireSub(), localRow({ status: 'past_due' }), mkLog());

        const written = chain.set.mock.calls[0][0] as Record<string, unknown>;
        expect(written.status).toBe('active');
        expect(written.currentPeriodEnd).toEqual(new Date(SEP_13 * 1000));
    });

    /** Un-blocked but still counting against the PREVIOUS period is half a fix. */
    it('reopens the quota window for the period just proven paid for', async () => {
        await healStripeSubscriptionPeriod(wireSub(), localRow(), mkLog());

        expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledWith(
            'u1', new Date(AUG_13 * 1000), new Date(SEP_13 * 1000),
        );
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    /**
     * Both dunning branches select on `isNull(…_notified_at)` and
     * handlePaymentRecovery is the only resetter — reached only from the webhook
     * that went missing. Leaving the stamps set would silence every FUTURE
     * episode for this merchant, which is the silent-suspension failure the
     * dunning system exists to end.
     */
    it('closes the dunning episode so future failures are not silenced', async () => {
        await healStripeSubscriptionPeriod(wireSub(), localRow(), mkLog());

        expect(mockHandlePaymentRecovery).toHaveBeenCalledWith(
            'sub_linked', 'in_paid', new Date(SEP_13 * 1000),
        );
    });

    /** A trial has no invoice to settle — the check must not demand one. */
    it('heals a trialing subscription without consulting an invoice', async () => {
        await expect(healStripeSubscriptionPeriod(
            wireSub({ status: 'trialing', invoice: null }), localRow(), mkLog(),
        )).resolves.toBe('advanced');
    });

    /**
     * Row targeting: this function is reached by matching a STRIPE subscription
     * id, so the row must be stripe-billed. A manual/bank row that kept an old
     * Stripe id would otherwise have its period advanced — and its plan
     * possibly contradicted — by a subscription that no longer governs it.
     */
    it('refuses a row billed by another rail and reports it', async () => {
        const outcome = await healStripeSubscriptionPeriod(
            wireSub(), localRow({ paymentMethod: 'manual' }), mkLog(),
        );

        expect(outcome).toBe('foreign_rail');
        expect(db.update).not.toHaveBeenCalled();
        expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.stringContaining('another rail'),
            expect.objectContaining({ fingerprint: ['stripe-period-heal-foreign-rail'] }),
        );
    });

    /**
     * The paid-through write is this function's own idempotence key — once the
     * boundary advances, the next sweep reads `no_drift` and does nothing more.
     * So the quota window must be opened BEFORE it, or a throw in between leaves
     * a row that looks repaired and never gets its window. The sweep is the last
     * resort; it cannot afford a half-repair that looks complete.
     */
    it('opens the quota window before the boundary write, so a partial failure retries', async () => {
        const order: string[] = [];
        vi.mocked(subscriptionsService.initializeUsagePeriod)
            .mockImplementation(async () => { order.push('usage'); });
        vi.mocked(db.update).mockImplementation((() => {
            order.push('period');
            return q([]) as never;
        }) as never);

        await healStripeSubscriptionPeriod(wireSub(), localRow(), mkLog());

        expect(order).toEqual(['usage', 'period']);
    });

    it('leaves the boundary alone when Stripe returns no period at all', async () => {
        const log = mkLog();
        const noPeriod = { ...wireSub(), items: { data: [{}] } } as unknown as Stripe.Subscription;

        await expect(healStripeSubscriptionPeriod(noPeriod, localRow(), log)).resolves.toBe('no_period');
        expect(db.update).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });
});
