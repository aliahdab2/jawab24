/**
 * Regression coverage for the Stripe webhook self-heal path.
 *
 * The bug this defends against: a paid customer's `checkout.session.completed`
 * event never reached us (event type missing from the Stripe Dashboard
 * webhook config, signature failure, etc). The follow-up events
 * (`customer.subscription.created`, `invoice.payment_succeeded`) DID reach
 * us, but `handleSubscriptionCreated` used to log "no matching DB record
 * found" and return — meaning Stripe collected the money and we silently
 * had no subscription row. The self-heal path resolves the user via Stripe
 * customer ID / email and creates the row inline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type Stripe from 'stripe';

vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        getCustomer: vi.fn(),
        getSubscription: vi.fn(),
    },
    DemoUserStripeError: class extends Error {},
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email' },
    plans: { id: 'id', stripePriceId: 'stripe_price_id', stripeYearlyPriceId: 'stripe_yearly_price_id' },
    subscriptions: { userId: 'user_id', stripeCustomerId: 'stripe_customer_id', externalSubscriptionId: 'external_subscription_id' },
    stripeWebhookEvents: { eventId: 'event_id' },
    settings: { userId: 'user_id', dashboardLanguage: 'dashboard_language' },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), quit: vi.fn() },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        invalidateStatusCache: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotification: vi.fn() },
}));

vi.mock('../../src/services/email', () => ({
    emailService: { send: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock('../../src/utils/emailTemplates', () => ({
    subscriptionWelcomeEmailTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'http://localhost:3001',
        stripe: { webhookSecret: 'whsec_test' },
        demo: { enabled: false, userFacebookId: '', userName: '', userEmail: '' },
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    or: vi.fn((...args) => ({ op: 'or', args })),
    ilike: vi.fn((field, value) => ({ field, value, op: 'ilike' })),
    desc: vi.fn(),
    sql: vi.fn(),
}));

import { PaymentController } from '../../src/controllers/payment';
import { stripeService } from '../../src/services/stripe';
import { db } from '../../src/db';
import { subscriptionsService } from '../../src/services/subscriptions';
import { captureError } from '../../src/utils/sentryHelpers';

const NOW_TS = Math.floor(new Date('2026-05-13T22:41:00Z').getTime() / 1000);
const PERIOD_END_TS = Math.floor(new Date('2026-06-13T22:41:00Z').getTime() / 1000);

function buildStripeSub(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
    return {
        id: 'sub_1TWif6RrBx8E7qRiO21f5lsY',
        customer: 'cus_UUQXRZXx4uEcGM',
        status: 'active',
        current_period_start: NOW_TS,
        current_period_end: PERIOD_END_TS,
        trial_end: null,
        cancel_at_period_end: false,
        items: {
            data: [{ price: { id: 'price_1TE8EvRrBx8E7qRifGlPsLNe' } } as any],
        } as any,
        ...overrides,
    } as Stripe.Subscription;
}

describe('Stripe webhook self-heal (insertSubscriptionFromStripe)', () => {
    let controller: PaymentController;
    let request: FastifyRequest;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new PaymentController();
        request = {
            log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        } as unknown as FastifyRequest;
    });

    it('inserts a missing subscription row when the user is found by Stripe customer ID', async () => {
        const stripeSub = buildStripeSub();

        // 1st select: subscriptions lookup by stripeCustomerId -> finds existing link
        const mockDb = vi.mocked(db);
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ userId: 'user_42' }]),
                }),
            }),
        } as any);
        // 2nd select: plan lookup by stripePriceId -> finds Pro
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 'plan_pro' }]),
                }),
            }),
        } as any);

        // Insert subscription -> returns new row id
        const insertValues = vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'sub_db_new' }]),
        });
        mockDb.insert.mockReturnValue({ values: insertValues } as any);

        // sendSubscriptionWelcomeEmail does its own selects — make them all empty (no-throw).
        mockDb.select.mockReturnValue({
            from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        } as any);

        const result = await (controller as any).insertSubscriptionFromStripe(stripeSub, request);

        expect(result).toEqual({ id: 'sub_db_new', userId: 'user_42', planId: 'plan_pro' });
        // The inserted row mirrors Stripe (the source of truth).
        const insertedRow = insertValues.mock.calls[0][0];
        expect(insertedRow.userId).toBe('user_42');
        expect(insertedRow.planId).toBe('plan_pro');
        expect(insertedRow.externalSubscriptionId).toBe(stripeSub.id);
        expect(insertedRow.stripeCustomerId).toBe('cus_UUQXRZXx4uEcGM');
        expect(insertedRow.paymentMethod).toBe('stripe');
        expect(insertedRow.status).toBe('active');
        // Cache must be invalidated so the new row is visible immediately.
        expect(subscriptionsService.invalidateStatusCache).toHaveBeenCalledWith('user_42');
        // Stripe customer lookup should be skipped — we matched on customer ID already.
        expect(stripeService.getCustomer).not.toHaveBeenCalled();
    });

    it('falls back to Stripe customer email when no DB row is linked yet', async () => {
        const stripeSub = buildStripeSub();
        const mockDb = vi.mocked(db);

        // 1st select: subscriptions by stripeCustomerId -> empty (first-time customer)
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        } as any);
        // 2nd select: users by email -> finds the user
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 'user_42' }]),
                }),
            }),
        } as any);
        // 3rd select: plan by priceId
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 'plan_pro' }]),
                }),
            }),
        } as any);

        vi.mocked(stripeService.getCustomer).mockResolvedValue({
            email: 'nourvacare@gmail.com',
        } as Stripe.Customer);

        const insertValues = vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'sub_db_new' }]),
        });
        mockDb.insert.mockReturnValue({ values: insertValues } as any);
        // Welcome email selects — empty.
        mockDb.select.mockReturnValue({
            from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        } as any);

        const result = await (controller as any).insertSubscriptionFromStripe(stripeSub, request);

        expect(result).toEqual({ id: 'sub_db_new', userId: 'user_42', planId: 'plan_pro' });
        expect(stripeService.getCustomer).toHaveBeenCalledWith('cus_UUQXRZXx4uEcGM');
    });

    it('returns null + Sentry-reports when the Stripe customer email matches no Jawab24 user', async () => {
        const stripeSub = buildStripeSub();
        const mockDb = vi.mocked(db);

        // No existing link, no matching user.
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
            }),
        } as any);
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
            }),
        } as any);

        vi.mocked(stripeService.getCustomer).mockResolvedValue({
            email: 'unknown@example.com',
        } as Stripe.Customer);

        const result = await (controller as any).insertSubscriptionFromStripe(stripeSub, request);

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
        // Self-heal failures must alert via Sentry so support can investigate
        // before the customer files a refund request.
        expect(captureError).toHaveBeenCalled();
    });

    it('returns null when no plan matches the Stripe price ID (config mismatch)', async () => {
        const stripeSub = buildStripeSub();
        const mockDb = vi.mocked(db);

        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ userId: 'user_42' }]),
                }),
            }),
        } as any);
        // Plan lookup empty
        mockDb.select.mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
            }),
        } as any);

        const result = await (controller as any).insertSubscriptionFromStripe(stripeSub, request);

        expect(result).toBeNull();
        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(captureError).toHaveBeenCalled();
    });
});
