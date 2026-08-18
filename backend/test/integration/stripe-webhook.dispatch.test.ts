/**
 * Stripe webhook — signed payload ALL THE WAY to the database.
 *
 * WHY THIS FILE EXISTS. Two suites already sat either side of this seam and
 * both were green while merchants went unactivated:
 *
 *   - `stripe-webhook.test.ts` proves transport — real signature verification,
 *     tamper rejection, replay tolerance, the dedup table — but **mocks
 *     `dispatchStripeEvent`**, so it stops at the boundary.
 *   - `payment.paymentElement.test.ts` / `paymentWebhookHandlers.test.ts` call
 *     the handlers **directly**, so they never see a real payload.
 *
 * Nothing crossed the middle. And the middle is exactly where the bug lived:
 * transport worked, dispatch worked, and the handler quietly matched zero rows.
 *
 * This file removes the mock. A genuinely signed `customer.subscription.updated`
 * goes in at the HTTP entry point; the assertion is on the merchant's row.
 *
 * No Stripe network access is needed: signing uses the local webhook secret,
 * and the one outbound call adoption makes is stubbed (see below).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';

// NOTHING on the path is mocked — this is the whole path.
import { paymentController } from '../../src/controllers/payment';
// The one exception, and it is OFF the path: adoption fetches the expanded
// latest invoice from Stripe before it will write a period (#818). There is no
// Stripe to call here — STRIPE_SECRET_KEY is a dummy — so the real method would
// issue a live request to api.stripe.com and fail on auth. It is stubbed per
// test, exactly as the dunning integration suite does. Transport, dispatch,
// handler and DB all stay real.
import { stripeService } from '../../src/services/stripe';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
const stripe = new Stripe('sk_test_dummy', { apiVersion: '2023-10-16' });

const NOW_SECS = Math.floor(Date.now() / 1000);
const ONE_MONTH_SECS = 30 * 24 * 60 * 60;

let seq = 0;
const uid = () => `wd${Date.now()}${seq++}`;

function sign(payload: string): string {
    return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

async function postWebhook(rawBody: string): Promise<{ statusCode: number }> {
    const captured = { statusCode: 200 };
    const reply = {
        status(code: number) { captured.statusCode = code; return reply; },
        send() { return reply; },
    } as unknown as FastifyReply;

    const noop = () => undefined;
    const request = {
        headers: { 'stripe-signature': sign(rawBody) },
        rawBody,
        log: { info: noop, warn: noop, error: noop },
    } as unknown as FastifyRequest;

    await paymentController.handleWebhook(request, reply);
    return captured;
}

/** A real-shaped event envelope wrapping a PaymentElement subscription. */
function subscriptionEvent(
    eventId: string,
    type: string,
    sub: Record<string, unknown>,
): string {
    return JSON.stringify({
        id: eventId,
        object: 'event',
        api_version: '2023-10-16',
        created: NOW_SECS,
        type,
        data: { object: sub },
    });
}

function peSubscription(id: string, userId: string, planId: string, over: Record<string, unknown> = {}) {
    return {
        id,
        object: 'subscription',
        status: 'active',
        customer: 'cus_wd_test',
        metadata: { userId, planId },
        current_period_start: NOW_SECS,
        current_period_end: NOW_SECS + ONE_MONTH_SECS,
        trial_end: null,
        cancel_at_period_end: false,
        items: { data: [{ price: { id: `price_${uid()}` } }] },
        ...over,
    };
}

async function createPlan() {
    const [plan] = await testDb.insert(schema.plans).values({
        name: 'Business', slug: `plan-${uid()}`, price: 3900,
        stripePriceId: `price_${uid()}`, trialDays: 0,
        maxAiRepliesPerMonth: 2000, maxTemplates: 20, maxRules: 20, isActive: true,
    }).returning();
    return plan;
}

async function createSignupTrialRow(userId: string, planId: string) {
    const [sub] = await testDb.insert(schema.subscriptions).values({
        userId, planId, status: 'trialing',
        externalSubscriptionId: null, stripeCustomerId: null, paymentMethod: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + ONE_MONTH_SECS * 1000),
        trialEndsAt: new Date(Date.now() + ONE_MONTH_SECS * 1000),
    }).returning();
    return sub;
}

async function userSubs(userId: string) {
    return testDb.select().from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, userId));
}

describe('Stripe webhook → dispatcher → handler → DB (no mock on the path)', () => {
    let userId: string;
    let planId: string;

    beforeEach(async () => {
        const user = await createTestUser({ email: `wd+${uid()}@example.com` });
        userId = user.id;
        planId = (await createPlan()).id;
        await testDb.delete(schema.stripeWebhookEvents);

        vi.spyOn(stripeService, 'getSubscriptionWithLatestInvoice').mockImplementation(
            async (id: string) => ({
                id,
                object: 'subscription',
                status: 'active',
                latest_invoice: { id: `in_${id}`, status: 'paid' },
            } as unknown as Stripe.Response<Stripe.Subscription>),
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // THE regression, from the outside in. A merchant pays; Stripe POSTs this.
    // Before the fix the request returned 200 and the row was never touched —
    // which is precisely why nothing anywhere looked broken.
    it('a signed customer.subscription.updated activates the merchant', async () => {
        await createSignupTrialRow(userId, planId);
        const eventId = `evt_${uid()}`;

        const res = await postWebhook(subscriptionEvent(
            eventId,
            'customer.subscription.updated',
            peSubscription('sub_wd_1', userId, planId),
        ));

        expect(res.statusCode).toBe(200);

        const subs = await userSubs(userId);
        expect(subs).toHaveLength(1);
        expect(subs[0].externalSubscriptionId).toBe('sub_wd_1');
        expect(subs[0].status).toBe('active');
        expect(subs[0].stripeCustomerId).toBe('cus_wd_test');
        expect(subs[0].paymentMethod).toBe('stripe');
    });

    it('records the event as completed so a Stripe retry is a no-op', async () => {
        await createSignupTrialRow(userId, planId);
        const eventId = `evt_${uid()}`;
        const body = subscriptionEvent(
            eventId,
            'customer.subscription.updated',
            peSubscription('sub_wd_2', userId, planId),
        );

        await postWebhook(body);

        const [row] = await testDb.select().from(schema.stripeWebhookEvents)
            .where(eq(schema.stripeWebhookEvents.eventId, eventId));
        expect(row.status).toBe('completed');

        // Stripe retries on network timeout — must not duplicate the row.
        await postWebhook(body);
        expect(await userSubs(userId)).toHaveLength(1);
    });

    // The guard, exercised through the real entry point rather than by calling
    // the handler directly: an unpaid subscription must not activate anyone.
    it('an incomplete subscription arriving over the wire changes nothing', async () => {
        await createSignupTrialRow(userId, planId);

        const res = await postWebhook(subscriptionEvent(
            `evt_${uid()}`,
            'customer.subscription.created',
            peSubscription('sub_wd_3', userId, planId, { status: 'incomplete' }),
        ));

        expect(res.statusCode).toBe(200);
        const subs = await userSubs(userId);
        expect(subs[0].externalSubscriptionId).toBeNull();
        expect(subs[0].status).toBe('trialing');
    });

    it('a signed customer.subscription.deleted cancels the merchant', async () => {
        await testDb.insert(schema.subscriptions).values({
            userId, planId, status: 'active',
            externalSubscriptionId: 'sub_wd_4',
            stripeCustomerId: 'cus_wd_test', paymentMethod: 'stripe',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + ONE_MONTH_SECS * 1000),
        });

        await postWebhook(subscriptionEvent(
            `evt_${uid()}`,
            'customer.subscription.deleted',
            peSubscription('sub_wd_4', userId, planId, { status: 'canceled' }),
        ));

        const subs = await userSubs(userId);
        expect(subs[0].status).toBe('canceled');
        expect(subs[0].canceledAt).not.toBeNull();
    });

    it('an unknown event type is accepted and ignored rather than 500ing', async () => {
        const res = await postWebhook(JSON.stringify({
            id: `evt_${uid()}`,
            object: 'event',
            api_version: '2023-10-16',
            created: NOW_SECS,
            type: 'radar.early_fraud_warning.created',
            data: { object: { id: 'issfr_1' } },
        }));

        expect(res.statusCode).toBe(200);
    });
});
