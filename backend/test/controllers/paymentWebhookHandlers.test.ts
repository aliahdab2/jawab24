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
    handleTopupPaymentFailed,
    handlePaymentFailed,
    reverseTopupForCharge,
} from '../../src/controllers/paymentWebhookHandlers';
import { db } from '../../src/db';
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

    it('warns and does nothing when no DB row exists', async () => {
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

describe('handleTopupPaymentFailed', () => {
    it('ignores non-top-up PaymentIntents', async () => {
        const req = mkReq();
        await handleTopupPaymentFailed({ id: 'pi_sub', metadata: { type: 'subscription' } } as unknown as Stripe.PaymentIntent, req);
        expect(req.log.info).not.toHaveBeenCalled();
    });

    it('logs a non-terminal attempt for a top-up (leaves the row open for retry)', async () => {
        const req = mkReq();
        await handleTopupPaymentFailed({ id: 'pi_topup', metadata: { type: 'topup' } } as unknown as Stripe.PaymentIntent, req);
        expect(req.log.info).toHaveBeenCalled();
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
