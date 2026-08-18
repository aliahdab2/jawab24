import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type Stripe from 'stripe';

// Mocks must be defined before importing the module under test.
vi.mock('../../src/db', () => ({
    db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email', name: 'name' },
    plans: { id: 'id', name: 'name', stripePriceId: 'stripe_price_id', stripeYearlyPriceId: 'stripe_yearly_price_id' },
    subscriptions: { id: 'id', userId: 'user_id', status: 'status', stripeCustomerId: 'stripe_customer_id', createdAt: 'created_at', externalSubscriptionId: 'external_subscription_id' },
    settings: { userId: 'user_id', dashboardLanguage: 'dashboard_language' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    desc: vi.fn((field) => ({ field, op: 'desc' })),
    or: vi.fn((...args) => ({ args, op: 'or' })),
    sql: vi.fn(),
}));

vi.mock('../../src/services/stripe', () => ({
    stripeService: { getSubscription: vi.fn(), cancelSubscriptionImmediately: vi.fn() },
    stripeRefId: (ref: string | { id: string } | null | undefined) => (!ref ? null : typeof ref === 'string' ? ref : ref.id),
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        invalidateStatusCache: vi.fn().mockResolvedValue(undefined),
        initializeUsagePeriod: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/topup', () => ({
    topupService: {
        settleStripeTopup: vi.fn(),
        reverseStripeTopup: vi.fn().mockResolvedValue({ reversed: false, decremented: false }),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotification: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/paymentRequest', () => ({ paymentRequestService: { markPaid: vi.fn() } }));
vi.mock('../../src/services/email', () => ({ emailService: { send: vi.fn() } }));
vi.mock('../../src/utils/emailTemplates', () => ({ subscriptionWelcomeEmailTemplate: vi.fn(() => ({ subject: 's', html: 'h' })) }));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/config', () => ({ config: { frontendUrl: 'http://localhost:3001' } }));

import {
    handleSubscriptionCreated,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handleTopupPaymentSucceeded,
    handlePaymentIntentFailed,
    handlePaymentFailed,
    handlePaymentSucceeded,
    handleChargeRefunded,
    reverseTopupForCharge,
} from '../../src/controllers/paymentWebhookHandlers';
import { db } from '../../src/db';
import { stripeService } from '../../src/services/stripe';
import { subscriptionsService } from '../../src/services/subscriptions';
import { topupService } from '../../src/services/topup';
import { notificationService } from '../../src/services/notifications';
import { captureError } from '../../src/utils/sentryHelpers';

// Flexible Drizzle query mock: resolves to `rows`, and every builder method
// (from/where/limit/orderBy/set/returning/...) is a spy returning another such
// thenable resolving to the same rows. One mock satisfies any chain shape, and
// the builder spies (e.g. `.set`) are inspectable so tests can assert payloads.
type QueryMock = Promise<unknown[]> & { from: Mock; where: Mock; limit: Mock; orderBy: Mock; set: Mock; returning: Mock; values: Mock };
function q(rows: unknown[]): QueryMock {
    const p = Promise.resolve(rows) as QueryMock;
    for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'returning', 'values'] as const) {
        p[m] = vi.fn(() => q(rows));
    }
    return p;
}

const mkReq = () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as FastifyRequest);

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: false, decremented: false });
});

describe('handleSubscriptionDeleted', () => {
    it('marks the subscription canceled and invalidates the status cache', async () => {
        const chain = q([{ userId: 'u1' }]);
        vi.mocked(db.update).mockReturnValue(chain as never);
        await handleSubscriptionDeleted({ id: 'sub_1' } as Stripe.Subscription, mkReq());
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled', canceledAt: expect.any(Date) }));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('does not touch the cache when no DB row matched', async () => {
        vi.mocked(db.update).mockReturnValue(q([]) as never);
        await handleSubscriptionDeleted({ id: 'sub_missing' } as Stripe.Subscription, mkReq());
        expect(subscriptionsService.invalidateStatusCache).not.toHaveBeenCalled();
    });
});

describe('handleSubscriptionCreated (backup path)', () => {
    it('corrects status to active when DB lags Stripe', async () => {
        const chain = q([]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 's1', status: 'past_due' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);
        await handleSubscriptionCreated({ id: 'sub_1', status: 'active' } as Stripe.Subscription, mkReq());
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    });

    it('does not update when the existing row is already active', async () => {
        vi.mocked(db.select).mockReturnValue(q([{ id: 's1', status: 'active' }]) as never);
        await handleSubscriptionCreated({ id: 'sub_1', status: 'active' } as Stripe.Subscription, mkReq());
        expect(db.update).not.toHaveBeenCalled();
    });

    it('warns and does nothing when no DB row exists and there is no metadata to adopt by', async () => {
        vi.mocked(db.select).mockReturnValue(q([]) as never);
        const req = mkReq();
        await handleSubscriptionCreated({ id: 'sub_x', status: 'active' } as Stripe.Subscription, req);
        expect(db.update).not.toHaveBeenCalled();
        expect(req.log.warn).toHaveBeenCalled();
    });
});

describe('handleSubscriptionUpdated', () => {
    const sub = {
        id: 'sub_1',
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_123' } }] },
        current_period_start: 1700000000,
        current_period_end: 1702000000,
    } as unknown as Stripe.Subscription;

    it('resolves the plan by price, updates, and invalidates the cache', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);  // plan lookup by price
        vi.mocked(db.update).mockReturnValue(chain as never);                    // update returning
        await handleSubscriptionUpdated(sub, mkReq());
        // Verifies the resolved planId actually flows into the update, not just that update ran.
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', planId: 'plan_pro' }));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('warns when no subscription row matches', async () => {
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
        vi.mocked(db.update).mockReturnValue(q([]) as never);
        const req = mkReq();
        await handleSubscriptionUpdated(sub, req);
        expect(subscriptionsService.invalidateStatusCache).not.toHaveBeenCalled();
        expect(req.log.warn).toHaveBeenCalled();
    });

    /**
     * The Nourva defect (2026-08-13 → 08-18). Stripe keeps invoicing a
     * subscription whose renewal failed, so `customer.subscription.updated`
     * arrives carrying the NEXT period — which the merchant has not paid for.
     * Mirroring it moved `current_period_end` a month into the future, and
     * since the entitlement gate reads that column as "paid through", the 3-day
     * grace landed a month late. `getCurrentUsage` matches a usage row only
     * while `periodStart <= now <= periodEnd`, so the advanced period ALSO
     * opened a fresh window with the counter at zero — a free 10,000 replies on
     * top of a free month, for a merchant who caps his plan every month.
     *
     * `set` is asserted on the payload rather than the row: the assertion that
     * matters is which KEYS are absent, which a returned-row check cannot see.
     */
    const unpaidPeriod = (status: string) => ({
        ...sub,
        status,
        current_period_start: 1755115304, // 2026-08-13 — the failed renewal
        current_period_end: 1757793704,   // 2026-09-13 — a month never paid for
    }) as unknown as Stripe.Subscription;

    it.each(['past_due', 'unpaid'])(
        'does NOT advance the paid-through period on %s — the merchant has not paid for it',
        async (status) => {
            const chain = q([{ id: 's1', userId: 'u1' }]);
            vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
            vi.mocked(db.update).mockReturnValue(chain as never);

            await handleSubscriptionUpdated(unpaidPeriod(status), mkReq());

            const payload = chain.set.mock.calls[0][0];
            expect(payload).not.toHaveProperty('currentPeriodStart');
            expect(payload).not.toHaveProperty('currentPeriodEnd');
        },
    );

    /**
     * The other half of the same bug: Stripe's `unpaid` (Smart Retries
     * exhausted under the dashboard's "mark unpaid" setting) is not one of our
     * five statuses. Written raw it fell through every branch of
     * checkSubscriptionStatus to allowed-forever — and there is no CHECK
     * constraint on the column to stop it landing.
     */
    it('translates unpaid into past_due rather than writing Stripe\'s value raw', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await handleSubscriptionUpdated(unpaidPeriod('unpaid'), mkReq());

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'past_due' }));
    });

    /** The paid path must be untouched — this is the renewal every customer hits. */
    it('DOES advance the period on active — a paid renewal still moves the boundary', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await handleSubscriptionUpdated(sub, mkReq());

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'active',
            currentPeriodStart: new Date(1700000000 * 1000),
            currentPeriodEnd: new Date(1702000000 * 1000),
        }));
    });

    it('advances the period on trialing — a Stripe-managed trial is a paid-for period', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await handleSubscriptionUpdated({ ...sub, status: 'trialing' } as unknown as Stripe.Subscription, mkReq());

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'trialing',
            currentPeriodEnd: new Date(1702000000 * 1000),
        }));
    });

    /**
     * `incomplete` applies only to a subscription that never activated, so an
     * existing row reaching it is a downgrade we cannot explain. Preserve the
     * current status rather than guessing — and say so in the log.
     */
    it('leaves the local status untouched on incomplete, and warns', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);
        const req = mkReq();

        await handleSubscriptionUpdated({ ...sub, status: 'incomplete' } as unknown as Stripe.Subscription, req);

        expect(chain.set.mock.calls[0][0]).not.toHaveProperty('status');
        expect(req.log.warn).toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled(); // a known state, not a gap
    });

    /**
     * A status Stripe adds after this map was written must be visible, not
     * silently mis-entitling whoever hits it first.
     */
    it('writes no status and reports an unknown one to Sentry', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await handleSubscriptionUpdated({ ...sub, status: 'future_status' } as unknown as Stripe.Subscription, mkReq());

        expect(chain.set.mock.calls[0][0]).not.toHaveProperty('status');
        expect(captureError).toHaveBeenCalledWith(
            null,
            'Unmapped Stripe subscription status',
            expect.objectContaining({ extra: expect.objectContaining({ stripeStatus: 'future_status' }) }),
        );
    });

    /**
     * Withholding the period must not withhold everything else: a merchant can
     * still set cancel-at-period-end, or change plan, while past_due.
     */
    it('still mirrors cancelAtPeriodEnd and the resolved plan while unpaid', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.select).mockReturnValue(q([{ id: 'plan_pro' }]) as never);
        vi.mocked(db.update).mockReturnValue(chain as never);

        await handleSubscriptionUpdated(
            { ...unpaidPeriod('past_due'), cancel_at_period_end: true } as unknown as Stripe.Subscription,
            mkReq(),
        );

        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
            cancelAtPeriodEnd: true,
            planId: 'plan_pro',
        }));
    });
});

describe('handleTopupPaymentSucceeded (credits money)', () => {
    const topupPi = { id: 'pi_topup', metadata: { type: 'topup' } } as unknown as Stripe.PaymentIntent;

    it('ignores PaymentIntents that are not top-ups (never settles)', async () => {
        await handleTopupPaymentSucceeded({ id: 'pi_sub', metadata: { type: 'subscription' } } as unknown as Stripe.PaymentIntent, mkReq());
        expect(topupService.settleStripeTopup).not.toHaveBeenCalled();
    });

    it('credits the pack and notifies the user on success', async () => {
        vi.mocked(topupService.settleStripeTopup).mockResolvedValue({ credited: true, userId: 'u1', repliesAdded: 5000, newBalance: 5000 } as never);
        await handleTopupPaymentSucceeded(topupPi, mkReq());
        expect(topupService.settleStripeTopup).toHaveBeenCalledWith('pi_topup');
        // Assert the credited amount actually reaches the notification, not just that one was sent.
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith('u1', 'topup_credited', { replies: '5000' }, { deepLink: '/dashboard' });
    });

    it('is idempotent on replay (already settled → no notification, no error)', async () => {
        vi.mocked(topupService.settleStripeTopup).mockResolvedValue({ credited: false, alreadySettled: true } as never);
        await handleTopupPaymentSucceeded(topupPi, mkReq());
        expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('raises a Sentry alert when a paid top-up has no pending row (money at risk)', async () => {
        vi.mocked(topupService.settleStripeTopup).mockResolvedValue({ credited: false, alreadySettled: false } as never);
        await handleTopupPaymentSucceeded(topupPi, mkReq());
        expect(captureError).toHaveBeenCalled();
    });
});

describe('handlePaymentIntentFailed', () => {
    // Shaped like a real Stripe decline payload.
    const declinedPi = (metadata: Record<string, string>) => ({
        id: 'pi_1',
        customer: 'cus_1',
        metadata,
        last_payment_error: {
            code: 'card_declined',
            decline_code: 'do_not_honor',
            payment_method: { card: { country: 'LY', brand: 'mastercard' } },
        },
    } as unknown as Stripe.PaymentIntent);

    // Regression (2026-07-25): the non-top-up branch used to be a bare `return`,
    // so a merchant whose card was refused on the subscription's first invoice
    // left no trace at all — the account sat `incomplete` in Stripe and we only
    // learned about it when he complained.
    it('logs the decline detail for a subscription PaymentIntent', async () => {
        const req = mkReq();
        await handlePaymentIntentFailed(declinedPi({ type: 'subscription' }), req);
        expect(req.log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentIntentId: 'pi_1',
                customerId: 'cus_1',
                errorCode: 'card_declined',
                declineCode: 'do_not_honor',
                cardCountry: 'LY',
                cardBrand: 'mastercard',
            }),
            'Subscription card attempt failed',
        );
    });

    it('logs a non-terminal attempt for a top-up (leaves the row open for retry)', async () => {
        const req = mkReq();
        await handlePaymentIntentFailed(declinedPi({ type: 'topup' }), req);
        expect(req.log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ paymentIntentId: 'pi_1', declineCode: 'do_not_honor' }),
            expect.stringContaining('Top-up payment attempt failed'),
        );
    });

    it('never touches money state on either branch', async () => {
        await handlePaymentIntentFailed(declinedPi({ type: 'subscription' }), mkReq());
        await handlePaymentIntentFailed(declinedPi({ type: 'topup' }), mkReq());
        expect(db.update).not.toHaveBeenCalled();
        expect(topupService.settleStripeTopup).not.toHaveBeenCalled();
        expect(topupService.reverseStripeTopup).not.toHaveBeenCalled();
    });

    it('resolves an expanded customer object and survives a missing last_payment_error', async () => {
        const req = mkReq();
        await handlePaymentIntentFailed({
            id: 'pi_2',
            customer: { id: 'cus_expanded' },
            metadata: {},
        } as unknown as Stripe.PaymentIntent, req);
        expect(req.log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ customerId: 'cus_expanded', declineCode: undefined }),
            'Subscription card attempt failed',
        );
    });
});

describe('handlePaymentFailed', () => {
    it('marks the subscription past_due and notifies the user', async () => {
        const chain = q([{ userId: 'u1' }]);
        vi.mocked(db.update).mockReturnValue(chain as never);
        await handlePaymentFailed({ id: 'in_1', subscription: 'sub_1' } as unknown as Stripe.Invoice, mkReq());
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'past_due' }));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith('u1', 'payment_failed', expect.anything(), expect.anything());
    });

    it('returns early when the invoice has no subscription', async () => {
        await handlePaymentFailed({ id: 'in_2', subscription: null } as unknown as Stripe.Invoice, mkReq());
        expect(db.update).not.toHaveBeenCalled();
    });
});

describe('reverseTopupForCharge (claws back credits)', () => {
    const charge = { id: 'ch_1', payment_intent: 'pi_topup' } as Pick<Stripe.Charge, 'id' | 'payment_intent'>;

    it('returns false (not a top-up) when the charge has no PaymentIntent', async () => {
        const result = await reverseTopupForCharge({ id: 'ch_2', payment_intent: null }, mkReq(), 'refund');
        expect(result).toBe(false);
        expect(topupService.reverseStripeTopup).not.toHaveBeenCalled();
    });

    it('returns false when the PaymentIntent does not match a top-up row', async () => {
        vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: false, decremented: false });
        const result = await reverseTopupForCharge(charge, mkReq(), 'refund');
        expect(result).toBe(false);
    });

    it('reverses the top-up and returns true when a row matched', async () => {
        vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: true, decremented: true });
        const result = await reverseTopupForCharge(charge, mkReq(), 'dispute');
        expect(topupService.reverseStripeTopup).toHaveBeenCalledWith('pi_topup');
        expect(result).toBe(true);
    });
});

describe('handlePaymentSucceeded (renewal activation)', () => {
    // `status` was absent from this fixture until 2026-08-18. A real
    // Stripe.Subscription always carries one, and the handler now reads it —
    // an incomplete fixture would have made the paid path untestable.
    beforeEach(() => {
        vi.mocked(stripeService.getSubscription).mockResolvedValue({
            status: 'active',
            current_period_start: 1700000000,
            current_period_end: 1702000000,
        } as never);
    });

    it('activates the subscription, resets the usage period, and invalidates the cache', async () => {
        const chain = q([{ id: 's1', userId: 'u1' }]);
        vi.mocked(db.update).mockReturnValue(chain as never);
        await handlePaymentSucceeded({ id: 'in_1', subscription: 'sub_1' } as unknown as Stripe.Invoice, mkReq());
        expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
        expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledWith('u1', expect.any(Date), expect.any(Date));
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('u1');
    });

    it('returns early (no Stripe call) when the invoice has no subscription', async () => {
        await handlePaymentSucceeded({ id: 'in_2', subscription: null } as unknown as Stripe.Invoice, mkReq());
        expect(stripeService.getSubscription).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
    });

    /**
     * A paid invoice is not a paid subscription. An `unpaid` subscription holds
     * several open invoices at once (Stripe docs), so settling an old one fires
     * this event while Stripe still considers the subscription delinquent.
     *
     * Before the guard, this granted `active` + whatever period Stripe reported
     * — potentially months out — + a fresh quota window from
     * initializeUsagePeriod. That is the free-month defect through a wider door
     * than the one handleSubscriptionUpdated closes, because the quota reset
     * makes it immediate rather than merely entitling.
     */
    it.each(['unpaid', 'past_due', 'incomplete'])(
        'does not activate, mirror the period, or reset quota when Stripe reports %s',
        async (status) => {
            vi.mocked(stripeService.getSubscription).mockResolvedValue({
                status,
                current_period_start: 1700000000,
                current_period_end: 1702000000,
            } as never);
            vi.mocked(db.update).mockReturnValue(q([{ id: 's1', userId: 'u1' }]) as never);

            await handlePaymentSucceeded({ id: 'in_x', subscription: 'sub_1' } as unknown as Stripe.Invoice, mkReq());

            expect(db.update).not.toHaveBeenCalled();
            expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();
        },
    );

    /**
     * Money landed while the merchant stays blocked. That is a legitimate state,
     * not an error — but it must not be discoverable only from a log line.
     */
    it('reports to Sentry when an invoice is paid on a still-unpaid subscription', async () => {
        vi.mocked(stripeService.getSubscription).mockResolvedValue({
            status: 'unpaid',
            current_period_start: 1700000000,
            current_period_end: 1702000000,
        } as never);

        await handlePaymentSucceeded({ id: 'in_y', subscription: 'sub_1' } as unknown as Stripe.Invoice, mkReq());

        expect(captureError).toHaveBeenCalledWith(
            null,
            'Invoice paid while subscription remains unpaid',
            expect.objectContaining({ extra: expect.objectContaining({ stripeStatus: 'unpaid' }) }),
        );
    });
});

describe('handleChargeRefunded (subscription refund path)', () => {
    const refundCharge = { id: 'ch_1', payment_intent: 'pi_sub', customer: 'cus_1', amount_refunded: 4900, currency: 'usd' } as unknown as Stripe.Charge;

    it('notifies the customer with the refunded amount when the charge is not a top-up', async () => {
        vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: false, decremented: false });
        vi.mocked(db.select).mockReturnValue(q([{ userId: 'u1' }]) as never);
        await handleChargeRefunded(refundCharge, mkReq());
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
            'u1', 'refund_processed', { amount: '49.00', currency: 'USD' }, expect.anything(),
        );
    });

    it('short-circuits with no subscription lookup or notice when the charge was a top-up', async () => {
        vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: true, decremented: true });
        await handleChargeRefunded(refundCharge, mkReq());
        expect(db.select).not.toHaveBeenCalled();
        expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
    });

    it('warns and sends nothing when the refunded charge has no customer', async () => {
        vi.mocked(topupService.reverseStripeTopup).mockResolvedValue({ reversed: false, decremented: false });
        const req = mkReq();
        await handleChargeRefunded({ id: 'ch_2', payment_intent: 'pi_x', customer: null, amount_refunded: 100, currency: 'usd' } as unknown as Stripe.Charge, req);
        expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
        expect(req.log.warn).toHaveBeenCalled();
    });
});
