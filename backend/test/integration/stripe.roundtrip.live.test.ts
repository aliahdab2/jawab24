/**
 * REAL Stripe round-trip — test mode only.
 *
 * Every other payment test in this repo mocks `stripeService`. That is exactly
 * how a merchant could be charged and never activated for weeks with a green
 * suite: the tests validated our model of Stripe, not Stripe.
 *
 * This one makes genuine API calls against Stripe **test mode** and verifies
 * the assumption the whole linking fix rests on:
 *
 *   > a real Stripe subscription, created the way production creates it,
 *   > carries `metadata.userId` / `metadata.planId` through to the object the
 *   > webhook handlers receive.
 *
 * Production evidence supported that, but it was inferred from one incident.
 * This proves it.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * Hard-refuses anything that is not an `sk_test_` key. A live key would create
 * real charges on real cards, so an ambiguous key is a failure, never a skip.
 * Skips silently only when NO key is configured at all.
 *
 * ── RUNNING ─────────────────────────────────────────────────────────────────
 *   STRIPE_ROUNDTRIP=1 STRIPE_SECRET_KEY=sk_test_… \
 *     npm run test:integration:local -- stripe.roundtrip
 *
 * Opt-in is explicit and deliberate. `test/integration/setup.ts` injects a
 * dummy `sk_test_…` key so the rest of the suite can boot, and a prefix check
 * alone would happily accept it and then fail on the first API call. Requiring
 * STRIPE_ROUNDTRIP=1 keeps this out of the ordinary suite entirely — it reaches
 * an external service and should never run by accident.
 *
 * Get the key from Stripe Dashboard → Developers → API keys with the
 * **Test mode** toggle ON. Never commit it; never paste it into a chat.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import './setup';

const KEY = process.env.STRIPE_SECRET_KEY ?? '';
// `test/integration/setup.ts` injects a dummy `sk_test_…dummy` key so the rest
// of the suite can boot. It passes a prefix check and then fails on the first
// API call with Stripe's own opaque message, so name it here and give the
// runner something actionable instead.
const IS_PLACEHOLDER = KEY.includes('dummy');
const IS_TEST_KEY = KEY.startsWith('sk_test_') && !IS_PLACEHOLDER;
const REQUESTED = process.env.STRIPE_ROUNDTRIP === '1';

// Every refusal below is a THROW, never a skip. A skip would look identical to
// "not requested" — which is how a suite ends up reporting green while proving
// nothing, the exact failure mode this test exists to end.
if (REQUESTED) {
    // Ordered most-specific first, so the message names the actual problem.
    if (!KEY) {
        throw new Error(
            'STRIPE_ROUNDTRIP=1 was set but STRIPE_SECRET_KEY is empty. ' +
            'Run: STRIPE_ROUNDTRIP=1 STRIPE_SECRET_KEY=sk_test_… npm run test:integration:local -- stripe.roundtrip'
        );
    }
    if (IS_PLACEHOLDER) {
        throw new Error(
            'STRIPE_ROUNDTRIP=1 was set but STRIPE_SECRET_KEY is the placeholder from test/integration/setup.ts. ' +
            'Pass a real test-mode key from Stripe Dashboard → Developers → API keys (Test mode ON).'
        );
    }
    if (!KEY.startsWith('sk_test_')) {
        throw new Error(
            'Refusing to run the Stripe round-trip: STRIPE_SECRET_KEY is not an sk_test_ key. ' +
            'This test creates subscriptions and confirms payments — against a live key that means real charges on real cards.'
        );
    }
}

const runIf = REQUESTED && IS_TEST_KEY ? describe : describe.skip;

runIf('REAL Stripe round-trip (test mode)', () => {
    let stripe: Stripe;
    let userId: string;
    let plan: typeof schema.plans.$inferSelect;
    let customerId: string;
    let priceId: string;
    let subscriptionId: string;

    beforeAll(async () => {
        stripe = new Stripe(KEY);

        const user = await createTestUser({ email: `roundtrip+${Date.now()}@example.com` });
        userId = user.id;

        // A throwaway product/price in test mode, so the test owns its fixtures
        // and can't be broken by dashboard changes.
        const product = await stripe.products.create({ name: 'Jawab24 round-trip fixture' });
        const price = await stripe.prices.create({
            product: product.id,
            currency: 'usd',
            unit_amount: 3900,
            recurring: { interval: 'month' },
        });
        priceId = price.id;

        const [row] = await testDb.insert(schema.plans).values({
            name: 'Round-trip Business',
            slug: `roundtrip-${Date.now()}`,
            price: 3900,
            stripePriceId: priceId,
            trialDays: 0,
            maxAiRepliesPerMonth: 2000,
            maxTemplates: 20,
            maxRules: 20,
            isActive: true,
        }).returning();
        plan = row;

        const customer = await stripe.customers.create({
            email: user.email!,
            metadata: { userId },
        });
        customerId = customer.id;
    }, 60_000);

    afterAll(async () => {
        // Test-mode objects are harmless, but leaving live subscriptions behind
        // makes later runs noisy and the dashboard misleading.
        if (subscriptionId) {
            await stripe.subscriptions.cancel(subscriptionId).catch(() => {});
        }
        if (customerId) {
            await stripe.customers.del(customerId).catch(() => {});
        }
    }, 60_000);

    it('creates the subscription exactly the way production does', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const result = await stripeService.createSubscriptionIntent({
            customerId,
            priceId,
            userId,
            planId: plan.id,
            trialDays: 0,
        });

        subscriptionId = result.subscriptionId;

        expect(result.type).toBe('payment');
        expect(result.clientSecret).toMatch(/_secret_/);

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        expect(sub.status).toBe('incomplete'); // default_incomplete, unpaid
    }, 60_000);

    // THE assumption the linking fix rests on. If Stripe ever stopped echoing
    // metadata back on the subscription object, adoption would silently stop
    // working and merchants would go unactivated again.
    it('carries userId/planId metadata on the real Stripe subscription', async () => {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);

        expect(sub.metadata.userId).toBe(userId);
        expect(sub.metadata.planId).toBe(plan.id);
    }, 60_000);

    it('pays it with a test card and Stripe reports it active', async () => {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['latest_invoice.confirmation_secret'],
        });
        const invoice = sub.latest_invoice as Stripe.Invoice;
        const clientSecret = invoice.confirmation_secret?.client_secret as string;
        const paymentIntentId = clientSecret.split('_secret_')[0];

        // Stripe's shared test PaymentMethod — always succeeds in test mode.
        const confirmed = await stripe.paymentIntents.confirm(paymentIntentId, {
            payment_method: 'pm_card_visa',
        });
        expect(confirmed.status).toBe('succeeded');

        const paid = await stripe.subscriptions.retrieve(subscriptionId);
        expect(paid.status).toBe('active');
    }, 60_000);

    // The bug, end to end, against real Stripe data: feed the genuine
    // subscription object to the handler and confirm the merchant is activated.
    it('activates the merchant locally from the real subscription object', async () => {
        const { handleSubscriptionUpdated } = await import('../../src/controllers/paymentWebhookHandlers');
        const real = await stripe.subscriptions.retrieve(subscriptionId);

        await handleSubscriptionUpdated(real, {
            log: { info: () => {}, warn: () => {}, error: () => {} },
        } as never);

        const rows = await testDb
            .select()
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.userId, userId));

        expect(rows).toHaveLength(1);
        expect(rows[0].externalSubscriptionId).toBe(subscriptionId);
        expect(rows[0].status).toBe('active');
        expect(rows[0].planId).toBe(plan.id);
        expect(rows[0].stripeCustomerId).toBe(customerId);
        expect(rows[0].paymentMethod).toBe('stripe');
    }, 60_000);

    it('the reconciliation sweep sees the same subscription Stripe reports as paid', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const active = await stripeService.listSubscriptions({ status: 'active', limit: 100 });

        expect(active.some(s => s.id === subscriptionId)).toBe(true);
    }, 60_000);
});
