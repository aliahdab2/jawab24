import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import {
    handleCheckoutComplete,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handlePaymentSucceeded,
    handlePaymentFailed,
} from '../../src/controllers/paymentWebhookHandlers';

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
        createHostedCheckoutSession: vi.fn().mockResolvedValue({
            sessionId: 'cs_hosted_123',
            url: 'https://checkout.stripe.com/c/pay/cs_hosted_123',
        }),
        findOrCreateCustomer: vi.fn().mockResolvedValue('cus_test_123'),
        createSubscriptionIntent: vi.fn().mockResolvedValue({
            clientSecret: 'seti_test_secret',
            type: 'setup',
            subscriptionId: 'sub_intent_123',
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
        updateSubscriptionPrice: vi.fn().mockResolvedValue({
            id: 'sub_test_123',
            status: 'active',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            cancel_at_period_end: false,
        }),
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

    // Yearly guard — a "year" checkout must never silently bill the monthly
    // price. The pre-2026-08-15 bug: the UI promised an annual total with
    // ~17% off while Stripe subscribed the merchant at the monthly price,
    // because the controller fell back to stripePriceId when
    // stripeYearlyPriceId was missing.
    it('returns 400 YEARLY_NOT_AVAILABLE when yearly is requested but the plan has no yearly Stripe price', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createCheckoutSession).mockClear();

        const plan = await createTestPlan(); // stripeYearlyPriceId: null
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id, billingInterval: 'year' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('YEARLY_NOT_AVAILABLE');
        // Refusal must happen before any billable Stripe call
        expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('bills the YEARLY price id when yearly is requested and configured', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createCheckoutSession).mockClear();

        const plan = await createTestPlan({
            stripePriceId: 'price_monthly_123',
            stripeYearlyPriceId: 'price_yearly_456',
        });
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id, billingInterval: 'year' },
        });

        expect(res.statusCode).toBe(200);
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'payer@test.com',
            plan.id,
            'price_yearly_456', // the yearly price — NOT price_monthly_123
            expect.any(String),
            expect.any(Number),
        );
    });

    it('create-subscription-intent also refuses yearly without a yearly Stripe price', async () => {
        const plan = await createTestPlan();
        const res = await app.inject({
            method: 'POST',
            url: '/create-subscription-intent',
            payload: { planId: plan.id, billingInterval: 'year' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('YEARLY_NOT_AVAILABLE');
    });

    it('create-subscription-intent bills the YEARLY price id when configured (PaymentElement path)', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createSubscriptionIntent).mockClear();

        const plan = await createTestPlan({
            stripePriceId: 'price_monthly_pe',
            stripeYearlyPriceId: 'price_yearly_pe',
        });
        const res = await app.inject({
            method: 'POST',
            url: '/create-subscription-intent',
            payload: { planId: plan.id, billingInterval: 'year' },
        });

        expect(res.statusCode).toBe(200);
        expect(stripeService.createSubscriptionIntent).toHaveBeenCalledWith(
            expect.objectContaining({ priceId: 'price_yearly_pe' }),
        );
    });

    it('uiMode: hosted refuses yearly without a yearly Stripe price (same guard, hosted surface)', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createHostedCheckoutSession).mockClear();

        const plan = await createTestPlan();
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id, billingInterval: 'year', uiMode: 'hosted' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('YEARLY_NOT_AVAILABLE');
        expect(stripeService.createHostedCheckoutSession).not.toHaveBeenCalled();
    });

    it('uiMode: hosted bills the YEARLY price id when configured (the native-app path)', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createHostedCheckoutSession).mockClear();

        const plan = await createTestPlan({
            stripePriceId: 'price_monthly_h',
            stripeYearlyPriceId: 'price_yearly_h',
        });
        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id, billingInterval: 'year', uiMode: 'hosted' },
        });

        expect(res.statusCode).toBe(200);
        expect(stripeService.createHostedCheckoutSession).toHaveBeenCalledWith(
            userId,
            'payer@test.com',
            plan.id,
            'price_yearly_h', // the yearly price — NOT price_monthly_h
            expect.any(String),
            expect.any(String),
            expect.any(Number),
        );
    });

    // Hosted mode (D-040): the native-app flow and the web fallback. Same
    // route, same guards — different Stripe surface.
    it('uiMode: hosted returns the checkout.stripe.com redirect URL', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        const plan = await createTestPlan();

        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id, uiMode: 'hosted' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            sessionId: 'cs_hosted_123',
            url: 'https://checkout.stripe.com/c/pay/cs_hosted_123',
        });
        expect(stripeService.createHostedCheckoutSession).toHaveBeenCalledWith(
            userId,
            'payer@test.com',
            plan.id,
            expect.any(String),
            expect.stringContaining('hosted=1'),
            expect.stringContaining('/pricing'),
            expect.any(Number),
        );
    });

    it('uiMode: hosted still enforces the sanctions guard', async () => {
        // This file has no global mock reset; drop the call recorded by the
        // happy-path test above so the not-called assertion is meaningful.
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createHostedCheckoutSession).mockClear();

        const sanctionedApp = fastify({ logger: false });
        sanctionedApp.addHook('preHandler', async (request: any) => {
            request.user = { userId, facebookId: 'fb_test' };
            request.geo = { country: 'SY', region: null };
        });
        const paymentRoutes = (await import('../../src/routes/payment')).default;
        sanctionedApp.register(paymentRoutes, { prefix: '/' });
        await sanctionedApp.ready();

        const plan = await createTestPlan();
        const res = await sanctionedApp.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id, uiMode: 'hosted' },
        });

        await sanctionedApp.close();
        expect(res.statusCode).toBe(403);
        expect(stripeService.createHostedCheckoutSession).not.toHaveBeenCalled();
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

describe('Payment — changePlan sanctions guard', () => {
    let userId: string;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'changeplan@test.com' });
        userId = user.id;
    });

    /** Build an app whose preHandler sets a specific geo. Mirrors the shape geoMiddleware produces. */
    async function buildAppWithGeo(
        geo: { country?: string; region?: string | null; source?: string },
    ): Promise<FastifyInstance> {
        const app = fastify({ logger: false });
        app.addHook('preHandler', async (request: any) => {
            request.user = { userId, facebookId: 'fb_test' };
            request.geo = geo;
        });
        const paymentRoutes = (await import('../../src/routes/payment')).default;
        app.register(paymentRoutes, { prefix: '/' });
        await app.ready();
        return app;
    }

    it('returns 403 SANCTIONED_GEO_BLOCK for a sanctioned country before any Stripe call', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.updateSubscriptionPrice).mockClear();

        const app = await buildAppWithGeo({ country: 'IR', region: null }); // Iran — sanctioned
        const plan = await createTestPlan();
        await createTestSubscription(userId, plan.id, { externalSubscriptionId: 'sub_block_me' });

        // Target a different plan so the request would otherwise reach the billable Stripe call
        const otherPlan = await createTestPlan({ slug: `other-${Date.now()}` });
        const res = await app.inject({
            method: 'POST',
            url: '/change-plan',
            payload: { planId: otherPlan.id },
        });

        await app.close();
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('SANCTIONED_GEO_BLOCK');
        // The guard must fire before the billable Stripe operation
        expect(stripeService.updateSubscriptionPrice).not.toHaveBeenCalled();
    });

    it('returns 403 GEO_VERIFICATION_REQUIRED when geo is unresolved (fail-closed)', async () => {
        // The exact shape geoMiddleware sets when neither trusted header nor IP lookup resolves.
        const app = await buildAppWithGeo({ country: undefined, region: undefined, source: 'unknown' });
        const plan = await createTestPlan({ slug: `unknown-geo-${Date.now()}` });

        const res = await app.inject({
            method: 'POST',
            url: '/change-plan',
            payload: { planId: plan.id },
        });

        await app.close();
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('GEO_VERIFICATION_REQUIRED');
    });

    it('allows a plan change from a non-sanctioned country (guard does not over-block)', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.updateSubscriptionPrice).mockClear();

        const app = await buildAppWithGeo({ country: 'US', region: null, source: 'geoip-lite' });
        const currentPlan = await createTestPlan({ slug: `current-${Date.now()}` });
        await createTestSubscription(userId, currentPlan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_allow_me',
        });
        const targetPlan = await createTestPlan({ slug: `target-${Date.now()}`, stripePriceId: 'price_target_999' });

        const res = await app.inject({
            method: 'POST',
            url: '/change-plan',
            payload: { planId: targetPlan.id },
        });

        await app.close();
        expect(res.statusCode).toBe(200);
        expect(res.json().success).toBe(true);
        // The billable Stripe operation runs for a legitimate request
        expect(stripeService.updateSubscriptionPrice).toHaveBeenCalledWith('sub_allow_me', 'price_target_999');
    });

    /**
     * changePlan writes the local mirror directly, so it is a writer of
     * `current_period_end` in its own right — and until 2026-08-18 an ungated
     * one. Its comment justified the mirror by saying the subscription.updated
     * webhook would re-write the fields; that write was removed when
     * payment_succeeded became the only writer of paid-through, leaving this
     * the authoritative one.
     *
     * Stripe reports the proration period as soon as the invoice is CREATED —
     * before it is paid, and while the subscription still reads `active` — so
     * this endpoint cannot tell a paid boundary from an unpaid one either.
     */
    it('does not move the paid-through boundary on a plan change', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        const app = await buildAppWithGeo({ country: 'US', region: null, source: 'geoip-lite' });
        const currentPlan = await createTestPlan({ slug: `cur-period-${Date.now()}` });
        const paidThrough = new Date(Date.now() + 5 * 24 * 3600 * 1000);
        const sub = await createTestSubscription(userId, currentPlan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_period_guard',
            currentPeriodEnd: paidThrough,
        });
        const targetPlan = await createTestPlan({ slug: `tgt-period-${Date.now()}`, stripePriceId: 'price_period_guard' });

        // Stripe answers with a period three months out, unpaid.
        vi.mocked(stripeService.updateSubscriptionPrice).mockResolvedValue({
            id: 'sub_period_guard',
            status: 'active',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
            cancel_at_period_end: false,
        } as never);

        const res = await app.inject({ method: 'POST', url: '/change-plan', payload: { planId: targetPlan.id } });
        await app.close();

        expect(res.statusCode).toBe(200);
        const [after] = await testDb
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));
        expect(after.currentPeriodEnd?.toISOString()).toBe(paidThrough.toISOString());
        expect(after.planId).toBe(targetPlan.id); // the plan DOES change
    });

    /**
     * The status was mirrored raw here. `incomplete` is reachable when the
     * proration invoice needs SCA, and it is not one of our five values: raw,
     * it used to entitle silently, and since the CHECK constraint in 0173 it
     * would fail the write and 500 this endpoint instead.
     */
    it('does not write a raw Stripe status a plan change cannot represent', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        const app = await buildAppWithGeo({ country: 'US', region: null, source: 'geoip-lite' });
        const currentPlan = await createTestPlan({ slug: `cur-sca-${Date.now()}` });
        const sub = await createTestSubscription(userId, currentPlan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_sca_guard',
        });
        const targetPlan = await createTestPlan({ slug: `tgt-sca-${Date.now()}`, stripePriceId: 'price_sca_guard' });

        vi.mocked(stripeService.updateSubscriptionPrice).mockResolvedValue({
            id: 'sub_sca_guard',
            status: 'incomplete',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
            cancel_at_period_end: false,
        } as never);

        const res = await app.inject({ method: 'POST', url: '/change-plan', payload: { planId: targetPlan.id } });
        await app.close();

        // No 500 from the CHECK constraint, and no unrepresentable status stored.
        expect(res.statusCode).toBe(200);
        const [after] = await testDb
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));
        expect(['trialing', 'active', 'past_due', 'canceled', 'paused']).toContain(after.status);
        expect(after.status).toBe('active'); // preserved, not downgraded on a status we cannot map
    });

    it('moves the subscription onto the YEARLY price when the target plan has one', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.updateSubscriptionPrice).mockClear();

        const app = await buildAppWithGeo({ country: 'US', region: null, source: 'geoip-lite' });
        const currentPlan = await createTestPlan({ slug: `yr-ok-current-${Date.now()}` });
        await createTestSubscription(userId, currentPlan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_go_yearly',
        });
        const targetPlan = await createTestPlan({
            slug: `yr-ok-target-${Date.now()}`,
            stripePriceId: 'price_target_monthly',
            stripeYearlyPriceId: 'price_target_yearly',
        });

        const res = await app.inject({
            method: 'POST',
            url: '/change-plan',
            payload: { planId: targetPlan.id, billingInterval: 'year' },
        });

        await app.close();
        expect(res.statusCode).toBe(200);
        expect(stripeService.updateSubscriptionPrice).toHaveBeenCalledWith('sub_go_yearly', 'price_target_yearly');
    });

    it('returns 400 YEARLY_NOT_AVAILABLE for a yearly change to a plan with no yearly Stripe price', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.updateSubscriptionPrice).mockClear();

        const app = await buildAppWithGeo({ country: 'US', region: null, source: 'geoip-lite' });
        const currentPlan = await createTestPlan({ slug: `yr-current-${Date.now()}` });
        await createTestSubscription(userId, currentPlan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_yearly_guard',
        });
        const targetPlan = await createTestPlan({ slug: `yr-target-${Date.now()}` }); // no yearly price id

        const res = await app.inject({
            method: 'POST',
            url: '/change-plan',
            payload: { planId: targetPlan.id, billingInterval: 'year' },
        });

        await app.close();
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('YEARLY_NOT_AVAILABLE');
        // The subscription must NOT be moved onto the monthly price
        expect(stripeService.updateSubscriptionPrice).not.toHaveBeenCalled();
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

    it('handleSubscriptionUpdated — updates status, and leaves the period to payment_succeeded', async () => {
        const sub = await createTestSubscription(userId, planId, {
            status: 'trialing',
            externalSubscriptionId: 'sub_upd_test',
        });

        const newPeriodStart = new Date('2026-03-01');
        const newPeriodEnd = new Date('2026-04-01');

        // Call the controller method directly (simulates Stripe webhook)
        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await handleSubscriptionUpdated(
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
        // The period is deliberately NOT mirrored here, not even on `active`.
        // During a failed renewal Stripe advances the period on an event whose
        // status is still `active` (it creates the invoice first and degrades
        // the status ~an hour later), so this handler cannot tell a paid
        // advance from an unpaid one. `invoice.payment_succeeded` owns the
        // column; the seeded values must survive untouched.
        expect(updated.currentPeriodStart?.toISOString().slice(0, 10))
            .toBe(sub.currentPeriodStart?.toISOString().slice(0, 10));
        expect(updated.currentPeriodEnd?.toISOString().slice(0, 10))
            .toBe(sub.currentPeriodEnd?.toISOString().slice(0, 10));
        expect(updated.cancelAtPeriodEnd).toBe(false);
    });

    // Once yearly Stripe prices exist, subscription.updated events carry the
    // YEARLY price id. The plan lookup matches stripe_yearly_price_id too —
    // without it, every yearly subscription would log "No matching plan for
    // Stripe price" and the local planId would go stale on plan switches.
    it('handleSubscriptionUpdated — resolves the plan from a YEARLY Stripe price id', async () => {
        // Unique per run: `plans` rows persist across tests/runs (reference
        // data, not truncated), and this test does a REVERSE lookup by price
        // id — a fixed id would match a stale row from an earlier run.
        const yearlyPriceId = `price_yy_${Date.now()}`;
        const yearlyPlan = await createTestPlan({
            slug: `yearly-target-${Date.now()}`,
            stripePriceId: `price_ym_${Date.now()}`,
            stripeYearlyPriceId: yearlyPriceId,
        });
        const sub = await createTestSubscription(userId, planId, {
            status: 'active',
            externalSubscriptionId: 'sub_yearly_switch',
        });

        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await handleSubscriptionUpdated(
            {
                id: 'sub_yearly_switch',
                status: 'active',
                items: { data: [{ price: { id: yearlyPriceId } }] },
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
                cancel_at_period_end: false,
            },
            mockRequest,
        );

        const [updated] = await testDb
            .select({ planId: schema.subscriptions.planId })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, sub.id));

        // The subscription now mirrors the plan whose YEARLY price was billed
        expect(updated.planId).toBe(yearlyPlan.id);
        expect(mockRequest.log.warn).not.toHaveBeenCalledWith(
            expect.anything(),
            'No matching plan for Stripe price',
        );
    });

    it('handleSubscriptionDeleted — marks subscription as canceled in DB', async () => {
        const sub = await createTestSubscription(userId, planId, {
            status: 'active',
            externalSubscriptionId: 'sub_del_test',
        });

        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await handleSubscriptionDeleted(
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

        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await handlePaymentSucceeded(
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

        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await handlePaymentFailed(
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

        const mockRequest = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;

        await handleCheckoutComplete(
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
