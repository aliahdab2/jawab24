/**
 * Payment Lifecycle Integration Tests
 *
 * Tests the complete customer journey through payment and subscription management.
 * Covers: first purchase, upgrade, downgrade, cancellation, resubscription,
 * payment failure/recovery, race conditions, and billing portal.
 *
 * All Stripe API calls are mocked. All DB operations use the real test database.
 *
 * SCENARIO 1  — New customer first purchase (with trial)
 * SCENARIO 2  — Upgrade Basic → Pro
 * SCENARIO 3  — Downgrade Pro → Basic
 * SCENARIO 4  — Cancel subscription (at period end)
 * SCENARIO 5  — Cancel then resubscribe to a new plan
 * SCENARIO 6  — Payment failure and recovery
 * SCENARIO 7  — Race condition: payment_succeeded before checkout.session.completed
 * SCENARIO 8  — Upgrade while on trial period
 * SCENARIO 9  — Subscription status endpoint accuracy across full lifecycle
 * SCENARIO 10 — Billing portal access
 * SCENARIO 11 — customer.subscription.created backup handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import {
    handleCheckoutComplete,
    handleSubscriptionCreated,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handlePaymentSucceeded,
    handlePaymentFailed,
} from '../../src/controllers/paymentWebhookHandlers';

// Ensures DATABASE_URL points to the test database before any app module loads.
import './setup';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks (hoisted by Vitest — must be at module top level)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        createCheckoutSession: vi.fn().mockResolvedValue({
            id: 'cs_lifecycle_default',
            client_secret: 'cs_lifecycle_default_secret',
        }),
        // Configured per-scenario via mockResolvedValue in beforeEach
        getSubscription: vi.fn(),
        cancelSubscription: vi.fn().mockResolvedValue({}),
        cancelSubscriptionImmediately: vi.fn().mockResolvedValue({}),
        createBillingPortalSession: vi.fn().mockResolvedValue({
            url: 'https://billing.stripe.com/session/lifecycle',
        }),
        verifyWebhookSignature: vi.fn(),
    },
    stripe: null,
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn().mockImplementation(async () => {}),
    requireAdmin: vi.fn().mockImplementation(async () => {}),
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
    },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NOW_SECS = Math.floor(Date.now() / 1000);
const ONE_MONTH_SECS = 30 * 24 * 3600;
const ONE_WEEK_SECS = 7 * 24 * 3600;
const ONE_MONTH_MS = ONE_MONTH_SECS * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Unique string suffix to avoid slug/ID collisions between parallel test runs */
function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert a plan into the test database */
async function createPlan(overrides: Partial<typeof schema.plans.$inferInsert> = {}) {
    const [plan] = await testDb
        .insert(schema.plans)
        .values({
            name: 'Test Plan',
            slug: `plan-${uid()}`,
            price: 1900,
            stripePriceId: `price_${uid()}`,
            trialDays: 0,
            maxAiRepliesPerMonth: 200,
            maxTemplates: 5,
            maxRules: 3,
            isActive: true,
            ...overrides,
        })
        .returning();
    return plan;
}

/**
 * Insert a subscription into the test database.
 * Overrides are spread last so explicit null values (e.g. stripeCustomerId: null) take effect.
 */
async function createSub(
    userId: string,
    planId: string,
    overrides: Partial<typeof schema.subscriptions.$inferInsert> = {},
) {
    const [sub] = await testDb
        .insert(schema.subscriptions)
        .values({
            userId,
            planId,
            status: 'active',
            externalSubscriptionId: `sub_${uid()}`,
            stripeCustomerId: `cus_${uid()}`,
            paymentMethod: 'stripe',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + ONE_MONTH_MS),
            cancelAtPeriodEnd: false,
            ...overrides,
        })
        .returning();
    return sub;
}

/** Build a minimal Fastify app with payment routes and auth bypassed */
async function buildApp(
    userId: string,
    geo: { country: string; region: string | null } = { country: 'US', region: null },
): Promise<FastifyInstance> {
    const app = fastify({ logger: false });

    app.addHook('preHandler', async (request: any) => {
        request.user = { userId, facebookId: 'fb_lifecycle_test' };
        request.geo = geo;
    });

    const paymentRoutes = (await import('../../src/routes/payment')).default;
    app.register(paymentRoutes, { prefix: '/' });
    await app.ready();
    return app;
}

/** Minimal request mock for direct controller method calls */
function mockReq() {
    return { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;
}

/** Build a minimal fake Stripe Subscription object */
function stripeSubObj(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        status: 'active',
        customer: 'cus_stripe_lifecycle',
        current_period_start: NOW_SECS,
        current_period_end: NOW_SECS + ONE_MONTH_SECS,
        trial_end: null,
        cancel_at_period_end: false,
        ...overrides,
    };
}

/** Build a minimal fake Stripe CheckoutSession object */
function stripeSession(
    userId: string,
    planId: string,
    subscriptionId: string,
    sessionId = `cs_${uid()}`,
) {
    return {
        id: sessionId,
        client_reference_id: userId,
        metadata: { planId },
        subscription: subscriptionId,
    };
}

/** Fetch all subscriptions for a user */
async function userSubs(userId: string) {
    return testDb
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, userId));
}

/** Fetch a single subscription by primary key */
async function getSub(id: string) {
    const [sub] = await testDb
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.id, id));
    return sub;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — New customer completes first purchase (with trial)
//
// Flow: no sub → checkout (gets trial days) → webhook creates trialing sub
//       → invoice.payment_succeeded activates it
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 1 — New customer completes first purchase (with trial)', () => {
    let app: FastifyInstance;
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'new.customer@example.com' });
        userId = user.id;
        plan = await createPlan({ name: 'Starter', trialDays: 7, price: 2900 });
        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_new_001', {
                status: 'trialing',
                trial_end: NOW_SECS + ONE_WEEK_SECS,
            }) as any,
        );
        vi.mocked(stripeService.createCheckoutSession).mockClear();
    });

    afterEach(async () => { await app.close(); });

    it('STEP 1 — user has no subscription initially', async () => {
        const subs = await userSubs(userId);
        expect(subs).toHaveLength(0);
    });

    it('STEP 2 — checkout session is created with trial days for a brand-new user', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: plan.id },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().clientSecret).toBeDefined();
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'new.customer@example.com',
            plan.id,
            expect.any(String), // stripePriceId
            expect.any(String), // returnUrl
            7,                  // trial days — plan.trialDays for new user
        );
    });

    it('STEP 3 — checkout.session.completed creates a trialing subscription in DB', async () => {
        await handleCheckoutComplete(
            stripeSession(userId, plan.id, 'sub_new_001'),
            mockReq(),
        );

        const subs = await userSubs(userId);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBe('sub_new_001');
        expect(subs[0].status).toBe('trialing');
        expect(subs[0].planId).toBe(plan.id);
        expect(subs[0].userId).toBe(userId);
        expect(subs[0].paymentMethod).toBe('stripe');
        expect(subs[0].stripeCustomerId).toBe('cus_stripe_lifecycle');
        expect(subs[0].trialEndsAt).not.toBeNull();
    });

    it('STEP 4 — subscription status endpoint returns trialing with trialEndsAt set', async () => {
        await createSub(userId, plan.id, {
            status: 'trialing',
            trialEndsAt: new Date(Date.now() + ONE_WEEK_SECS * 1000),
        });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.status).toBe('trialing');
        expect(body.planId).toBe(plan.id);
        expect(body.trialEndsAt).not.toBeNull();
        expect(body.cancelAtPeriodEnd).toBe(false);
    });

    it('STEP 5 — invoice.payment_succeeded activates the trialing subscription', async () => {
        const sub = await createSub(userId, plan.id, {
            status: 'trialing',
            externalSubscriptionId: 'sub_new_001',
        });

        await handlePaymentSucceeded(
            { id: 'in_first_001', subscription: 'sub_new_001' },
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('active');
    });

    it('STEP 6 — status endpoint returns active after payment succeeds', async () => {
        await createSub(userId, plan.id, { status: 'active' });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('active');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — Customer upgrades from Basic to Pro
//
// Flow: active Basic sub → checkout Pro (no trial) → webhook cancels Basic,
//       creates Pro → only one active sub remains
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 2 — Customer upgrades from Basic to Pro', () => {
    let app: FastifyInstance;
    let userId: string;
    let basicPlan: typeof schema.plans.$inferSelect;
    let proPlan: typeof schema.plans.$inferSelect;
    let oldSub: typeof schema.subscriptions.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'upgrader@example.com' });
        userId = user.id;
        basicPlan = await createPlan({ name: 'Basic', price: 1900, trialDays: 0 });
        proPlan   = await createPlan({ name: 'Pro',   price: 4900, trialDays: 0 });

        oldSub = await createSub(userId, basicPlan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_basic_001',
            stripeCustomerId: 'cus_upgrader',
        });

        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_pro_002', { status: 'active' }) as any,
        );
        vi.mocked(stripeService.createCheckoutSession).mockClear();
        vi.mocked(stripeService.cancelSubscriptionImmediately).mockClear();
    });

    afterEach(async () => { await app.close(); });

    it('STEP 1 — user starts with one active Basic subscription', async () => {
        const active = (await userSubs(userId)).filter(s => s.status === 'active');
        expect(active).toHaveLength(1);
        expect(active[0].planId).toBe(basicPlan.id);
    });

    it('STEP 2 — checkout session for Pro has 0 trial days (existing subscriber)', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: proPlan.id },
        });

        expect(res.statusCode).toBe(200);
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'upgrader@example.com',
            proPlan.id,
            expect.any(String), // stripePriceId
            expect.any(String), // returnUrl
            0, // no trial for existing subscriber
        );
    });

    it('STEP 3 — checkout.session.completed cancels Basic sub and creates Pro sub', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        await handleCheckoutComplete(
            stripeSession(userId, proPlan.id, 'sub_pro_002'),
            mockReq(),
        );

        // Old Basic sub: canceled in DB
        const canceledBasic = await getSub(oldSub.id);
        expect(canceledBasic.status).toBe('canceled');
        expect(canceledBasic.canceledAt).not.toBeNull();
        expect(canceledBasic.cancelReason).toMatch(/replaced/i);

        // Old Stripe sub: immediately canceled
        expect(stripeService.cancelSubscriptionImmediately).toHaveBeenCalledWith('sub_basic_001');
        expect(stripeService.cancelSubscriptionImmediately).toHaveBeenCalledTimes(1);

        // New Pro sub: present and active
        const proSub = (await userSubs(userId)).find(
            s => s.externalSubscriptionId === 'sub_pro_002',
        );
        expect(proSub).toBeDefined();
        expect(proSub!.planId).toBe(proPlan.id);
        expect(proSub!.status).toBe('active');
    });

    it('STEP 4 — only one active subscription exists after upgrade', async () => {
        await handleCheckoutComplete(
            stripeSession(userId, proPlan.id, 'sub_pro_002'),
            mockReq(),
        );

        const activeSubs = (await userSubs(userId)).filter(s => s.status === 'active');
        expect(activeSubs).toHaveLength(1);
        expect(activeSubs[0].planId).toBe(proPlan.id);
    });

    it('STEP 5 — status endpoint shows Pro plan and name after upgrade', async () => {
        await handleCheckoutComplete(
            stripeSession(userId, proPlan.id, 'sub_pro_002'),
            mockReq(),
        );

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().planId).toBe(proPlan.id);
        expect(res.json().planName).toBe('Pro');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3 — Customer downgrades from Pro to Basic
//
// Flow: active Pro sub → checkout Basic (no trial) → webhook cancels Pro
//       immediately, creates Basic → only one active sub remains
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 3 — Customer downgrades from Pro to Basic', () => {
    let app: FastifyInstance;
    let userId: string;
    let basicPlan: typeof schema.plans.$inferSelect;
    let proPlan: typeof schema.plans.$inferSelect;
    let oldSub: typeof schema.subscriptions.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'downgrader@example.com' });
        userId = user.id;
        basicPlan = await createPlan({ name: 'Basic', price: 1900, trialDays: 0 });
        proPlan   = await createPlan({ name: 'Pro',   price: 4900, trialDays: 0 });

        oldSub = await createSub(userId, proPlan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_pro_001',
            stripeCustomerId: 'cus_downgrader',
        });

        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_basic_002', { status: 'active' }) as any,
        );
        vi.mocked(stripeService.createCheckoutSession).mockClear();
        vi.mocked(stripeService.cancelSubscriptionImmediately).mockClear();
    });

    afterEach(async () => { await app.close(); });

    it('STEP 1 — user starts on the Pro plan', async () => {
        const active = (await userSubs(userId)).filter(s => s.status === 'active');
        expect(active).toHaveLength(1);
        expect(active[0].planId).toBe(proPlan.id);
    });

    it('STEP 2 — checkout session for Basic has 0 trial days (existing subscriber)', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: basicPlan.id },
        });

        expect(res.statusCode).toBe(200);
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'downgrader@example.com',
            basicPlan.id,
            expect.any(String), // stripePriceId
            expect.any(String), // returnUrl
            0,
        );
    });

    it('STEP 3 — checkout.session.completed cancels Pro immediately and creates Basic', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        await handleCheckoutComplete(
            stripeSession(userId, basicPlan.id, 'sub_basic_002'),
            mockReq(),
        );

        const canceledPro = await getSub(oldSub.id);
        expect(canceledPro.status).toBe('canceled');
        expect(stripeService.cancelSubscriptionImmediately).toHaveBeenCalledWith('sub_pro_001');

        const basicSub = (await userSubs(userId)).find(
            s => s.externalSubscriptionId === 'sub_basic_002',
        );
        expect(basicSub).toBeDefined();
        expect(basicSub!.planId).toBe(basicPlan.id);
        expect(basicSub!.status).toBe('active');
    });

    it('STEP 4 — only one active subscription exists after downgrade', async () => {
        await handleCheckoutComplete(
            stripeSession(userId, basicPlan.id, 'sub_basic_002'),
            mockReq(),
        );

        const activeSubs = (await userSubs(userId)).filter(s => s.status === 'active');
        expect(activeSubs).toHaveLength(1);
        expect(activeSubs[0].planId).toBe(basicPlan.id);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4 — Customer cancels subscription (at period end)
//
// Flow: active sub → POST /cancel-subscription (sets cancelAtPeriodEnd)
//       → Stripe webhook updated → Stripe webhook deleted (period ends)
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 4 — Customer cancels subscription (at period end)', () => {
    let app: FastifyInstance;
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;
    let sub: typeof schema.subscriptions.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'canceler@example.com' });
        userId = user.id;
        plan = await createPlan({ name: 'Monthly Plan', price: 2900 });
        sub = await createSub(userId, plan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_cancel_001',
            stripeCustomerId: 'cus_canceler',
        });
        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.cancelSubscription).mockClear();
    });

    afterEach(async () => { await app.close(); });

    it('STEP 1 — user has one active subscription', async () => {
        const active = (await userSubs(userId)).filter(s => s.status === 'active');
        expect(active).toHaveLength(1);
    });

    it('STEP 2 — POST /cancel-subscription sets cancelAtPeriodEnd and calls Stripe', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const res = await app.inject({ method: 'POST', url: '/cancel-subscription' });

        expect(res.statusCode).toBe(200);
        expect(res.json().message).toMatch(/end of the billing period/i);

        const updated = await getSub(sub.id);
        expect(updated.cancelAtPeriodEnd).toBe(true);
        expect(updated.status).toBe('active'); // still active until period end

        // Stripe: cancel_at_period_end (not immediate)
        expect(stripeService.cancelSubscription).toHaveBeenCalledWith('sub_cancel_001');
        expect(stripeService.cancelSubscription).toHaveBeenCalledTimes(1);
    });

    it('STEP 3 — customer.subscription.updated webhook syncs cancelAtPeriodEnd=true', async () => {

        await handleSubscriptionUpdated(
            {
                id: 'sub_cancel_001',
                status: 'active',
                current_period_start: NOW_SECS,
                current_period_end: NOW_SECS + ONE_MONTH_SECS,
                cancel_at_period_end: true,
            },
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.cancelAtPeriodEnd).toBe(true);
        expect(updated.status).toBe('active');
    });

    it('STEP 4 — customer.subscription.deleted webhook marks subscription as canceled', async () => {

        await handleSubscriptionDeleted(
            { id: 'sub_cancel_001' },
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('canceled');
        expect(updated.canceledAt).not.toBeNull();
    });

    it('STEP 5 — status endpoint returns active+cancelAtPeriodEnd=true while period still runs', async () => {
        await testDb
            .update(schema.subscriptions)
            .set({ cancelAtPeriodEnd: true })
            .where(eq(schema.subscriptions.id, sub.id));

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('active');
        expect(res.json().cancelAtPeriodEnd).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5 — Customer cancels then resubscribes to a new plan
//
// Flow: only canceled sub exists → checkout new plan → webhook creates
//       new active sub → old canceled sub preserved as historical record
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 5 — Customer cancels then resubscribes to a new plan', () => {
    let app: FastifyInstance;
    let userId: string;
    let oldPlan: typeof schema.plans.$inferSelect;
    let newPlan: typeof schema.plans.$inferSelect;
    let canceledSub: typeof schema.subscriptions.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'resub@example.com' });
        userId = user.id;
        oldPlan = await createPlan({ name: 'Old Plan', price: 1900 });
        newPlan = await createPlan({ name: 'New Plan', price: 2900, trialDays: 0 });

        canceledSub = await createSub(userId, oldPlan.id, {
            status: 'canceled',
            externalSubscriptionId: 'sub_canceled_001',
            stripeCustomerId: 'cus_resub',
            canceledAt: new Date(Date.now() - 24 * 3600 * 1000),
        });

        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_resub_001', { status: 'active' }) as any,
        );
        vi.mocked(stripeService.createCheckoutSession).mockClear();
        vi.mocked(stripeService.cancelSubscriptionImmediately).mockClear();
    });

    afterEach(async () => { await app.close(); });

    it('STEP 1 — user only has a canceled subscription (no active)', async () => {
        const subs = await userSubs(userId);
        expect(subs).toHaveLength(1);
        expect(subs[0].status).toBe('canceled');
    });

    it('STEP 2 — checkout session created (no active sub to suppress trial)', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: newPlan.id },
        });

        expect(res.statusCode).toBe(200);
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'resub@example.com',
            newPlan.id,
            expect.any(String), // stripePriceId
            expect.any(String), // returnUrl
            0, // newPlan.trialDays = 0
        );
    });

    it('STEP 3 — checkout.session.completed creates new active subscription', async () => {

        await handleCheckoutComplete(
            stripeSession(userId, newPlan.id, 'sub_resub_001'),
            mockReq(),
        );

        const allSubs = await userSubs(userId);
        expect(allSubs).toHaveLength(2); // old canceled + new active

        const activeSubs = allSubs.filter(s => s.status === 'active');
        expect(activeSubs).toHaveLength(1);
        expect(activeSubs[0].planId).toBe(newPlan.id);
        expect(activeSubs[0].externalSubscriptionId).toBe('sub_resub_001');
    });

    it('STEP 4 — old canceled subscription is preserved as a historical record', async () => {

        await handleCheckoutComplete(
            stripeSession(userId, newPlan.id, 'sub_resub_001'),
            mockReq(),
        );

        const stillCanceled = await getSub(canceledSub.id);
        expect(stillCanceled.status).toBe('canceled');
    });

    it('STEP 5 — cancelSubscriptionImmediately NOT called (canceled sub skipped in loop)', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        await handleCheckoutComplete(
            stripeSession(userId, newPlan.id, 'sub_resub_001'),
            mockReq(),
        );

        expect(stripeService.cancelSubscriptionImmediately).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 6 — Payment failure and recovery
//
// Flow: active sub → invoice.payment_failed (past_due + notification)
//       → invoice.payment_succeeded (back to active)
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 6 — Payment failure and recovery', () => {
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;
    let sub: typeof schema.subscriptions.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'pastdue@example.com' });
        userId = user.id;
        plan = await createPlan({ name: 'Monthly', price: 2900 });
        sub = await createSub(userId, plan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_pastdue_001',
        });

        const { notificationService } = await import('../../src/services/notifications');
        vi.mocked(notificationService.sendTemplateNotification).mockClear();
    });

    it('STEP 1 — invoice.payment_failed sets subscription status to past_due', async () => {

        await handlePaymentFailed(
            { id: 'in_fail_001', subscription: 'sub_pastdue_001' },
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('past_due');
    });

    it('STEP 2 — payment failure sends exactly one push notification to the user', async () => {
        const { notificationService } = await import('../../src/services/notifications');

        await handlePaymentFailed(
            { id: 'in_fail_001', subscription: 'sub_pastdue_001' },
            mockReq(),
        );

        expect(notificationService.sendTemplateNotification).toHaveBeenCalledTimes(1);
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
            userId,
            'payment_failed',
            {},
            expect.objectContaining({ deepLink: '/settings' }),
        );
    });

    it('STEP 3 — invoice.payment_succeeded after failure restores subscription to active', async () => {
        await testDb
            .update(schema.subscriptions)
            .set({ status: 'past_due' })
            .where(eq(schema.subscriptions.id, sub.id));


        await handlePaymentSucceeded(
            { id: 'in_recovered_001', subscription: 'sub_pastdue_001' },
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('active');
    });

    it('STEP 4 — duplicate payment_failed handler call (isolation test, dedup enforced at handleWebhook level)', async () => {
        // Mark already past_due to simulate second delivery
        await testDb
            .update(schema.subscriptions)
            .set({ status: 'past_due' })
            .where(eq(schema.subscriptions.id, sub.id));

        const { notificationService } = await import('../../src/services/notifications');
        vi.mocked(notificationService.sendTemplateNotification).mockClear();

        await handlePaymentFailed(
            { id: 'in_fail_002', subscription: 'sub_pastdue_001' },
            mockReq(),
        );

        // Private handler is intentionally tested in isolation here.
        // Duplicate event protection is enforced at the handleWebhook dispatcher level
        // via stripe_webhook_events deduplication — see SCENARIO 12.
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledTimes(1);
    });

    it('FULL FLOW — active → past_due → active via two sequential webhooks', async () => {

        await handlePaymentFailed(
            { id: 'in_fail_full', subscription: 'sub_pastdue_001' },
            mockReq(),
        );
        expect((await getSub(sub.id)).status).toBe('past_due');

        await handlePaymentSucceeded(
            { id: 'in_ok_full', subscription: 'sub_pastdue_001' },
            mockReq(),
        );
        expect((await getSub(sub.id)).status).toBe('active');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 6b — A failed renewal must not buy a free month
//
// The Nourva defect (2026-08-13 → 08-18). Stripe keeps invoicing a subscription
// whose renewal failed, so `customer.subscription.updated` arrives carrying the
// NEXT period. Mirroring it moved `current_period_end` a month into the future;
// since the entitlement gate reads that column as "paid through", the 3-day
// grace landed a month late and the merchant kept full service for free.
//
// These assertions end at the READ PATH — `canAutoReply` is what the reply
// pipeline actually calls (messageProcessor.ts:272 → enforceAutoReplyGate).
// Asserting the stored row alone would only prove the write.
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 6b — Failed renewal does not advance the paid-through period', () => {
    const DAY_MS = 24 * 3600 * 1000;
    /** Paid period: ended 5 days ago, i.e. already past the 3-day grace. */
    const paidStart = new Date(Date.now() - 35 * DAY_MS);
    const paidEnd = new Date(Date.now() - 5 * DAY_MS);
    /** What Stripe sends after the renewal fails: the next, UNPAID period. */
    const unpaidPeriod = {
        current_period_start: Math.floor(paidEnd.getTime() / 1000),
        current_period_end: Math.floor((paidEnd.getTime() + 30 * DAY_MS) / 1000),
    };

    let userId: string;
    let sub: typeof schema.subscriptions.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: `freemonth-${uid()}@example.com` });
        userId = user.id;
        const plan = await createPlan({ name: 'Pro', price: 7900, maxAiRepliesPerMonth: 10000 });
        sub = await createSub(userId, plan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_freemonth_001',
            currentPeriodStart: paidStart,
            currentPeriodEnd: paidEnd,
        });
    });

    /**
     * THE regression, replayed from the live Stripe event log rather than from
     * a guess about it. The first version of this test asserted a `past_due`
     * event carrying an advanced period — a payload Stripe never sends — so it
     * passed against a defect that was still fully live.
     *
     * What actually arrives is a PAIR, and the period moves on the one whose
     * status is `active`:
     *
     *   19:41:52  status=active    period 07-13→08-13 becomes 08-13→09-13
     *   20:42:59  status=past_due  period unchanged, already 09-13
     *
     * Stripe advances the period when it CREATES the renewal invoice and only
     * degrades the status about an hour later, once the charge has failed.
     */
    it('ignores the period on BOTH events of a real failed renewal, including the active one', async () => {
        // 19:41:52 — Stripe creates the renewal invoice. Still active.
        await handleSubscriptionUpdated(
            stripeSubObj('sub_freemonth_001', { status: 'active', ...unpaidPeriod }) as never,
            mockReq(),
        );

        const afterAdvance = await getSub(sub.id);
        expect(afterAdvance.currentPeriodEnd?.getTime()).toBe(paidEnd.getTime());

        // 20:42:59 — the charge failed; only now does the status degrade.
        await handleSubscriptionUpdated(
            stripeSubObj('sub_freemonth_001', { status: 'past_due', ...unpaidPeriod }) as never,
            mockReq(),
        );

        const final = await getSub(sub.id);
        expect(final.status).toBe('past_due');
        expect(final.currentPeriodEnd?.getTime()).toBe(paidEnd.getTime());
    });

    it('keeps current_period_end at the last PAID boundary when the renewal fails', async () => {
        await handleSubscriptionUpdated(
            stripeSubObj('sub_freemonth_001', { status: 'past_due', ...unpaidPeriod }) as never,
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('past_due');
        expect(updated.currentPeriodEnd?.getTime()).toBe(paidEnd.getTime());
    });

    /**
     * THE regression. Before the fix this read `allowed: true` for another
     * month — the merchant kept every automation while owing us for the period.
     */
    it('blocks auto-replies at the real gate once the paid period + grace has lapsed', async () => {
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        await handleSubscriptionUpdated(
            stripeSubObj('sub_freemonth_001', { status: 'past_due', ...unpaidPeriod }) as never,
            mockReq(),
        );

        const gate = await subscriptionsService.canAutoReply(userId);
        expect(gate.allowed).toBe(false);
        expect(gate.code).toBe('subscription_inactive');
    });

    /**
     * Stripe writes `unpaid` when Smart Retries are exhausted under the
     * dashboard's "mark unpaid" setting. It is not one of our five statuses —
     * written raw it fell through every branch of checkSubscriptionStatus and
     * entitled the merchant permanently, with no CHECK constraint to stop it.
     */
    it('stores unpaid as past_due and still blocks — not as a raw value that entitles forever', async () => {
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        await handleSubscriptionUpdated(
            stripeSubObj('sub_freemonth_001', { status: 'unpaid', ...unpaidPeriod }) as never,
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('past_due');
        expect(await subscriptionsService.canAutoReply(userId)).toMatchObject({ allowed: false });
    });

    /**
     * The control, and it must exercise the path that ACTUALLY renews: money
     * landing, i.e. `invoice.payment_succeeded`. Without it, a fix that simply
     * stopped writing the period everywhere would pass every test above while
     * silently freezing every paying customer at their last boundary.
     *
     * The earlier version of this control asserted that handleSubscriptionUpdated
     * advances the period on `active` — which is exactly the assumption that let
     * the defect survive the first fix, since the event that advances the period
     * during a FAILED renewal is also `active`.
     */
    it('a paid renewal advances the period and restores entitlement — via payment_succeeded', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        const { subscriptionsService } = await import('../../src/services/subscriptions');
        const paidThrough = Math.floor((Date.now() + 25 * DAY_MS) / 1000);

        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_freemonth_001', {
                status: 'active',
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: paidThrough,
            }) as never,
        );

        await handlePaymentSucceeded(
            { id: 'in_renewed', subscription: 'sub_freemonth_001' } as never,
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('active');
        expect(updated.currentPeriodEnd?.getTime()).toBe(paidThrough * 1000);
        expect(await subscriptionsService.canAutoReply(userId)).toMatchObject({ allowed: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 6c — The other two writers of current_period_end
//
// Three code paths write that column from a Stripe payload. SCENARIO 6b covers
// handleSubscriptionUpdated; these cover the checkout insert and the
// payment-succeeded path, so the paid-through invariant holds at every writer
// rather than at the one where the defect was first found.
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 6c — checkout insert and payment_succeeded honour paid-through', () => {
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: `writers-${uid()}@example.com` });
        userId = user.id;
        plan = await createPlan({ name: 'Pro', price: 7900, maxAiRepliesPerMonth: 10000 });
    });

    /**
     * A checkout that completes while the first invoice has not settled must
     * not seed a period the merchant has not bought, and must not entitle.
     */
    /**
     * Every unpaid status, not just `incomplete`. Testing one of them is what
     * let an earlier revision ship an unbounded hole: the status was mapped
     * independently of the period, so `past_due` and `unpaid` produced
     * `past_due` + NULL period — and checkSubscriptionStatus applies its grace
     * only when there IS a period, falling through to allowed otherwise. That
     * fallback is itself pinned by subscriptions.test.ts, so the combination
     * was unbounded free service, worse than the defect being fixed.
     */
    it.each(['incomplete', 'past_due', 'unpaid', 'incomplete_expired'])(
        'checkout on a %s subscription inserts a row that blocks without depending on a date',
        async (stripeStatus) => {
            const { stripeService } = await import('../../src/services/stripe');
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(stripeService.getSubscription).mockResolvedValue(
                stripeSubObj(`sub_unpaid_${stripeStatus}`, { status: stripeStatus }) as never,
            );

            await handleCheckoutComplete(
                stripeSession(userId, plan.id, `sub_unpaid_${stripeStatus}`),
                mockReq(),
            );

            const [sub] = await userSubs(userId);
            expect(sub.currentPeriodEnd).toBeNull();
            // The status must deny on its own — never one whose denial needs a period.
            expect(sub.status).toBe('canceled');
            expect(await subscriptionsService.canAutoReply(userId)).toMatchObject({ allowed: false });
        },
    );

    /** The paid checkout — unchanged, and the reason the control matters. */
    it('checkout on a paid subscription inserts an entitled row with the period', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        const { subscriptionsService } = await import('../../src/services/subscriptions');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_paid_checkout', { status: 'active' }) as never,
        );

        await handleCheckoutComplete(stripeSession(userId, plan.id, 'sub_paid_checkout'), mockReq());

        const [sub] = await userSubs(userId);
        expect(sub.status).toBe('active');
        expect(sub.currentPeriodEnd).not.toBeNull();
        expect(await subscriptionsService.canAutoReply(userId)).toMatchObject({ allowed: true });
    });

    /**
     * An `unpaid` subscription holds several open invoices. Settling one fires
     * invoice.payment_succeeded while Stripe still considers the subscription
     * delinquent — and the handler used to answer that by forcing `active`,
     * mirroring the reported period and opening a fresh quota window.
     */
    it('a paid invoice on a still-unpaid subscription neither activates nor moves the period', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        const { subscriptionsService } = await import('../../src/services/subscriptions');

        const lapsed = new Date(Date.now() - 20 * 24 * 3600 * 1000);
        const sub = await createSub(userId, plan.id, {
            status: 'past_due',
            externalSubscriptionId: 'sub_partial_pay',
            currentPeriodStart: new Date(lapsed.getTime() - 30 * 24 * 3600 * 1000),
            currentPeriodEnd: lapsed,
        });

        // Stripe reports the subscription STILL unpaid, with a period months out.
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_partial_pay', {
                status: 'unpaid',
                current_period_start: Math.floor(Date.now() / 1000),
                current_period_end: Math.floor(Date.now() / 1000) + 3 * ONE_MONTH_SECS,
            }) as never,
        );

        await handlePaymentSucceeded(
            { id: 'in_partial', subscription: 'sub_partial_pay' } as never,
            mockReq(),
        );

        const after = await getSub(sub.id);
        expect(after.status).toBe('past_due');
        expect(after.currentPeriodEnd?.getTime()).toBe(lapsed.getTime());
        expect(await subscriptionsService.canAutoReply(userId)).toMatchObject({ allowed: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 7 — Race condition: payment_succeeded before checkout.session.completed
//
// Stripe can deliver webhooks out of order. Tests graceful handling and
// also documents the idempotency gap for duplicate events.
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 7 — Race condition: payment_succeeded before checkout.session.completed', () => {
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'race@example.com' });
        userId = user.id;
        plan = await createPlan({ name: 'Race Plan', price: 1900 });

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_race_001', { status: 'trialing' }) as any,
        );
    });

    it('payment_succeeded for unknown subscription does not throw — logs error after retries', async () => {
        const req = mockReq();

        // No subscription exists in DB yet
        await expect(
            handlePaymentSucceeded(
                { id: 'in_race_premature', subscription: 'sub_race_001' },
                req,
            ),
        ).resolves.not.toThrow();

        expect(req.log.error).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionId: 'sub_race_001' }),
            expect.stringMatching(/not found after retries/i),
        );
    }, 20_000); // allow for 3 × 500ms retry waits + slow DB/import

    it('correct order (checkout → payment) results in active subscription', async () => {

        // Step 1: checkout webhook arrives first
        await handleCheckoutComplete(
            stripeSession(userId, plan.id, 'sub_race_001'),
            mockReq(),
        );
        const subs = await userSubs(userId);
        expect(subs).toHaveLength(1);
        expect(subs[0].status).toBe('trialing');

        // Step 2: payment webhook arrives (trial ended, first real charge)
        await handlePaymentSucceeded(
            { id: 'in_race_ok', subscription: 'sub_race_001' },
            mockReq(),
        );
        const updated = await getSub(subs[0].id);
        expect(updated.status).toBe('active');
    });

    it('duplicate checkout handler call (isolation test, dedup enforced at handleWebhook level)', async () => {
        const session = stripeSession(userId, plan.id, 'sub_race_001', 'cs_dup_001');

        // First delivery
        await handleCheckoutComplete(session, mockReq());
        // Second direct call bypasses handleWebhook deduplication intentionally for isolation.
        // Real duplicate webhook protection is enforced at the handleWebhook dispatcher level
        // via stripe_webhook_events deduplication — see SCENARIO 12.
        await handleCheckoutComplete(session, mockReq());

        const allSubs = await userSubs(userId);
        expect(allSubs.length).toBeGreaterThanOrEqual(1);
        expect(allSubs.some(s => s.planId === plan.id)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 8 — Customer upgrades while on trial period
//
// trialing sub counts as active → no new trial granted → old trial canceled
// immediately, new Pro sub created without a trial period
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 8 — Customer upgrades while on trial period', () => {
    let app: FastifyInstance;
    let userId: string;
    let basicPlan: typeof schema.plans.$inferSelect;
    let proPlan: typeof schema.plans.$inferSelect;
    let trialSub: typeof schema.subscriptions.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'trial-upgrader@example.com' });
        userId = user.id;
        basicPlan = await createPlan({ name: 'Basic', price: 1900, trialDays: 14 });
        proPlan   = await createPlan({ name: 'Pro',   price: 4900, trialDays: 7 });

        trialSub = await createSub(userId, basicPlan.id, {
            status: 'trialing',
            externalSubscriptionId: 'sub_trial_basic',
            trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        });

        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_pro_from_trial', { status: 'active', trial_end: null }) as any,
        );
        vi.mocked(stripeService.createCheckoutSession).mockClear();
        vi.mocked(stripeService.cancelSubscriptionImmediately).mockClear();
    });

    afterEach(async () => { await app.close(); });

    it('STEP 1 — checkout session for Pro: 0 trial days (trialing counts as existing sub)', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const res = await app.inject({
            method: 'POST',
            url: '/create-checkout-session',
            payload: { planId: proPlan.id },
        });

        expect(res.statusCode).toBe(200);
        expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
            userId,
            'trial-upgrader@example.com',
            proPlan.id,
            expect.any(String), // stripePriceId
            expect.any(String), // returnUrl
            0, // trialing subscription exists → no new trial
        );
    });

    it('STEP 2 — checkout.session.completed cancels trial sub and creates Pro sub without trial', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        await handleCheckoutComplete(
            stripeSession(userId, proPlan.id, 'sub_pro_from_trial'),
            mockReq(),
        );

        // Old trial sub: canceled
        const canceledTrial = await getSub(trialSub.id);
        expect(canceledTrial.status).toBe('canceled');
        expect(stripeService.cancelSubscriptionImmediately).toHaveBeenCalledWith('sub_trial_basic');

        // New Pro sub: active, no trial end date
        const proSub = (await userSubs(userId)).find(
            s => s.externalSubscriptionId === 'sub_pro_from_trial',
        );
        expect(proSub).toBeDefined();
        expect(proSub!.planId).toBe(proPlan.id);
        expect(proSub!.status).toBe('active');
        expect(proSub!.trialEndsAt).toBeNull();
    });

    it('STEP 3 — only one active subscription after trial upgrade', async () => {
        await handleCheckoutComplete(
            stripeSession(userId, proPlan.id, 'sub_pro_from_trial'),
            mockReq(),
        );

        const activeSubs = (await userSubs(userId)).filter(s => s.status === 'active');
        expect(activeSubs).toHaveLength(1);
        expect(activeSubs[0].planId).toBe(proPlan.id);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 9 — Subscription status endpoint accuracy across full lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 9 — Subscription status endpoint accuracy across full lifecycle', () => {
    let app: FastifyInstance;
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'status-check@example.com' });
        userId = user.id;
        plan = await createPlan({ name: 'Status Plan', price: 1900 });
        app = await buildApp(userId);
    });

    afterEach(async () => { await app.close(); });

    it('returns 404 when user has no subscription at all', async () => {
        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(404);
    });

    it('returns trialing status with trialEndsAt populated', async () => {
        const trialEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        await createSub(userId, plan.id, { status: 'trialing', trialEndsAt: trialEnd });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.status).toBe('trialing');
        // Allow up to 5 s of drift between when we created trialEnd and when the DB read back
        const diff = Math.abs(new Date(body.trialEndsAt).getTime() - trialEnd.getTime());
        expect(diff).toBeLessThan(5_000);
        expect(body.cancelAtPeriodEnd).toBe(false);
    });

    it('returns active status without trialEndsAt', async () => {
        await createSub(userId, plan.id, { status: 'active' });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.status).toBe('active');
        expect(body.trialEndsAt).toBeUndefined();
        expect(body.planName).toBe('Status Plan');
    });

    it('returns cancelAtPeriodEnd=true when subscription is scheduled to cancel', async () => {
        await createSub(userId, plan.id, { status: 'active', cancelAtPeriodEnd: true });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().cancelAtPeriodEnd).toBe(true);
        expect(res.json().status).toBe('active');
    });

    it('returns past_due status correctly', async () => {
        await createSub(userId, plan.id, { status: 'past_due' });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('past_due');
    });

    it('response includes planId, planName, currentPeriodStart, and currentPeriodEnd', async () => {
        const periodStart = new Date(Date.now() - 5 * 24 * 3600 * 1000);
        const periodEnd   = new Date(Date.now() + 25 * 24 * 3600 * 1000);
        await createSub(userId, plan.id, {
            status: 'active',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
        });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body.planId).toBe(plan.id);
        expect(body.planName).toBe('Status Plan');
        expect(Math.abs(new Date(body.currentPeriodStart).getTime() - periodStart.getTime())).toBeLessThan(5_000);
        expect(Math.abs(new Date(body.currentPeriodEnd).getTime() - periodEnd.getTime())).toBeLessThan(5_000);
    });

    it('when user has both a canceled and an active subscription — returns the active one', async () => {
        const oldPlan = await createPlan({ name: 'Old Plan' });
        await createSub(userId, oldPlan.id, {
            status: 'canceled',
            canceledAt: new Date(Date.now() - 24 * 3600 * 1000),
        });
        await createSub(userId, plan.id, { status: 'active' });

        const res = await app.inject({ method: 'GET', url: '/subscription-status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('active');
        expect(res.json().planId).toBe(plan.id);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 10 — Billing portal access
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 10 — Billing portal access', () => {
    let app: FastifyInstance;
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'portal@example.com' });
        userId = user.id;
        plan = await createPlan({ name: 'Portal Plan', price: 1900 });
        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createBillingPortalSession).mockClear();
    });

    afterEach(async () => { await app.close(); });

    it('returns 404 when user has no subscription', async () => {
        const res = await app.inject({ method: 'POST', url: '/billing-portal' });
        expect(res.statusCode).toBe(404);
    });

    it('returns 404 when subscription exists but has no stripeCustomerId', async () => {
        await createSub(userId, plan.id, { stripeCustomerId: null as any });

        const res = await app.inject({ method: 'POST', url: '/billing-portal' });
        expect(res.statusCode).toBe(404);
        expect(res.json().error).toMatch(/no stripe customer/i);
    });

    it('returns billing portal URL for a valid active subscription', async () => {
        const { stripeService } = await import('../../src/services/stripe');
        await createSub(userId, plan.id, { stripeCustomerId: 'cus_portal_test' });

        const res = await app.inject({ method: 'POST', url: '/billing-portal' });

        expect(res.statusCode).toBe(200);
        expect(res.json().url).toBe('https://billing.stripe.com/session/lifecycle');
        expect(stripeService.createBillingPortalSession).toHaveBeenCalledWith(
            'cus_portal_test',
            expect.any(String), // returnUrl (dashboard URL)
        );
    });

    it('returns 403 SANCTIONED_GEO_BLOCK for North Korea (KP)', async () => {
        const sanctionedApp = await buildApp(userId, { country: 'KP', region: null });
        await createSub(userId, plan.id, { stripeCustomerId: 'cus_sanc_kp' });

        const res = await sanctionedApp.inject({ method: 'POST', url: '/billing-portal' });
        await sanctionedApp.close();

        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('SANCTIONED_GEO_BLOCK');
    });

    it('returns 403 SANCTIONED_GEO_BLOCK for all sanctioned countries', async () => {
        await createSub(userId, plan.id, { stripeCustomerId: 'cus_sanc_multi' });

        for (const country of ['CU', 'IR', 'KP', 'SY']) {
            const sanctionedApp = await buildApp(userId, { country, region: null });
            const res = await sanctionedApp.inject({ method: 'POST', url: '/billing-portal' });
            await sanctionedApp.close();
            expect(res.statusCode).toBe(403);
            expect(res.json().code).toBe('SANCTIONED_GEO_BLOCK');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 11 — customer.subscription.created backup handler
//
// This webhook fires after checkout.session.completed. If the subscription
// already exists it corrects any stale status; if it is missing it logs a
// warning (should never happen in normal flow).
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 11 — customer.subscription.created backup handler', () => {
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'created-hook@example.com' });
        userId = user.id;
        plan = await createPlan({ name: 'Created Hook Plan', price: 1900 });
    });

    it('subscription already active in DB — logs info and makes no change', async () => {
        const sub = await createSub(userId, plan.id, {
            status: 'active',
            externalSubscriptionId: 'sub_already_active',
        });

        const req = mockReq();

        await handleSubscriptionCreated(
            { id: 'sub_already_active', status: 'active' },
            req,
        );

        const unchanged = await getSub(sub.id);
        expect(unchanged.status).toBe('active');
        expect(req.log.info).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionId: 'sub_already_active' }),
            expect.stringMatching(/already exists/i),
        );
    });

    it('subscription exists as trialing but Stripe reports active — corrects status to active', async () => {
        const sub = await createSub(userId, plan.id, {
            status: 'trialing',
            externalSubscriptionId: 'sub_trialing_fix',
        });

        await handleSubscriptionCreated(
            { id: 'sub_trialing_fix', status: 'active' },
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('active');
    });

    it('subscription exists as past_due but Stripe reports active — corrects status to active', async () => {
        const sub = await createSub(userId, plan.id, {
            status: 'past_due',
            externalSubscriptionId: 'sub_pastdue_fix',
        });

        await handleSubscriptionCreated(
            { id: 'sub_pastdue_fix', status: 'active' },
            mockReq(),
        );

        const updated = await getSub(sub.id);
        expect(updated.status).toBe('active');
    });

    it('subscription not found in DB at all — logs warning without throwing', async () => {
        const req = mockReq();

        await expect(
            handleSubscriptionCreated(
                { id: 'sub_ghost_not_in_db', status: 'active' },
                req,
            ),
        ).resolves.not.toThrow();

        expect(req.log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionId: 'sub_ghost_not_in_db' }),
            expect.any(String),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 12 — Webhook-level idempotency via stripe_webhook_events table
//
// Duplicate Stripe event deliveries (same event ID) are deduplicated at the
// handleWebhook dispatcher level before any handler is invoked.
// ─────────────────────────────────────────────────────────────────────────────

describe('SCENARIO 12 — Webhook-level idempotency deduplication', () => {
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: `dedup-${uid()}@example.com` });
        userId = user.id;
        plan = await createPlan({ name: 'Dedup Plan', price: 1900 });

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            stripeSubObj('sub_dedup_001', { status: 'trialing' }) as any,
        );
    });

    it('duplicate checkout.session.completed with same event ID creates only one subscription', async () => {
        const { paymentController } = await import('../../src/controllers/payment');
        const { stripeService } = await import('../../src/services/stripe');

        const eventId = `evt_dedup_checkout_${uid()}`;
        const session = stripeSession(userId, plan.id, 'sub_dedup_001');
        const fakeEvent = {
            id: eventId,
            type: 'checkout.session.completed',
            data: { object: session },
        };

        const makeWebhookReq = () => ({
            headers: { 'stripe-signature': 'sig_test' },
            rawBody: Buffer.from('{}'),
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as any);

        const fakeReply = () => {
            const r: any = {};
            r.send = vi.fn().mockReturnValue(r);
            r.status = vi.fn().mockReturnValue(r);
            return r;
        };

        vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(fakeEvent as any);

        // First delivery — should process and create subscription
        await paymentController.handleWebhook(makeWebhookReq(), fakeReply());
        const subsAfterFirst = await userSubs(userId);
        expect(subsAfterFirst).toHaveLength(1);

        // Verify event is marked as 'completed' in stripe_webhook_events
        const [eventRow] = await testDb
            .select({ status: schema.stripeWebhookEvents.status })
            .from(schema.stripeWebhookEvents)
            .where(eq(schema.stripeWebhookEvents.eventId, eventId));
        expect(eventRow.status).toBe('completed');

        // Second delivery with same event ID — should be skipped (status = completed)
        await paymentController.handleWebhook(makeWebhookReq(), fakeReply());
        const subsAfterSecond = await userSubs(userId);
        expect(subsAfterSecond).toHaveLength(1);
    });

    it('duplicate invoice.payment_failed with same event ID sends only one notification', async () => {
        const { paymentController } = await import('../../src/controllers/payment');
        const { stripeService } = await import('../../src/services/stripe');
        const { notificationService } = await import('../../src/services/notifications');

        // Create a subscription so handlePaymentFailed can find it
        const sub = await createSub(userId, plan.id, {
            externalSubscriptionId: 'sub_dedup_001',
            stripeCustomerId: 'cus_dedup_001',
        });

        const eventId = `evt_dedup_failed_${uid()}`;
        const fakeEvent = {
            id: eventId,
            type: 'invoice.payment_failed',
            data: { object: { id: `in_dedup_${uid()}`, subscription: 'sub_dedup_001' } },
        };

        const makeWebhookReq = () => ({
            headers: { 'stripe-signature': 'sig_test' },
            rawBody: Buffer.from('{}'),
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as any);

        const fakeReply = () => {
            const r: any = {};
            r.send = vi.fn().mockReturnValue(r);
            r.status = vi.fn().mockReturnValue(r);
            return r;
        };

        vi.mocked(stripeService.verifyWebhookSignature).mockReturnValue(fakeEvent as any);
        vi.mocked(notificationService.sendTemplateNotification).mockClear();

        // First delivery — processes, sends notification, marks past_due
        await paymentController.handleWebhook(makeWebhookReq(), fakeReply());
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledTimes(1);
        expect((await testDb.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id)))[0].status).toBe('past_due');

        // Verify event marked as completed
        const [eventRow] = await testDb
            .select({ status: schema.stripeWebhookEvents.status })
            .from(schema.stripeWebhookEvents)
            .where(eq(schema.stripeWebhookEvents.eventId, eventId));
        expect(eventRow.status).toBe('completed');

        vi.mocked(notificationService.sendTemplateNotification).mockClear();

        // Second delivery with same event ID — skipped entirely (status = completed)
        await paymentController.handleWebhook(makeWebhookReq(), fakeReply());
        expect(notificationService.sendTemplateNotification).toHaveBeenCalledTimes(0);
    });
});
