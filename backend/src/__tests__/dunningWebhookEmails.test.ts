/**
 * Tests: webhook-path dunning notices (services/dunningNotices.ts).
 * Verifies:
 *   - payment_failed email fires once per failure episode with the invoice's
 *     hosted URL, amount, and idempotency key — and the claim absorbs Stripe's
 *     per-retry event repeats
 *   - `billing_reason=subscription_create` (in-checkout failure) never emails
 *   - a row past the grace boundary is left to the suspension flow
 *   - a failed send RELEASES the stamp so the sweep retries tomorrow
 *   - the implementation uses trySend, never send (send here throws on purpose)
 *   - clover-shaped invoices (parent.subscription_details.subscription) resolve
 *   - subscription.deleted: involuntary (payment_failed reason / prior
 *     past_due) emails the suspension notice; voluntary cancels never do
 *   - payment recovery: the atomic stamp-reset is the claim — an open episode
 *     sends the confirmation once, a normal renewal sends nothing, and a
 *     failed confirmation send does NOT re-open the episode
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

const {
    selectQueue,
    updateReturningQueue,
    updateCalls,
    trySendMock,
    sendForbiddenMock,
    getSubWithInvoiceMock,
    captureErrorMock,
} = vi.hoisted(() => ({
    /** One entry per SELECT issued; shifted in call order. */
    selectQueue: { value: [] as unknown[][] },
    /** One entry per UPDATE that calls .returning(); shifted in call order. */
    updateReturningQueue: { value: [] as unknown[][] },
    /** Every .set() payload, in call order. */
    updateCalls: { value: [] as Record<string, unknown>[] },
    trySendMock: vi.fn(),
    sendForbiddenMock: vi.fn(() => {
        throw new Error('emailService.send must never be used on the dunning path — use trySend');
    }),
    getSubWithInvoiceMock: vi.fn(),
    captureErrorMock: vi.fn(),
}));

vi.mock('../db', () => {
    const makeSelect = () => {
        const rows = selectQueue.value.shift() ?? [];
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn(() => chain);
        chain.innerJoin = vi.fn(() => chain);
        chain.leftJoin = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve(rows));
        (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
        return chain;
    };
    const makeUpdate = () => {
        const chain: Record<string, unknown> = {};
        chain.set = vi.fn((v: Record<string, unknown>) => { updateCalls.value.push(v); return chain; });
        chain.where = vi.fn(() => chain);
        chain.returning = vi.fn(() => Promise.resolve(updateReturningQueue.value.shift() ?? []));
        (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res);
        return chain;
    };
    return {
        db: {
            select: vi.fn(() => makeSelect()),
            update: vi.fn(() => makeUpdate()),
        },
    };
});

vi.mock('../services/email', () => ({
    emailService: { trySend: trySendMock, send: sendForbiddenMock, setLogger: vi.fn() },
}));

vi.mock('../services/stripe', () => ({
    stripeService: { getSubscriptionWithLatestInvoice: getSubWithInvoiceMock },
}));

// dunningNotices needs only the grace constant from the subscriptions service;
// importing the real module would drag in redis and the whole gate.
vi.mock('../services/subscriptions', () => ({ GRACE_PERIOD_DAYS: 3 }));

vi.mock('../services/notifications', () => ({
    notificationService: { sendNotification: vi.fn() },
}));

vi.mock('../utils/sentryHelpers', () => ({ captureError: captureErrorMock }));

vi.mock('../config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        resend: { fromName: 'Jawab24' },
        redis: { host: '127.0.0.1', port: 6379, password: undefined },
    },
}));

import {
    notifyRenewalFailed,
    prepareSubscriptionDeletedNotice,
    sendSubscriptionDeletedNotice,
    handlePaymentRecovery,
} from '../services/dunningNotices';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRow(overrides: Record<string, unknown> = {}) {
    return {
        subscriptionId: 'db-sub-1',
        userId: 'user-1',
        status: 'past_due',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 1 * DAY_MS), // inside grace
        renewalFailureNotifiedAt: null,
        suspensionNotifiedAt: null,
        email: 'merchant@example.com',
        name: 'Nour',
        dashboardLanguage: 'ar',
        ...overrides,
    };
}

function makeInvoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
    return {
        id: 'in_1',
        subscription: 'sub_stripe_1',
        hosted_invoice_url: 'https://invoice.stripe.com/i/pay_1',
        amount_due: 7900,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
        status: 'open',
        ...overrides,
    } as unknown as Stripe.Invoice;
}

beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.value = [];
    updateReturningQueue.value = [];
    updateCalls.value = [];
    trySendMock.mockResolvedValue({ delivered: true });
});

describe('notifyRenewalFailed', () => {
    it('claims the stamp and emails the hosted invoice link once', async () => {
        selectQueue.value = [[makeRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]]; // claim succeeds

        await notifyRenewalFailed(makeInvoice());

        expect(trySendMock).toHaveBeenCalledTimes(1);
        const payload = trySendMock.mock.calls[0][0];
        expect(payload.to).toBe('merchant@example.com');
        expect(payload.type).toBe('payment_failed');
        expect(payload.userId).toBe('user-1');
        expect(payload.idempotencyKey).toBe('payment_failed:in_1');
        expect(payload.html).toContain('https://invoice.stripe.com/i/pay_1');
        expect(payload.html).toContain('dir="rtl"'); // ar dashboard language
        // the claim wrote the stamp and nothing released it
        expect(updateCalls.value).toHaveLength(1);
        expect(updateCalls.value[0].renewalFailureNotifiedAt).toBeInstanceOf(Date);
    });

    it('never uses emailService.send (trySend is the contract)', async () => {
        selectQueue.value = [[makeRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        await notifyRenewalFailed(makeInvoice());

        expect(sendForbiddenMock).not.toHaveBeenCalled();
    });

    it('skips first-invoice failures (billing_reason=subscription_create)', async () => {
        await notifyRenewalFailed(makeInvoice({ billing_reason: 'subscription_create' }));

        expect(trySendMock).not.toHaveBeenCalled();
        expect(updateCalls.value).toHaveLength(0);
    });

    it('does nothing when the episode is already notified (claim denied)', async () => {
        selectQueue.value = [[makeRow()]];
        updateReturningQueue.value = [[]]; // stamp already set

        await notifyRenewalFailed(makeInvoice());

        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('releases the stamp when the send does not go out', async () => {
        selectQueue.value = [[makeRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];
        trySendMock.mockResolvedValue({ delivered: false, error: 'HTTP 500' });

        await notifyRenewalFailed(makeInvoice());

        // claim, then release
        expect(updateCalls.value).toHaveLength(2);
        expect(updateCalls.value[1]).toEqual({ renewalFailureNotifiedAt: null });
        expect(captureErrorMock).toHaveBeenCalled();
    });

    it('leaves rows past the grace boundary to the suspension flow', async () => {
        selectQueue.value = [[makeRow({ currentPeriodEnd: new Date(Date.now() - 5 * DAY_MS) })]];

        await notifyRenewalFailed(makeInvoice());

        expect(trySendMock).not.toHaveBeenCalled();
        expect(updateCalls.value).toHaveLength(0);
    });

    it('captures rows with no email address without stamping them', async () => {
        selectQueue.value = [[makeRow({ email: null })]];

        await notifyRenewalFailed(makeInvoice());

        expect(trySendMock).not.toHaveBeenCalled();
        expect(updateCalls.value).toHaveLength(0);
        expect(captureErrorMock).toHaveBeenCalled();
    });

    it('resolves the subscription id from a clover-shaped invoice', async () => {
        selectQueue.value = [[makeRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        await notifyRenewalFailed(makeInvoice({
            subscription: undefined,
            parent: { subscription_details: { subscription: 'sub_stripe_1' } },
        }));

        expect(trySendMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to the dashboard when the invoice has no hosted URL', async () => {
        selectQueue.value = [[makeRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        await notifyRenewalFailed(makeInvoice({ hosted_invoice_url: undefined }));

        expect(trySendMock.mock.calls[0][0].html).toContain('https://jawab24.com/dashboard');
    });

    it('never throws, even when the row lookup explodes', async () => {
        selectQueue.value = []; // queue empty → limit resolves [] — force a throw instead:
        trySendMock.mockRejectedValue(new Error('boom'));
        selectQueue.value = [[makeRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        await expect(notifyRenewalFailed(makeInvoice())).resolves.toBeUndefined();
        expect(captureErrorMock).toHaveBeenCalled();
    });
});

describe('subscription-deleted suspension notice', () => {
    function makeStripeSub(overrides: Record<string, unknown> = {}): Stripe.Subscription {
        return {
            id: 'sub_stripe_1',
            cancel_at_period_end: false,
            ...overrides,
        } as unknown as Stripe.Subscription;
    }

    it('emails when Stripe cancels for payment failure', async () => {
        selectQueue.value = [[makeRow()]];
        const ctx = await prepareSubscriptionDeletedNotice('sub_stripe_1');
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]]; // suspension claim

        await sendSubscriptionDeletedNotice(ctx, makeStripeSub({
            cancellation_details: { reason: 'payment_failed' },
        }));

        expect(trySendMock).toHaveBeenCalledTimes(1);
        const payload = trySendMock.mock.calls[0][0];
        expect(payload.type).toBe('service_suspended');
        expect(payload.idempotencyKey).toBe('service_suspended:sub_stripe_1');
        // resubscribe variant — deleted subs' invoices are not payable
        expect(payload.html).toContain('https://jawab24.com/ar/pricing');
        // the claim co-sets the renewal stamp so the milder email can't follow
        expect(updateCalls.value[0].suspensionNotifiedAt).toBeInstanceOf(Date);
        expect(updateCalls.value[0].renewalFailureNotifiedAt).toBeDefined();
    });

    it('emails on prior past_due status even without cancellation_details', async () => {
        selectQueue.value = [[makeRow({ status: 'past_due' })]];
        const ctx = await prepareSubscriptionDeletedNotice('sub_stripe_1');
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        await sendSubscriptionDeletedNotice(ctx, makeStripeSub());

        expect(trySendMock).toHaveBeenCalledTimes(1);
    });

    it('stays silent on a voluntary cancellation (cancel_at_period_end)', async () => {
        selectQueue.value = [[makeRow({ status: 'past_due' })]];
        const ctx = await prepareSubscriptionDeletedNotice('sub_stripe_1');

        await sendSubscriptionDeletedNotice(ctx, makeStripeSub({ cancel_at_period_end: true }));

        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('stays silent when the merchant asked to cancel (cancellation_requested)', async () => {
        selectQueue.value = [[makeRow({ status: 'past_due' })]];
        const ctx = await prepareSubscriptionDeletedNotice('sub_stripe_1');

        await sendSubscriptionDeletedNotice(ctx, makeStripeSub({
            cancellation_details: { reason: 'cancellation_requested' },
        }));

        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('stays silent for an active row with no failure history', async () => {
        selectQueue.value = [[makeRow({ status: 'active' })]];
        const ctx = await prepareSubscriptionDeletedNotice('sub_stripe_1');

        await sendSubscriptionDeletedNotice(ctx, makeStripeSub());

        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('sends nothing twice — the suspension claim is the once-guard', async () => {
        selectQueue.value = [[makeRow()]];
        const ctx = await prepareSubscriptionDeletedNotice('sub_stripe_1');
        updateReturningQueue.value = [[]]; // already claimed

        await sendSubscriptionDeletedNotice(ctx, makeStripeSub({
            cancellation_details: { reason: 'payment_failed' },
        }));

        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('releases only the suspension stamp when the send fails', async () => {
        selectQueue.value = [[makeRow()]];
        const ctx = await prepareSubscriptionDeletedNotice('sub_stripe_1');
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];
        trySendMock.mockResolvedValue({ delivered: false, error: 'HTTP 500' });

        await sendSubscriptionDeletedNotice(ctx, makeStripeSub({
            cancellation_details: { reason: 'payment_failed' },
        }));

        expect(updateCalls.value).toHaveLength(2);
        expect(updateCalls.value[1]).toEqual({ suspensionNotifiedAt: null });
    });
});

describe('handlePaymentRecovery', () => {
    it('resets the stamps and sends the confirmation when an episode was open', async () => {
        updateReturningQueue.value = [[{ subscriptionId: 'db-sub-1', userId: 'user-1' }]]; // reset matched
        selectQueue.value = [[makeRow()]];

        await handlePaymentRecovery('sub_stripe_1', 'in_2', new Date('2026-09-13T19:41:00Z'));

        expect(updateCalls.value[0]).toEqual({ renewalFailureNotifiedAt: null, suspensionNotifiedAt: null });
        expect(trySendMock).toHaveBeenCalledTimes(1);
        const payload = trySendMock.mock.calls[0][0];
        expect(payload.type).toBe('payment_recovered');
        expect(payload.idempotencyKey).toBe('payment_recovered:in_2');
    });

    it('sends nothing on a normal renewal (no open episode)', async () => {
        updateReturningQueue.value = [[]]; // reset matched zero rows

        await handlePaymentRecovery('sub_stripe_1', 'in_2', new Date());

        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('skips the email (but still resets) when Stripe returned no period end', async () => {
        updateReturningQueue.value = [[{ subscriptionId: 'db-sub-1', userId: 'user-1' }]];
        selectQueue.value = [[makeRow()]];

        await handlePaymentRecovery('sub_stripe_1', 'in_2', null);

        expect(updateCalls.value).toHaveLength(1); // the reset only
        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('does NOT re-open the episode when the confirmation fails to send', async () => {
        updateReturningQueue.value = [[{ subscriptionId: 'db-sub-1', userId: 'user-1' }]];
        selectQueue.value = [[makeRow()]];
        trySendMock.mockResolvedValue({ delivered: false, error: 'HTTP 500' });

        await handlePaymentRecovery('sub_stripe_1', 'in_2', new Date());

        expect(updateCalls.value).toHaveLength(1); // no release — episode stays closed
    });
});
