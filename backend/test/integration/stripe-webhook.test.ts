/**
 * Stripe webhook entry — REAL signature verification + idempotency.
 *
 * Unlike payment.test.ts (which mocks the stripe service and tests the
 * individual handlers), this file exercises paymentController.handleWebhook
 * end-to-end with genuinely signed payloads through the real
 * stripe.webhooks.constructEvent path and the real stripe_webhook_events
 * dedup table. Only the dispatch boundary (event handlers) is mocked.
 *
 * Notably proves the SDK's built-in replay protection: constructEvent
 * rejects signatures whose timestamp is outside the 300s tolerance, so a
 * captured webhook cannot be replayed later.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { testDb } from './setup';
import * as schema from '../../src/db/schema';

// Mock ONLY the dispatch boundary — signature verification and the dedup
// table logic in handleWebhook stay real.
vi.mock('../../src/controllers/paymentWebhookHandlers', () => ({
    dispatchStripeEvent: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchStripeEvent } from '../../src/controllers/paymentWebhookHandlers';
import { paymentController } from '../../src/controllers/payment';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
// Client never talks to the network here — only the webhooks util is used.
const stripe = new Stripe('sk_test_dummy', { apiVersion: '2023-10-16' });

function eventPayload(id: string, type = 'checkout.session.completed'): string {
    return JSON.stringify({
        id,
        object: 'event',
        api_version: '2023-10-16',
        created: Math.floor(Date.now() / 1000),
        type,
        data: { object: { id: 'cs_test_abc', object: 'checkout.session' } },
    });
}

function sign(payload: string, opts: { timestamp?: number } = {}): string {
    return stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
        ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
    });
}

interface CapturedReply {
    statusCode: number;
    payload: unknown;
}

function buildReplyStub(captured: CapturedReply): FastifyReply {
    const reply = {
        status(code: number) {
            captured.statusCode = code;
            return reply;
        },
        send(payload: unknown) {
            captured.payload = payload;
            return reply;
        },
    };
    return reply as unknown as FastifyReply;
}

function buildRequest(rawBody: string | undefined, signature: string | undefined): FastifyRequest {
    const noop = () => undefined;
    return {
        headers: signature ? { 'stripe-signature': signature } : {},
        rawBody,
        log: { info: noop, warn: noop, error: noop },
    } as unknown as FastifyRequest;
}

async function postWebhook(rawBody: string | undefined, signature: string | undefined): Promise<CapturedReply> {
    const captured: CapturedReply = { statusCode: 200, payload: undefined };
    await paymentController.handleWebhook(buildRequest(rawBody, signature), buildReplyStub(captured));
    return captured;
}

async function eventRows(eventId: string) {
    return testDb
        .select()
        .from(schema.stripeWebhookEvents)
        .where(eq(schema.stripeWebhookEvents.eventId, eventId));
}

describe('Stripe webhook — signature verification + idempotency (integration)', () => {
    beforeEach(async () => {
        // stripe_webhook_events is not in the shared truncation list
        await testDb.delete(schema.stripeWebhookEvents);
        vi.mocked(dispatchStripeEvent).mockClear();
        vi.mocked(dispatchStripeEvent).mockResolvedValue(undefined);
    });

    it('accepts a correctly signed event, dispatches once, marks the row completed', async () => {
        const payload = eventPayload('evt_ok_1');
        const res = await postWebhook(payload, sign(payload));

        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({ received: true });
        expect(dispatchStripeEvent).toHaveBeenCalledTimes(1);

        const rows = await eventRows('evt_ok_1');
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('completed');
    });

    it('skips a duplicate completed event without re-dispatching (Stripe retry safety)', async () => {
        const payload = eventPayload('evt_dup_1');
        await postWebhook(payload, sign(payload));
        const second = await postWebhook(payload, sign(payload));

        expect(second.statusCode).toBe(200);
        expect(second.payload).toEqual({ received: true });
        expect(dispatchStripeEvent).toHaveBeenCalledTimes(1);
        expect(await eventRows('evt_dup_1')).toHaveLength(1);
    });

    it('rejects a tampered payload with 400 and never dispatches', async () => {
        const payload = eventPayload('evt_tamper_1');
        const signature = sign(payload);
        const tampered = payload.replace('checkout.session.completed', 'payment_intent.succeeded');

        const res = await postWebhook(tampered, signature);

        expect(res.statusCode).toBe(400);
        expect(dispatchStripeEvent).not.toHaveBeenCalled();
        expect(await eventRows('evt_tamper_1')).toHaveLength(0);
    });

    it('rejects a replayed (stale-timestamp) signature — SDK 300s tolerance', async () => {
        const payload = eventPayload('evt_replay_1');
        const staleSignature = sign(payload, { timestamp: Math.floor(Date.now() / 1000) - 600 });

        const res = await postWebhook(payload, staleSignature);

        expect(res.statusCode).toBe(400);
        expect(dispatchStripeEvent).not.toHaveBeenCalled();
    });

    it('rejects a missing signature header with 400', async () => {
        const res = await postWebhook(eventPayload('evt_nosig_1'), undefined);
        expect(res.statusCode).toBe(400);
        expect(dispatchStripeEvent).not.toHaveBeenCalled();
    });

    it('skips an event still processing (not stale) without re-dispatching', async () => {
        await testDb.insert(schema.stripeWebhookEvents).values({
            eventId: 'evt_inflight_1',
            eventType: 'checkout.session.completed',
            status: 'processing',
            processedAt: new Date(),
        });

        const payload = eventPayload('evt_inflight_1');
        const res = await postWebhook(payload, sign(payload));

        expect(res.statusCode).toBe(200);
        expect(dispatchStripeEvent).not.toHaveBeenCalled();
    });

    it('retries a STALE processing event (crashed handler recovery) and completes it', async () => {
        await testDb.insert(schema.stripeWebhookEvents).values({
            eventId: 'evt_stale_1',
            eventType: 'checkout.session.completed',
            status: 'processing',
            processedAt: new Date(Date.now() - 10 * 60 * 1000),
        });

        const payload = eventPayload('evt_stale_1');
        const res = await postWebhook(payload, sign(payload));

        expect(res.statusCode).toBe(200);
        expect(dispatchStripeEvent).toHaveBeenCalledTimes(1);
        const rows = await eventRows('evt_stale_1');
        expect(rows[0].status).toBe('completed');
    });

    it('returns 500 and leaves the row processing when the handler fails (Stripe will retry)', async () => {
        vi.mocked(dispatchStripeEvent).mockRejectedValueOnce(new Error('handler exploded'));

        const payload = eventPayload('evt_fail_1');
        const res = await postWebhook(payload, sign(payload));

        expect(res.statusCode).toBe(500);
        const rows = await eventRows('evt_fail_1');
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('processing');
    });
});
