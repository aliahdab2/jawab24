import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';

// Import setup to ensure DATABASE_URL points at the test DB
import './setup';

// ---------------------------------------------------------------------------
// Mock Stripe service — keeps all DB operations real
// ---------------------------------------------------------------------------
vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        createCheckoutSession: vi.fn().mockResolvedValue({
            id: 'cs_test_123',
            client_secret: 'cs_test_123_secret',
        }),
        getSubscription: vi.fn().mockImplementation(async (id: string) => ({
            id,
            status: 'trialing',
            customer: 'cus_test_123',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
            cancel_at_period_end: false,
        })),
        cancelSubscription: vi.fn().mockResolvedValue({}),
        cancelSubscriptionImmediately: vi.fn().mockResolvedValue({}),
        createBillingPortalSession: vi.fn().mockResolvedValue({
            url: 'https://billing.stripe.com/test',
        }),
        verifyWebhookSignature: vi.fn(),
    },
    stripe: null,
}));

// Mock authenticate middleware — user is injected via preHandler hook in buildApp()
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn().mockImplementation(async () => { /* no-op — user set by hook */ }),
    requireAdmin: vi.fn().mockImplementation(async () => {}),
}));

// Mock notification service to avoid real push notifications
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
    },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestPlan(overrides: Partial<typeof schema.plans.$inferInsert> = {}) {
    const [plan] = await testDb
        .insert(schema.plans)
        .values({
            name: overrides.name ?? 'Test Plan',
            slug: overrides.slug ?? `test-plan-${Date.now()}`,
            price: overrides.price ?? 1900,
            stripePriceId: overrides.stripePriceId ?? 'price_test_123',
            trialDays: overrides.trialDays ?? 7,
            ...overrides,
        })
        .returning();
    return plan;
}

async function createTestSubscription(
    userId: string,
    planId: string,
    overrides: Partial<typeof schema.subscriptions.$inferInsert> = {},
) {
    const [sub] = await testDb
        .insert(schema.subscriptions)
        .values({
            userId,
            planId,
            status: overrides.status ?? 'active',
            externalSubscriptionId: overrides.externalSubscriptionId ?? `sub_${Date.now()}`,
            stripeCustomerId: overrides.stripeCustomerId ?? `cus_${Date.now()}`,
            paymentMethod: 'stripe',
            currentPeriodStart: overrides.currentPeriodStart ?? new Date(),
            currentPeriodEnd: overrides.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
            cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
            ...overrides,
        })
        .returning();
    return sub;
}

/** Build a minimal Fastify app with payment routes and a fake auth decorator */
async function buildApp(userId: string): Promise<FastifyInstance> {
    const app = fastify({ logger: false });

    // Inject user into every request (bypasses JWT)
    app.addHook('preHandler', async (request: any) => {
        request.user = { userId, facebookId: 'fb_test' };
        request.geo = { country: 'US', region: null };
    });

    const paymentRoutes = (await import('../../src/routes/payment')).default;
    app.register(paymentRoutes, { prefix: '/' });
    await app.ready();
    return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Payment — createCheckoutSession', () => {
    let app: FastifyInstance;
    let userId: string;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'payer@test.com' });
        userId = user.id;
        app = await buildApp(userId);
    });

    afterEach(async () => { await app.close(); });

    it('returns 400 when planId is missing', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 when plan does not exist', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: '00000000-0000-0000-0000-000000000000' },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json().error).toMatch(/plan not found/i);
    });

    it('returns 400 EMAIL_REQUIRED when user has no email', async () => {
        const noEmailUser = await createTestUser({ email: null as any });
        const noEmailApp = await buildApp(noEmailUser.id);

        const plan = await createTestPlan();
        const res = await noEmailApp.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id },
        });

        await noEmailApp.close();
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('EMAIL_REQUIRED');
    });

    it('returns 400 when plan has no Stripe price ID', async () => {
        const plan = await createTestPlan({ stripePriceId: null as any });
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/stripe price id/i);
    });

    it('returns 403 SANCTIONED_GEO_BLOCK for sanctioned country', async () => {
        const sanctionedApp = fastify({ logger: false });
        sanctionedApp.addHook('preHandler', async (request: any) => {
            request.user = { userId, facebookId: 'fb_test' };
            request.geo = { country: 'IR', region: null }; // Iran — sanctioned
        });
        const paymentRoutes = (await import('../../src/routes/payment')).default;
        sanctionedApp.register(paymentRoutes, { prefix: '/' });
        await sanctionedApp.ready();

        const plan = await createTestPlan();
        const res = await sanctionedApp.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id },
        });

        await sanctionedApp.close();
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('SANCTIONED_GEO_BLOCK');
    });

    it('calls stripeService and returns session URL for new user', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        const plan = await createTestPlan({ trialDays: 7 });

        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().clientSecret).toBe('cs_test_123_secret');
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'payer@test.com',
            plan.id,
            'price_test_123',
            expect.any(String), // returnUrl
            7, // trial days for new user
        );
    });

    it('passes 0 trial days when user already has an active subscription', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createCheckoutSession).mockClear();

        const plan = await createTestPlan({ trialDays: 7 });
        // User already has an active sub
        await createTestSubscription(userId, plan.id, { status: 'active' });

        const newPlan = await createTestPlan({ slug: `upgraded-${Date.now()}`, trialDays: 7 });
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: newPlan.id },
        });

        expect(res.statusCode).toBe(200);
        // Existing subscriber — no trial
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'payer@test.com',
            newPlan.id,
            expect.any(String), // stripePriceId
            expect.any(String), // returnUrl
            0,
        );
    });
});

// ---------------------------------------------------------------------------

describe('Payment — getSubscriptionStatus', () => {
    let app: FastifyInstance;
    let userId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        app = await buildApp(userId);
    });

    afterEach(async () => { await app.close(); });

    it('returns 404 when user has no subscription', async () => {
        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(404);
    });

    it('returns subscription details when subscription exists', async () => {
        const plan = await createTestPlan();
        await createTestSubscription(userId, plan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_abc123',
        });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.status).toBe('active');
        expect(body.planId).toBe(plan.id);
        expect(body.planName).toBe('Test Plan');
        expect(body.cancelAtPeriodEnd).toBe(false);
    });

    it('returns trialing status correctly', async () => {
        const plan = await createTestPlan();
        const trialEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        await createTestSubscription(userId, plan.id, {
            status: 'trialing',
            trialEndsAt: trialEnd,
        });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('trialing');
    });
});

// ---------------------------------------------------------------------------

describe('Payment — cancelSubscription', () => {
    let app: FastifyInstance;
    let userId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        app = await buildApp(userId);
    });

    afterEach(async () => { await app.close(); });

    it('returns 404 when user has no subscription', async () => {
        const res = await app.inject({ method: 'POST', url: '/cancel-subscription' });
        expect(res.statusCode).toBe(404);
    });

    it('sets cancelAtPeriodEnd=true in DB and calls Stripe', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.cancelSubscription).mockClear();

        const plan = await createTestPlan();
        const sub = await createTestSubscription(userId, plan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_to_cancel',
        });

        const res = await app.inject({ method: 'POST', url: '/cancel-subscription' });
        expect(res.statusCode).toBe(200);

        // DB should be updated
        const [updated] = await testDb
            .select({ cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));

        expect(updated.cancelAtPeriodEnd).toBe(true);
        expect(stripeService.cancelSubscription).toHaveBeenCalledWith('sub_to_cancel');
    });
});

// ---------------------------------------------------------------------------

describe('Payment — webhook DB mutations', () => {
    let userId: string;
    let planId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        const plan = await createTestPlan();
        planId = plan.id;
    });

    it('handleSubscriptionUpdated — updates status and period dates in DB', async () => {
        const sub = await createTestSubscription(userId, planId, {
            status: 'trialing',
            externalSubscriptionId: 'sub_upd_test',
        });

        const newPeriodStart = new Date('2026-03-01');
        const newPeriodEnd = new Date('2026-04-01');

        // Call the controller method directly (simulates Stripe webhook)
        const { paymentController } = await import('../../src/controllers/payment');
        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await (paymentController as any).handleSubscriptionUpdated(
            {
                id: 'sub_upd_test',
                status: 'active',
                current_period_start: Math.floor(newPeriodStart.getTime() / 1000),
                current_period_end: Math.floor(newPeriodEnd.getTime() / 1000),
                cancel_at_period_end: false,
            },
            mockRequest,
        );

        const [updated] = await testDb
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));

        expect(updated.status).toBe('active');
        expect(updated.currentPeriodStart?.toISOString().slice(0, 10)).toBe('2026-03-01');
        expect(updated.currentPeriodEnd?.toISOString().slice(0, 10)).toBe('2026-04-01');
        expect(updated.cancelAtPeriodEnd).toBe(false);
    });

    it('handleSubscriptionDeleted — marks subscription as canceled in DB', async () => {
        const sub = await createTestSubscription(userId, planId, {
            status: 'active',
            externalSubscriptionId: 'sub_del_test',
        });

        const { paymentController } = await import('../../src/controllers/payment');
        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await (paymentController as any).handleSubscriptionDeleted(
            { id: 'sub_del_test' },
            mockRequest,
        );

        const [updated] = await testDb
            .select({ status: schema.subscriptions.status, canceledAt: schema.subscriptions.canceledAt })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));

        expect(updated.status).toBe('canceled');
        expect(updated.canceledAt).not.toBeNull();
    });

    it('handlePaymentSucceeded — activates a past_due subscription', async () => {
        const sub = await createTestSubscription(userId, planId, {
            status: 'past_due',
            externalSubscriptionId: 'sub_pay_ok',
        });

        const { paymentController } = await import('../../src/controllers/payment');
        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await (paymentController as any).handlePaymentSucceeded(
            { id: 'in_test_123', subscription: 'sub_pay_ok' },
            mockRequest,
        );

        const [updated] = await testDb
            .select({ status: schema.subscriptions.status })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));

        expect(updated.status).toBe('active');
    });

    it('handlePaymentFailed — marks subscription as past_due and notifies user', async () => {
        const { notificationService } = await import('../../src/services/notifications');
        vi.mocked(notificationService.sendTemplateNotification).mockClear();

        const sub = await createTestSubscription(userId, planId, {
            status: 'active',
            externalSubscriptionId: 'sub_pay_fail',
        });

        const { paymentController } = await import('../../src/controllers/payment');
        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await (paymentController as any).handlePaymentFailed(
            { id: 'in_fail_123', subscription: 'sub_pay_fail' },
            mockRequest,
        );

        const [updated] = await testDb
            .select({ status: schema.subscriptions.status })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));

        expect(updated.status).toBe('past_due');
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
            userId,
            'payment_failed',
            {},
            expect.any(Object),
        );
    });

    it('handleCheckoutComplete — creates new subscription and cancels old one', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        // User has an existing active subscription
        const oldSub = await createTestSubscription(userId, planId, {
            status: 'active',
            externalSubscriptionId: 'sub_old_123',
        });

        const newPlan = await createTestPlan({ slug: `new-plan-${Date.now()}` });

        const { paymentController } = await import('../../src/controllers/payment');
        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await (paymentController as any).handleCheckoutComplete(
            {
                id: 'cs_new_123',
                client_reference_id: userId,
                metadata: { planId: newPlan.id },
                subscription: 'sub_new_456',
            },
            mockRequest,
        );

        // Old subscription should be canceled in DB
        const [oldUpdated] = await testDb
            .select({ status: schema.subscriptions.status })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, oldSub.id));

        expect(oldUpdated.status).toBe('canceled');

        // Old Stripe subscription should be canceled
        expect(stripeService.cancelSubscriptionImmediately).toHaveBeenCalledWith('sub_old_123');

        // New subscription should be created in DB
        const newSubs = await testDb
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.externalSubscriptionId, 'sub_new_456'));

        expect(newSubs).toHaveLength(1);
        expect(newSubs[0].planId).toBe(newPlan.id);
        expect(newSubs[0].userId).toBe(userId);
    });
});
