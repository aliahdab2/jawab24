/**
 * PaymentElement Subscription Lifecycle — Integration Tests
 *
 * WHY THIS FILE EXISTS.
 *
 * `payment.lifecycle.test.ts` covers eleven scenarios thoroughly — every one of
 * them through `handleCheckoutComplete`, i.e. Stripe **Checkout Sessions**.
 * Production does not use that flow. Checkout moved to the embedded
 * PaymentElement (`create-subscription-intent` → `stripe.subscriptions.create`),
 * which creates no Session, so `checkout.session.completed` never fires.
 *
 * The entire test pyramid therefore validated a code path merchants do not
 * take, while the path they do take had no controller test at all
 * (`createSubscriptionIntent` appeared in zero test files). That is exactly why
 * a merchant could pay and never be activated, for weeks, undetected: money
 * landed in Stripe, all three success webhooks arrived and were marked
 * completed, and every handler matched zero rows because nothing had ever
 * written `external_subscription_id`.
 *
 * These scenarios mirror the real flow end to end, against the real test DB.
 *
 * PE-1 — New merchant subscribes: intent → paid → local row linked and active
 * PE-2 — Retry spam: several `incomplete` subscriptions, only the paid one wins
 * PE-3 — The signup trial row is taken over, never duplicated
 * PE-4 — invoice.payment_succeeded adopts an unlinked row (production sequence)
 * PE-5 — Replay is idempotent
 * PE-6 — Missed webhook entirely: the reconciliation sweep heals it
 * PE-7 — `active` with an unpaid latest invoice must not be adopted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import {
    handleSubscriptionCreated,
    handleSubscriptionUpdated,
    handlePaymentSucceeded,
} from '../../src/controllers/paymentWebhookHandlers';
import { reconcileStripeSubscriptions } from '../../src/services/subscriptionLinking';

import './setup';

const NOW_SECS = Math.floor(Date.now() / 1000);
const ONE_MONTH_SECS = 30 * 24 * 60 * 60;
const ONE_MONTH_MS = ONE_MONTH_SECS * 1000;

vi.mock('../../src/services/stripe', () => ({
    stripeService: {
        findOrCreateCustomer: vi.fn().mockResolvedValue('cus_pe_test'),
        createSubscriptionIntent: vi.fn(),
        getSubscription: vi.fn(),
        // Adoption refuses to write a period until it has seen the latest
        // invoice PAID (#818) — Stripe advances the period an hour before it
        // degrades the status, so `active` alone would buy an unpaid month.
        // These scenarios are all "the merchant actually paid"; PE-7 overrides
        // this with an open invoice.
        getSubscriptionWithLatestInvoice: vi.fn().mockImplementation(async (id: string) => ({
            id,
            object: 'subscription',
            status: 'active',
            latest_invoice: { id: `in_${id}`, status: 'paid' },
        })),
        listSubscriptions: vi.fn().mockResolvedValue([]),
        createCheckoutSession: vi.fn(),
        cancelSubscriptionImmediately: vi.fn().mockResolvedValue({}),
        verifyWebhookSignature: vi.fn(),
    },
    stripeRefId: (ref: string | { id: string } | null | undefined) =>
        (!ref ? null : typeof ref === 'string' ? ref : ref.id),
    stripe: null,
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn().mockImplementation(async () => {}),
    requireAdmin: vi.fn().mockImplementation(async () => {}),
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotification: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/email', () => ({
    emailService: { send: vi.fn().mockResolvedValue({ success: true }) },
}));

let seq = 0;
const uid = () => `pe${Date.now()}${seq++}`;

async function createPlan(overrides: Partial<typeof schema.plans.$inferInsert> = {}) {
    const [plan] = await testDb
        .insert(schema.plans)
        .values({
            name: 'Business',
            slug: `plan-${uid()}`,
            price: 3900,
            stripePriceId: `price_${uid()}`,
            trialDays: 0,
            maxAiRepliesPerMonth: 2000,
            maxTemplates: 20,
            maxRules: 20,
            isActive: true,
            ...overrides,
        })
        .returning();
    return plan;
}

/** The row signup leaves behind: a local trial, never linked to Stripe. */
async function createSignupTrialRow(userId: string, planId: string) {
    const [sub] = await testDb
        .insert(schema.subscriptions)
        .values({
            userId,
            planId,
            status: 'trialing',
            externalSubscriptionId: null,
            stripeCustomerId: null,
            paymentMethod: null,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + ONE_MONTH_MS),
            trialEndsAt: new Date(Date.now() + ONE_MONTH_MS),
        })
        .returning();
    return sub;
}

async function buildApp(userId: string): Promise<FastifyInstance> {
    const app = fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
        request.user = { userId, facebookId: 'fb_pe_test' };
        request.geo = { country: 'LY', region: null };
    });
    const paymentRoutes = (await import('../../src/routes/payment')).default;
    app.register(paymentRoutes, { prefix: '/' });
    await app.ready();
    return app;
}

function mockReq() {
    return { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as any;
}

/** A PaymentElement subscription — carries the metadata the linking keys on. */
function peSub(id: string, userId: string, planId: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        status: 'active',
        customer: 'cus_pe_test',
        metadata: { userId, planId },
        current_period_start: NOW_SECS,
        current_period_end: NOW_SECS + ONE_MONTH_SECS,
        trial_end: null,
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_unmapped' } }] },
        ...overrides,
    } as any;
}

async function userSubs(userId: string) {
    return testDb
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, userId));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('PE-1 — New merchant subscribes through the PaymentElement flow', () => {
    let app: FastifyInstance;
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'pe.new@example.com' });
        userId = user.id;
        plan = await createPlan();
        app = await buildApp(userId);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.createSubscriptionIntent).mockResolvedValue({
            subscriptionId: 'sub_pe_001',
            clientSecret: 'pi_secret_001',
            type: 'payment',
        });
    });

    afterEach(async () => { await app.close(); });

    it('STEP 1 — create-subscription-intent returns a client secret', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/create-subscription-intent',
            payload: { planId: plan.id },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().clientSecret).toBe('pi_secret_001');
        expect(res.json().type).toBe('payment');
    });

    it('STEP 2 — the subscription carries userId/planId metadata, which is what linking depends on', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        await app.inject({
            method: 'POST',
            url: '/create-subscription-intent',
            payload: { planId: plan.id },
        });

        expect(stripeService.createSubscriptionIntent).toHaveBeenCalledWith(
            expect.objectContaining({ userId, planId: plan.id }),
        );
    });

    // The regression. Before the fix nothing wrote external_subscription_id for
    // this flow, so the merchant was charged and left on their signup trial.
    it('STEP 3 — becoming active links the local row and activates the merchant', async () => {
        await createSignupTrialRow(userId, plan.id);

        await handleSubscriptionUpdated(peSub('sub_pe_001', userId, plan.id), mockReq());

        const subs = await userSubs(userId);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBe('sub_pe_001');
        expect(subs[0].status).toBe('active');
        expect(subs[0].planId).toBe(plan.id);
        expect(subs[0].paymentMethod).toBe('stripe');
        expect(subs[0].stripeCustomerId).toBe('cus_pe_test');
    });
});

describe('PE-2 — Retry spam must not activate an unpaid account', () => {
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;

    beforeEach(async () => {
        const user = await createTestUser({ email: 'pe.retry@example.com' });
        userId = user.id;
        plan = await createPlan();
        await createSignupTrialRow(userId, plan.id);
    });

    // A merchant reloading checkout produced three `default_incomplete`
    // subscriptions in nine minutes in production. None of them is paid.
    it('ignores every incomplete subscription', async () => {
        for (const id of ['sub_try_1', 'sub_try_2', 'sub_try_3']) {
            await handleSubscriptionCreated(
                peSub(id, userId, plan.id, { status: 'incomplete' }),
                mockReq(),
            );
        }

        const subs = await userSubs(userId);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBeNull();
        expect(subs[0].status).toBe('trialing');
    });

    it('links only the attempt that is actually paid', async () => {
        await handleSubscriptionCreated(peSub('sub_try_1', userId, plan.id, { status: 'incomplete' }), mockReq());
        await handleSubscriptionUpdated(peSub('sub_try_3', userId, plan.id, { status: 'active' }), mockReq());

        const subs = await userSubs(userId);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBe('sub_try_3');
        expect(subs[0].status).toBe('active');
    });
});

describe('PE-3 — The signup trial row is taken over, never duplicated', () => {
    it('leaves exactly one row so the resolver cannot serve the stale trial', async () => {
        const user = await createTestUser({ email: 'pe.single@example.com' });
        const trialPlan = await createPlan({ name: 'Starter', price: 1500 });
        const paidPlan = await createPlan({ name: 'Business', price: 3900 });
        await createSignupTrialRow(user.id, trialPlan.id);

        await handleSubscriptionUpdated(peSub('sub_pe_up', user.id, paidPlan.id), mockReq());

        const subs = await userSubs(user.id);
        expect(subs).toHaveLength(1);
        expect(subs[0].planId).toBe(paidPlan.id);
        expect(subs[0].trialEndsAt).toBeNull();
    });
});

describe('PE-4 — invoice.payment_succeeded on an unlinked row', () => {
    // The exact production sequence: payment_intent.succeeded,
    // customer.subscription.updated, invoice.payment_succeeded all arrived and
    // were marked completed, and the row was never touched.
    it('adopts rather than giving up after its retries', async () => {
        const user = await createTestUser({ email: 'pe.invoice@example.com' });
        const plan = await createPlan();
        await createSignupTrialRow(user.id, plan.id);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscription).mockResolvedValue(
            peSub('sub_pe_inv', user.id, plan.id),
        );

        await handlePaymentSucceeded(
            { id: 'in_pe_1', subscription: 'sub_pe_inv' } as any,
            mockReq(),
        );

        const subs = await userSubs(user.id);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBe('sub_pe_inv');
        expect(subs[0].status).toBe('active');
    });
});

describe('PE-5 — Replay is idempotent', () => {
    it('does not create a second row when the same event is delivered twice', async () => {
        const user = await createTestUser({ email: 'pe.replay@example.com' });
        const plan = await createPlan();
        await createSignupTrialRow(user.id, plan.id);

        const evt = peSub('sub_pe_replay', user.id, plan.id);
        await handleSubscriptionUpdated(evt, mockReq());
        await handleSubscriptionUpdated(evt, mockReq());

        const subs = await userSubs(user.id);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBe('sub_pe_replay');
    });
});

describe('PE-6 — Webhook never arrives at all', () => {
    // The webhook path is a single point of failure. This is the safety net:
    // Stripe knows who paid, so the sweep reconciles against it.
    it('the reconciliation sweep activates the merchant anyway', async () => {
        const user = await createTestUser({ email: 'pe.sweep@example.com' });
        const plan = await createPlan();
        await createSignupTrialRow(user.id, plan.id);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([peSub('sub_pe_swept', user.id, plan.id)])
            .mockResolvedValueOnce([]);

        const result = await reconcileStripeSubscriptions({ log: mockReq().log });

        expect(result.healed).toBe(1);
        const subs = await userSubs(user.id);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBe('sub_pe_swept');
        expect(subs[0].status).toBe('active');
    });

    it('is a no-op on the second sweep once the row is linked', async () => {
        const user = await createTestUser({ email: 'pe.sweep2@example.com' });
        const plan = await createPlan();
        await createSignupTrialRow(user.id, plan.id);

        const { stripeService } = await import('../../src/services/stripe');
        const sub = peSub('sub_pe_twice', user.id, plan.id);
        vi.mocked(stripeService.listSubscriptions)
            .mockResolvedValueOnce([sub]).mockResolvedValueOnce([])
            .mockResolvedValueOnce([sub]).mockResolvedValueOnce([]);

        await reconcileStripeSubscriptions({ log: mockReq().log });
        const second = await reconcileStripeSubscriptions({ log: mockReq().log });

        expect(second.healed).toBe(0);
        expect(second.alreadyLinked).toBe(1);
        expect(await userSubs(user.id)).toHaveLength(1);
    });
});

describe('PE-7 — Active is not proof of payment', () => {
    // The 2026-08-13 incident, from the merchant's side: Stripe advanced the
    // period when it CREATED the renewal invoice and only degraded the status
    // ~1h later when the charge failed. Adopting inside that hour writes both
    // the period AND the quota window, i.e. hands out a month nobody paid for.
    it('refuses to adopt an active subscription whose latest invoice is open', async () => {
        const user = await createTestUser({ email: 'pe.unpaid@example.com' });
        const plan = await createPlan();
        await createSignupTrialRow(user.id, plan.id);

        const { stripeService } = await import('../../src/services/stripe');
        vi.mocked(stripeService.getSubscriptionWithLatestInvoice).mockResolvedValueOnce({
            id: 'sub_pe_unpaid',
            object: 'subscription',
            status: 'active',
            latest_invoice: { id: 'in_pe_unpaid', status: 'open', amount_paid: 0 },
        } as any);

        await handleSubscriptionUpdated(peSub('sub_pe_unpaid', user.id, plan.id), mockReq());

        const subs = await userSubs(user.id);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBeNull();
        expect(subs[0].status).toBe('trialing');
    });
});
