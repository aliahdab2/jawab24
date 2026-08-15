/**
 * Dunning emails — integration against the real database.
 *
 * Real: Postgres (rows, stamps, email_sends audit), the sweep engine, the
 * webhook handlers, signature verification on the end-to-end case.
 * Stubbed (external third parties only): the Resend HTTP API (global fetch)
 * and the Stripe API (stripeService method spies).
 *
 * The headline case is the Nourva backfill shape: a past_due stripe row whose
 * invoice.payment_failed webhook fired BEFORE this feature existed gets
 * exactly ONE payment_failed email from the first sweep run, carrying the
 * CURRENT open invoice's hosted pay link — and the second run sends nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { config } from '../../src/config';
import { stripeService } from '../../src/services/stripe';
import { runDunningNotices } from '../../src/services/dunningNotices';
import {
    handlePaymentSucceeded,
    handleSubscriptionDeleted,
} from '../../src/controllers/paymentWebhookHandlers';
import { paymentController } from '../../src/controllers/payment';

const DAY_MS = 24 * 60 * 60 * 1000;
let seq = 0;
const uid = () => `dn${Date.now()}${seq++}`;

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
const signer = new Stripe('sk_test_dummy', { apiVersion: '2023-10-16' });

function fakeRequest(): FastifyRequest {
    const noop = () => undefined;
    return { log: { info: noop, warn: noop, error: noop, debug: noop } } as unknown as FastifyRequest;
}

async function postWebhook(rawBody: string): Promise<{ statusCode: number }> {
    const captured = { statusCode: 200 };
    const reply = {
        status(code: number) { captured.statusCode = code; return reply; },
        send() { return reply; },
    } as unknown as FastifyReply;
    const request = {
        headers: { 'stripe-signature': signer.webhooks.generateTestHeaderString({ payload: rawBody, secret: WEBHOOK_SECRET }) },
        rawBody,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    } as unknown as FastifyRequest;
    await paymentController.handleWebhook(request, reply);
    return captured;
}

async function createPlan() {
    const [plan] = await testDb.insert(schema.plans).values({
        name: 'Pro', slug: `plan-${uid()}`, price: 7900,
        stripePriceId: `price_${uid()}`, trialDays: 0,
        maxAiRepliesPerMonth: 2000, maxTemplates: 20, maxRules: 20, isActive: true,
    }).returning();
    return plan;
}

/** A pre-grace-fix Nourva-shaped row: past_due with the period advanced into the unpaid month. */
async function seedStripePastDue(
    userId: string,
    planId: string,
    over: Partial<typeof schema.subscriptions.$inferInsert> = {},
) {
    const [sub] = await testDb.insert(schema.subscriptions).values({
        userId,
        planId,
        status: 'past_due',
        paymentMethod: 'stripe',
        externalSubscriptionId: `sub_${uid()}`,
        stripeCustomerId: `cus_${uid()}`,
        currentPeriodStart: new Date(Date.now() - 2 * DAY_MS),
        currentPeriodEnd: new Date(Date.now() + 28 * DAY_MS),
        ...over,
    }).returning();
    return sub;
}

function stubStripeSubscription(over: Record<string, unknown> = {}) {
    return vi.spyOn(stripeService, 'getSubscriptionWithLatestInvoice').mockImplementation(
        async (id: string) => ({
            id,
            object: 'subscription',
            status: 'past_due',
            latest_invoice: {
                id: `in_${id}`,
                status: 'open',
                hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
                amount_due: 7900,
                currency: 'usd',
            },
            ...over,
        } as unknown as Stripe.Response<Stripe.Subscription>),
    );
}

async function emailRows(userId: string, type: string) {
    return testDb.select().from(schema.emailSends)
        .where(and(eq(schema.emailSends.userId, userId), eq(schema.emailSends.type, type)));
}

async function subRow(id: string) {
    const [row] = await testDb.select().from(schema.subscriptions)
        .where(eq(schema.subscriptions.id, id));
    return row;
}

let realApiKey: string;

beforeEach(() => {
    // Resend: pretend configured and stub the transport — email_sends rows and
    // their status are what the assertions read, and those stay real.
    realApiKey = config.resend.apiKey;
    config.resend.apiKey = 're_test_dummy';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ id: `re_${uid()}` }),
        { status: 200, headers: { 'content-type': 'application/json' } },
    )));
});

afterEach(() => {
    config.resend.apiKey = realApiKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('dunning sweep — Nourva backfill shape', () => {
    it('emails a pre-existing past_due row exactly once across two runs', async () => {
        const user = await createTestUser({ email: `dn+${uid()}@example.com` });
        const plan = await createPlan();
        const sub = await seedStripePastDue(user.id, plan.id);
        stubStripeSubscription();

        const first = await runDunningNotices();
        expect(first.renewalFailed).toMatchObject({ due: 1, emailed: 1, errors: 0 });

        const sent = await emailRows(user.id, 'payment_failed');
        expect(sent).toHaveLength(1);
        expect(sent[0].status).toBe('sent');
        expect(sent[0].toEmail).toBe(user.email);
        expect(sent[0].htmlBody).toContain(`https://invoice.stripe.com/i/${sub.externalSubscriptionId}`);

        const stamped = await subRow(sub.id);
        expect(stamped.renewalFailureNotifiedAt).not.toBeNull();
        expect(stamped.suspensionNotifiedAt).toBeNull();

        // Run #2: the stamp keeps the row out of the window — zero new emails.
        const second = await runDunningNotices();
        expect(second.renewalFailed.due).toBe(0);
        expect(await emailRows(user.id, 'payment_failed')).toHaveLength(1);
    });

    it('suspends past-grace rows with the suspension email, not the renewal one', async () => {
        const user = await createTestUser({ email: `dn+${uid()}@example.com` });
        const plan = await createPlan();
        const sub = await seedStripePastDue(user.id, plan.id, {
            currentPeriodEnd: new Date(Date.now() - 5 * DAY_MS), // grace (3d) burned
        });
        stubStripeSubscription();

        const result = await runDunningNotices();
        expect(result.suspended).toMatchObject({ due: 1, emailed: 1 });
        expect(result.renewalFailed.due).toBe(0); // branch bounds are mutually exclusive

        expect(await emailRows(user.id, 'service_suspended')).toHaveLength(1);
        expect(await emailRows(user.id, 'payment_failed')).toHaveLength(0);

        const stamped = await subRow(sub.id);
        expect(stamped.suspensionNotifiedAt).not.toBeNull();
        // the claim co-set the renewal stamp so the milder email can never follow
        expect(stamped.renewalFailureNotifiedAt).not.toBeNull();
    });

    it('leaves a Stripe-canceled (drift) row un-stamped and un-emailed', async () => {
        const user = await createTestUser({ email: `dn+${uid()}@example.com` });
        const plan = await createPlan();
        const sub = await seedStripePastDue(user.id, plan.id);
        stubStripeSubscription({ status: 'canceled' });

        const result = await runDunningNotices();
        expect(result.renewalFailed.errors).toBe(1);

        expect(await emailRows(user.id, 'payment_failed')).toHaveLength(0);
        const row = await subRow(sub.id);
        expect(row.renewalFailureNotifiedAt).toBeNull();
    });
});

describe('payment recovery', () => {
    it('resets the episode and sends the confirmation exactly once', async () => {
        const user = await createTestUser({ email: `dn+${uid()}@example.com` });
        const plan = await createPlan();
        const sub = await seedStripePastDue(user.id, plan.id, {
            renewalFailureNotifiedAt: new Date(),
        });

        const periodStart = Math.floor(Date.now() / 1000);
        const periodEnd = periodStart + 30 * 24 * 60 * 60;
        vi.spyOn(stripeService, 'getSubscription').mockResolvedValue({
            id: sub.externalSubscriptionId,
            status: 'active',
            current_period_start: periodStart,
            current_period_end: periodEnd,
        } as unknown as Stripe.Response<Stripe.Subscription>);

        const invoice = {
            id: `in_${uid()}`,
            subscription: sub.externalSubscriptionId,
        } as unknown as Stripe.Invoice;

        await handlePaymentSucceeded(invoice, fakeRequest());

        const row = await subRow(sub.id);
        expect(row.status).toBe('active');
        expect(row.renewalFailureNotifiedAt).toBeNull();
        expect(row.suspensionNotifiedAt).toBeNull();
        expect(await emailRows(user.id, 'payment_recovered')).toHaveLength(1);

        // The next (normal) renewal opens no episode → no second confirmation.
        await handlePaymentSucceeded(
            { id: `in_${uid()}`, subscription: sub.externalSubscriptionId } as unknown as Stripe.Invoice,
            fakeRequest(),
        );
        expect(await emailRows(user.id, 'payment_recovered')).toHaveLength(1);
    });
});

describe('subscription deletion', () => {
    it('involuntary deletion cancels the row and emails the suspension notice', async () => {
        const user = await createTestUser({ email: `dn+${uid()}@example.com` });
        const plan = await createPlan();
        const sub = await seedStripePastDue(user.id, plan.id);

        await handleSubscriptionDeleted({
            id: sub.externalSubscriptionId,
            cancel_at_period_end: false,
            cancellation_details: { reason: 'payment_failed' },
        } as unknown as Stripe.Subscription, fakeRequest());

        const row = await subRow(sub.id);
        expect(row.status).toBe('canceled');
        expect(row.suspensionNotifiedAt).not.toBeNull();
        const sent = await emailRows(user.id, 'service_suspended');
        expect(sent).toHaveLength(1);
        expect(sent[0].htmlBody).toContain('/pricing'); // resubscribe CTA — invoices are dead
    });

    it('voluntary deletion cancels silently', async () => {
        const user = await createTestUser({ email: `dn+${uid()}@example.com` });
        const plan = await createPlan();
        const sub = await seedStripePastDue(user.id, plan.id, { status: 'active', cancelAtPeriodEnd: true });

        await handleSubscriptionDeleted({
            id: sub.externalSubscriptionId,
            cancel_at_period_end: true,
        } as unknown as Stripe.Subscription, fakeRequest());

        const row = await subRow(sub.id);
        expect(row.status).toBe('canceled');
        expect(await emailRows(user.id, 'service_suspended')).toHaveLength(0);
    });
});

describe('signed clover payload, end to end', () => {
    it('invoice.payment_failed through the real route sends the dunning email', async () => {
        const user = await createTestUser({ email: `dn+${uid()}@example.com` });
        const plan = await createPlan();
        const sub = await seedStripePastDue(user.id, plan.id, { status: 'active' });
        await testDb.delete(schema.stripeWebhookEvents);

        // 2025-12-15.clover shape: the subscription ref lives under
        // parent.subscription_details, NOT top-level.
        const body = JSON.stringify({
            id: `evt_${uid()}`,
            object: 'event',
            api_version: '2025-12-15.clover',
            created: Math.floor(Date.now() / 1000),
            type: 'invoice.payment_failed',
            data: {
                object: {
                    id: `in_${uid()}`,
                    object: 'invoice',
                    status: 'open',
                    billing_reason: 'subscription_cycle',
                    amount_due: 7900,
                    currency: 'usd',
                    hosted_invoice_url: 'https://invoice.stripe.com/i/clover_1',
                    parent: { subscription_details: { subscription: sub.externalSubscriptionId } },
                },
            },
        });

        const res = await postWebhook(body);
        expect(res.statusCode).toBe(200);

        const row = await subRow(sub.id);
        expect(row.status).toBe('past_due');
        expect(row.renewalFailureNotifiedAt).not.toBeNull();

        const sent = await emailRows(user.id, 'payment_failed');
        expect(sent).toHaveLength(1);
        expect(sent[0].status).toBe('sent');
        expect(sent[0].htmlBody).toContain('https://invoice.stripe.com/i/clover_1');

        // Stripe's NEXT retry attempt arrives as a NEW event id (the dedup
        // table can't absorb it) — the claim's IS NULL guard is the only thing
        // standing between the merchant and a daily repeat of this email.
        const retry = JSON.stringify({
            id: `evt_${uid()}`,
            object: 'event',
            api_version: '2025-12-15.clover',
            created: Math.floor(Date.now() / 1000),
            type: 'invoice.payment_failed',
            data: {
                object: {
                    id: `in_${uid()}`,
                    object: 'invoice',
                    status: 'open',
                    billing_reason: 'subscription_cycle',
                    amount_due: 7900,
                    currency: 'usd',
                    hosted_invoice_url: 'https://invoice.stripe.com/i/clover_1',
                    parent: { subscription_details: { subscription: sub.externalSubscriptionId } },
                },
            },
        });
        const retryRes = await postWebhook(retry);
        expect(retryRes.statusCode).toBe(200);
        expect(await emailRows(user.id, 'payment_failed')).toHaveLength(1);
    });
});
