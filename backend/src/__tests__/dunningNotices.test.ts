/**
 * Tests: the daily dunning sweep (runDunningNotices) through the real
 * lifecycleNoticeSweep engine in email-primary mode.
 * Verifies:
 *   - both branches' WHERE bounds are pinned to the exact ±GRACE_PERIOD_DAYS
 *     boundary, stamp-IS-NULL dedup filters included (backfill = deliberately
 *     no lookback bound on Branch A)
 *   - Branch B (suspension) runs BEFORE Branch A, and its claim co-sets the
 *     renewal stamp
 *   - the Nourva backfill shape: a past_due stripe row inside grace gets ONE
 *     payment_failed email carrying the CURRENT open invoice's hosted link
 *   - drift guards skip WITHOUT stamping: canceled at Stripe, non-open
 *     invoice, missing external id, missing email address
 *   - a failed send releases the stamp for tomorrow's retry
 *   - one bad row never aborts the sweep
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
    selectQueue,
    updateReturningQueue,
    updateCalls,
    trySendMock,
    getSubWithInvoiceMock,
    captureErrorMock,
    eqSpy,
    lteSpy,
    gtSpy,
    isNullSpy,
    isNotNullSpy,
} = vi.hoisted(() => ({
    selectQueue: { value: [] as unknown[][] },
    updateReturningQueue: { value: [] as unknown[][] },
    updateCalls: { value: [] as Record<string, unknown>[] },
    trySendMock: vi.fn(),
    getSubWithInvoiceMock: vi.fn(),
    captureErrorMock: vi.fn(),
    eqSpy: vi.fn(),
    lteSpy: vi.fn(),
    gtSpy: vi.fn(),
    isNullSpy: vi.fn(),
    isNotNullSpy: vi.fn(),
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

vi.mock('drizzle-orm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('drizzle-orm')>();
    return {
        ...actual,
        eq: (...args: Parameters<typeof actual.eq>) => { eqSpy(...args); return actual.eq(...args); },
        lte: (...args: Parameters<typeof actual.lte>) => { lteSpy(...args); return actual.lte(...args); },
        gt: (...args: Parameters<typeof actual.gt>) => { gtSpy(...args); return actual.gt(...args); },
        isNull: (...args: Parameters<typeof actual.isNull>) => { isNullSpy(...args); return actual.isNull(...args); },
        isNotNull: (...args: Parameters<typeof actual.isNotNull>) => { isNotNullSpy(...args); return actual.isNotNull(...args); },
    };
});

vi.mock('../services/email', () => ({
    emailService: {
        trySend: trySendMock,
        send: vi.fn(() => { throw new Error('sweep must use trySend'); }),
        setLogger: vi.fn(),
    },
}));

vi.mock('../services/stripe', () => ({
    stripeService: { getSubscriptionWithLatestInvoice: getSubWithInvoiceMock },
}));

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

import { runDunningNotices } from '../services/dunningNotices';
import { subscriptions } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-15T12:00:00Z');

function makeSweepRow(overrides: Record<string, unknown> = {}) {
    return {
        subscriptionId: 'db-sub-1',
        userId: 'user-1',
        trialEndsAt: null,
        currentPeriodEnd: new Date(NOW.getTime() - 2 * DAY_MS), // failed renewal 2d ago, inside 3d grace
        externalSubscriptionId: 'sub_stripe_1',
        email: 'merchant@example.com',
        name: 'Nour',
        dashboardLanguage: 'ar',
        ...overrides,
    };
}

function makeStripeState(overrides: {
    subStatus?: string;
    invoice?: Record<string, unknown> | null;
} = {}) {
    return {
        id: 'sub_stripe_1',
        status: overrides.subStatus ?? 'past_due',
        latest_invoice: overrides.invoice === undefined
            ? {
                id: 'in_9',
                status: 'open',
                hosted_invoice_url: 'https://invoice.stripe.com/i/pay_9',
                amount_due: 7900,
                currency: 'usd',
            }
            : overrides.invoice,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    selectQueue.value = [];
    updateReturningQueue.value = [];
    updateCalls.value = [];
    trySendMock.mockResolvedValue({ delivered: true });
    getSubWithInvoiceMock.mockResolvedValue(makeStripeState());
});

afterEach(() => {
    vi.useRealTimers();
});

describe('runDunningNotices — window bounds', () => {
    it('pins both branches to the exact grace boundary and the stamp dedup filters', async () => {
        selectQueue.value = [[], []];

        await runDunningNotices();

        const boundary = new Date(NOW.getTime() - 3 * DAY_MS);

        // Branch B: suspension — periodEnd <= now - 3d
        expect(lteSpy).toHaveBeenCalledWith(subscriptions.currentPeriodEnd, boundary);
        // Branch A: renewal-failed — periodEnd > now - 3d (mutually exclusive with B)
        expect(gtSpy).toHaveBeenCalledWith(subscriptions.currentPeriodEnd, boundary);

        // Dedup: each branch filters on ITS OWN stamp being NULL
        const isNullCols = isNullSpy.mock.calls.map((c) => c[0]);
        expect(isNullCols).toContain(subscriptions.suspensionNotifiedAt);
        expect(isNullCols).toContain(subscriptions.renewalFailureNotifiedAt);

        // Both branches scope to the Stripe rail's past_due rows
        expect(eqSpy).toHaveBeenCalledWith(subscriptions.paymentMethod, 'stripe');
        expect(eqSpy).toHaveBeenCalledWith(subscriptions.status, 'past_due');

        // Branch B requires a period end to compute "stopped since"
        expect(isNotNullSpy).toHaveBeenCalledWith(subscriptions.currentPeriodEnd);
    });

    it('runs the suspension branch BEFORE the renewal branch', async () => {
        selectQueue.value = [
            [makeSweepRow({ subscriptionId: 'db-sub-B', currentPeriodEnd: new Date(NOW.getTime() - 5 * DAY_MS) })],
            [makeSweepRow({ subscriptionId: 'db-sub-A' })],
        ];
        updateReturningQueue.value = [[{ id: 'db-sub-B' }], [{ id: 'db-sub-A' }]];

        await runDunningNotices();

        expect(trySendMock).toHaveBeenCalledTimes(2);
        expect(trySendMock.mock.calls[0][0].type).toBe('service_suspended');
        expect(trySendMock.mock.calls[1][0].type).toBe('payment_failed');
    });
});

describe('runDunningNotices — Branch A (renewal-failed catch-up / backfill)', () => {
    it('emails the Nourva shape once with the CURRENT open invoice link', async () => {
        selectQueue.value = [[], [makeSweepRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed).toMatchObject({ due: 1, notified: 1, emailed: 1, errors: 0 });
        expect(getSubWithInvoiceMock).toHaveBeenCalledWith('sub_stripe_1');
        const payload = trySendMock.mock.calls[0][0];
        expect(payload.type).toBe('payment_failed');
        expect(payload.idempotencyKey).toBe('payment_failed:in_9');
        expect(payload.html).toContain('https://invoice.stripe.com/i/pay_9');
        // one update: the claim; nothing released it
        expect(updateCalls.value).toHaveLength(1);
        expect(updateCalls.value[0].renewalFailureNotifiedAt).toBeInstanceOf(Date);
    });

    it('skips un-stamped when the row is canceled at Stripe (missed webhook drift)', async () => {
        selectQueue.value = [[], [makeSweepRow()]];
        getSubWithInvoiceMock.mockResolvedValue(makeStripeState({ subStatus: 'canceled' }));

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed.errors).toBe(1);
        expect(trySendMock).not.toHaveBeenCalled();
        expect(updateCalls.value).toHaveLength(0);
        expect(captureErrorMock).toHaveBeenCalled();
    });

    it('skips un-stamped when there is no open invoice', async () => {
        selectQueue.value = [[], [makeSweepRow()]];
        getSubWithInvoiceMock.mockResolvedValue(makeStripeState({ invoice: { id: 'in_9', status: 'paid' } }));

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed.errors).toBe(1);
        expect(trySendMock).not.toHaveBeenCalled();
        expect(updateCalls.value).toHaveLength(0);
    });

    it('skips un-stamped when the stripe row carries no external subscription id', async () => {
        selectQueue.value = [[], [makeSweepRow({ externalSubscriptionId: null })]];

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed.errors).toBe(1);
        expect(getSubWithInvoiceMock).not.toHaveBeenCalled();
        expect(trySendMock).not.toHaveBeenCalled();
    });

    it('skips un-stamped (and never calls Stripe) when the row has no email', async () => {
        selectQueue.value = [[], [makeSweepRow({ email: null })]];

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed.errors).toBe(1);
        expect(getSubWithInvoiceMock).not.toHaveBeenCalled();
        expect(updateCalls.value).toHaveLength(0);
        expect(captureErrorMock).toHaveBeenCalled();
    });

    it('releases the stamp when the send does not go out', async () => {
        selectQueue.value = [[], [makeSweepRow()]];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];
        trySendMock.mockResolvedValue({ delivered: false, error: 'HTTP 500' });

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed.errors).toBe(1);
        expect(updateCalls.value).toHaveLength(2);
        expect(updateCalls.value[1]).toEqual({ renewalFailureNotifiedAt: null });
    });

    it('continues past a row whose Stripe fetch explodes', async () => {
        selectQueue.value = [[], [
            makeSweepRow({ subscriptionId: 'db-bad', externalSubscriptionId: 'sub_bad' }),
            makeSweepRow({ subscriptionId: 'db-good', externalSubscriptionId: 'sub_good' }),
        ]];
        getSubWithInvoiceMock
            .mockRejectedValueOnce(new Error('stripe 500'))
            .mockResolvedValueOnce(makeStripeState());
        updateReturningQueue.value = [[{ id: 'db-good' }]];

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed).toMatchObject({ due: 2, emailed: 1, errors: 1 });
        expect(trySendMock).toHaveBeenCalledTimes(1);
    });

    it('does not send when another trigger already claimed the episode', async () => {
        selectQueue.value = [[], [makeSweepRow()]];
        updateReturningQueue.value = [[]]; // webhook path won the race

        const { renewalFailed } = await runDunningNotices();

        expect(renewalFailed.emailed).toBe(0);
        expect(trySendMock).not.toHaveBeenCalled();
    });
});

describe('runDunningNotices — Branch B (suspension)', () => {
    const pastGraceRow = () => makeSweepRow({ currentPeriodEnd: new Date(NOW.getTime() - 5 * DAY_MS) });

    it('emails the pay variant when an open invoice is still payable', async () => {
        selectQueue.value = [[pastGraceRow()], []];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        const { suspended } = await runDunningNotices();

        expect(suspended).toMatchObject({ due: 1, emailed: 1, errors: 0 });
        const payload = trySendMock.mock.calls[0][0];
        expect(payload.type).toBe('service_suspended');
        expect(payload.idempotencyKey).toBe('service_suspended:sub_stripe_1');
        expect(payload.html).toContain('https://invoice.stripe.com/i/pay_9');
        // the claim co-sets the renewal stamp (COALESCE) so the milder
        // "service still runs" email can never follow the suspension notice
        expect(updateCalls.value[0].suspensionNotifiedAt).toBeInstanceOf(Date);
        expect(updateCalls.value[0].renewalFailureNotifiedAt).toBeDefined();
    });

    it('falls back to the resubscribe variant when Stripe already canceled', async () => {
        selectQueue.value = [[pastGraceRow()], []];
        getSubWithInvoiceMock.mockResolvedValue(makeStripeState({ subStatus: 'canceled', invoice: null }));
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];

        const { suspended } = await runDunningNotices();

        expect(suspended.emailed).toBe(1);
        expect(trySendMock.mock.calls[0][0].html).toContain('https://jawab24.com/ar/pricing');
    });

    it('releases the suspension stamp when the send fails', async () => {
        selectQueue.value = [[pastGraceRow()], []];
        updateReturningQueue.value = [[{ id: 'db-sub-1' }]];
        trySendMock.mockResolvedValue({ delivered: false, error: 'HTTP 500' });

        const { suspended } = await runDunningNotices();

        expect(suspended.errors).toBe(1);
        expect(updateCalls.value[1]).toEqual({ suspensionNotifiedAt: null });
    });
});
