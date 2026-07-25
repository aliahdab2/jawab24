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

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
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
// Validate the FORMAT rather than blocklisting known placeholders — every
// blocklist so far has been defeated by the next paste. Observed in practice:
// `sk_test_…dummy` (injected by setup.ts), the literal `sk_test_...`, and
// `sk_test_51SlAFl…YOUR_REAL_KEY` — the last containing a Unicode ellipsis,
// which isn't three ASCII dots and, being non-ASCII, corrupts the HTTP auth
// header so Stripe reports a *connection* error rather than a bad key.
//
// A real Stripe secret key is `sk_test_` + base62, ~107 chars total.
const KEY_FORMAT = /^sk_test_[A-Za-z0-9]{24,}$/;
const IS_PLACEHOLDER = KEY.startsWith('sk_test_') && (!KEY_FORMAT.test(KEY) || KEY.includes('dummy'));
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
            `STRIPE_SECRET_KEY is not a real key — got ${KEY.length} chars, expected sk_test_ + ~99 base62 chars.\n` +
            'It looks like placeholder text from a copied command was left unsubstituted.\n' +
            'Safest way to avoid paste damage entirely:\n' +
            "  1. printf '%s' 'PASTE_KEY_HERE' > ~/.jawab24_stripe_test_key && chmod 600 ~/.jawab24_stripe_test_key\n" +
            '  2. STRIPE_ROUNDTRIP=1 STRIPE_SECRET_KEY=$(cat ~/.jawab24_stripe_test_key) \\\n' +
            '       npm run test:integration:local -- stripe.roundtrip\n' +
            'Key comes from https://dashboard.stripe.com/test/apikeys (Test mode ON).'
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
    let planId: string;
    let planSlug: string;
    let userEmail: string;
    let customerId: string;
    let priceId: string;
    let subscriptionId: string;

    beforeAll(async () => {
        // Pin the SAME apiVersion as src/services/stripe.ts. `confirmation_secret`
        // is version-sensitive (it replaced latest_invoice.payment_intent), so an
        // unpinned client could see a different shape than production does and
        // make this test either falsely pass or falsely fail.
        stripe = new Stripe(KEY, { apiVersion: '2026-06-24.dahlia' });

        // IDs are generated ONCE and reused, because they are baked into the
        // Stripe subscription's metadata and must keep matching a local row.
        // setup.ts TRUNCATEs every table in a global beforeEach, so the rows
        // themselves are re-created per test (below) — creating them only here
        // left the FK dangling and blew up the moment a test wrote a row.
        userId = randomUUID();
        planId = randomUUID();
        userEmail = `roundtrip+${Date.now()}@example.com`;
        planSlug = `roundtrip-${Date.now()}`;

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

        const customer = await stripe.customers.create({
            email: userEmail,
            metadata: { userId },
        });
        customerId = customer.id;
    }, 60_000);

    // Re-seed after setup.ts's global TRUNCATE, keeping the SAME ids so the
    // Stripe subscription's metadata still resolves to a real local row.
    //
    // The two tables are treated differently ON PURPOSE: setup.ts truncates
    // `users` but NOT `plans`, so the user must be re-inserted every test while
    // the plan survives — and re-inserting it unconditionally collides on
    // plans_pkey. Hence onConflictDoNothing rather than a plain insert.
    beforeEach(async () => {
        await createTestUser({ id: userId, email: userEmail });
        await testDb.insert(schema.plans).values({
            id: planId,
            name: 'Round-trip Business',
            slug: planSlug,
            price: 3900,
            stripePriceId: priceId,
            trialDays: 0,
            maxAiRepliesPerMonth: 2000,
            maxTemplates: 20,
            maxRules: 20,
            isActive: true,
        }).onConflictDoNothing();
    });

    afterAll(async () => {
        // Test-mode objects are harmless, but this runs on every deploy — without
        // cleanup the test-mode dashboard fills with fixtures and real data gets
        // hard to see. Each step is independently best-effort so one failure
        // cannot strand the rest.
        if (subscriptionId) {
            await stripe.subscriptions.cancel(subscriptionId).catch(() => {});
        }
        if (customerId) {
            await stripe.customers.del(customerId).catch(() => {});
        }
        // Prices cannot be deleted, only deactivated; products can be archived.
        if (priceId) {
            await stripe.prices.update(priceId, { active: false }).catch(() => {});
            const price = await stripe.prices.retrieve(priceId).catch(() => null);
            const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;
            if (productId) {
                await stripe.products.update(productId, { active: false }).catch(() => {});
            }
        }
    }, 60_000);

    it('creates the subscription exactly the way production does', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const result = await stripeService.createSubscriptionIntent({
            customerId,
            priceId,
            userId,
            planId: planId,
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
        expect(sub.metadata.planId).toBe(planId);
    }, 60_000);

    it('pays it with a test card and Stripe reports it active', async () => {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['latest_invoice.confirmation_secret'],
        });
        const invoice = sub.latest_invoice as Stripe.Invoice;
        const clientSecret = invoice.confirmation_secret?.client_secret as string;
        const paymentIntentId = clientSecret.split('_secret_')[0];

        // Stripe's shared test PaymentMethod — always succeeds in test mode.
        // `return_url` is required because createSubscriptionIntent does NOT pin
        // payment_method_types on subscriptions (unlike top-ups), so the invoice
        // PaymentIntent inherits the account's automatic payment methods, which
        // may include redirect-based ones. A card never redirects, but Stripe
        // validates the parameter up front regardless.
        const confirmed = await stripe.paymentIntents.confirm(paymentIntentId, {
            payment_method: 'pm_card_visa',
            return_url: 'https://jawab24.com/payment/return',
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
        expect(rows[0].planId).toBe(planId);
        expect(rows[0].stripeCustomerId).toBe(customerId);
        expect(rows[0].paymentMethod).toBe('stripe');
    }, 60_000);

    // Hosted checkout (D-040) — the native-app path and the web fallback.
    // Session params (tax_id_collection, payment_method_collection, locale…)
    // are only truly validated by the real API: a param combination Stripe
    // rejects would break every app-originated payment while the mocked suites
    // stayed green — the exact failure shape this file exists to prevent.
    it('creates a REAL hosted checkout session and cleans it up', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const { sessionId, url } = await stripeService.createHostedCheckoutSession(
            userId,
            userEmail,
            planId,
            priceId,
            'https://jawab24.com/payment/return?session_id={CHECKOUT_SESSION_ID}&hosted=1',
            'https://jawab24.com/pricing',
            0,
        );

        expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        expect(session.status).toBe('open');
        expect(session.mode).toBe('subscription');
        // The metadata linking depends on must survive to the real object.
        expect(session.metadata?.userId).toBe(userId);

        // Expire it so the test-mode dashboard doesn't fill with open sessions
        // (this runs on every deploy).
        await stripe.checkout.sessions.expire(sessionId);
    }, 60_000);

    it('the reconciliation sweep sees the same subscription Stripe reports as paid', async () => {
        const { stripeService } = await import('../../src/services/stripe');

        const active = await stripeService.listSubscriptions({ status: 'active', limit: 100 });

        expect(active.some(s => s.id === subscriptionId)).toBe(true);
    }, 60_000);
});
