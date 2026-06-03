import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable, awaitable query stub: every builder method returns the same
// object, and awaiting it (or any terminal like .returning()) resolves to the
// queued result. db.insert/update/select each shift one result off the queue
// in call order.
let resultQueue: unknown[] = [];
function chain() {
    const result = resultQueue.shift();
    const obj: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'returning']) {
        obj[m] = () => obj;
    }
    obj.then = (resolve: (v: unknown) => void) => resolve(result);
    return obj;
}

const insertMock = vi.fn(() => chain());
const updateMock = vi.fn(() => chain());
const selectMock = vi.fn(() => chain());

vi.mock('../../src/db', () => ({
    db: {
        insert: (...a: unknown[]) => insertMock(...a),
        update: (...a: unknown[]) => updateMock(...a),
        select: (...a: unknown[]) => selectMock(...a),
    },
}));

vi.mock('../../src/db/schema', () => ({
    paymentRequests: {
        id: 'id',
        userId: 'user_id',
        status: 'status',
        stripeCheckoutSessionId: 'stripe_checkout_session_id',
        createdAt: 'created_at',
    },
}));

const getCheckoutSession = vi.fn();
vi.mock('../../src/services/stripe', () => ({
    stripeService: { getCheckoutSession: (...a: unknown[]) => getCheckoutSession(...a) },
    stripeRefId: (ref: string | { id: string } | null | undefined) =>
        !ref ? null : typeof ref === 'string' ? ref : ref.id,
}));

const captureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...a: unknown[]) => captureError(...a),
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...conds) => ({ conds, op: 'and' })),
    desc: vi.fn((f) => ({ f, op: 'desc' })),
    lt: vi.fn((field, value) => ({ field, value, op: 'lt' })),
}));

import { paymentRequestService } from '../../src/services/paymentRequest';

beforeEach(() => {
    resultQueue = [];
    insertMock.mockClear();
    updateMock.mockClear();
    selectMock.mockClear();
    getCheckoutSession.mockReset();
    captureError.mockClear();
});

describe('paymentRequestService.markPaid', () => {
    it('returns true and flips the row when a pending row matches', async () => {
        resultQueue = [[{ id: 'pr_1' }]]; // update().returning() → one row
        const flipped = await paymentRequestService.markPaid('cs_1', 'pi_1');
        expect(flipped).toBe(true);
        expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it('returns false on webhook replay (no pending row matches) — idempotent', async () => {
        resultQueue = [[]]; // update().returning() → zero rows (already paid)
        const flipped = await paymentRequestService.markPaid('cs_1', 'pi_1');
        expect(flipped).toBe(false);
    });

    it('never issues an insert or a users/balance write (collect-only)', async () => {
        resultQueue = [[{ id: 'pr_1' }]];
        await paymentRequestService.markPaid('cs_1', null);
        expect(insertMock).not.toHaveBeenCalled();
    });
});

describe('paymentRequestService.reconcilePending', () => {
    it('marks a pending row paid when Stripe says the session is paid (missed webhook)', async () => {
        resultQueue = [
            [{ stripeCheckoutSessionId: 'cs_1' }], // select pending rows
            [{ id: 'pr_1' }],                       // markPaid update().returning() → flipped
        ];
        getCheckoutSession.mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_1', status: 'complete' });

        const r = await paymentRequestService.reconcilePending();
        expect(r.paid).toBe(1);
        expect(r.expired).toBe(0);
        expect(r.stillPending).toBe(0);
        expect(r.errors).toBe(0);
    });

    it('counts a paid session the webhook already settled as alreadySettled, not paid', async () => {
        resultQueue = [
            [{ stripeCheckoutSessionId: 'cs_1' }],
            [], // markPaid → no row flipped (already paid by webhook)
        ];
        getCheckoutSession.mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_1', status: 'complete' });

        const r = await paymentRequestService.reconcilePending();
        expect(r.paid).toBe(0);
        expect(r.alreadySettled).toBe(1);
        expect(r.stillPending).toBe(0);
    });

    it('marks an expired Stripe session expired', async () => {
        resultQueue = [
            [{ stripeCheckoutSessionId: 'cs_1' }],
            [{ id: 'pr_1' }], // expired transition → status-gated update returns the flipped row
        ];
        getCheckoutSession.mockResolvedValueOnce({ payment_status: 'unpaid', status: 'expired' });

        const r = await paymentRequestService.reconcilePending();
        expect(r.expired).toBe(1);
        expect(r.paid).toBe(0);
    });

    it('leaves an in-flight (unpaid, open) session pending', async () => {
        resultQueue = [[{ stripeCheckoutSessionId: 'cs_1' }]];
        getCheckoutSession.mockResolvedValueOnce({ payment_status: 'unpaid', status: 'open' });

        const r = await paymentRequestService.reconcilePending();
        expect(r.stillPending).toBe(1);
        expect(r.paid).toBe(0);
        expect(r.expired).toBe(0);
    });

    it('isolates a per-row Stripe error, continues, and reports it once via Sentry', async () => {
        resultQueue = [
            [{ stripeCheckoutSessionId: 'cs_err' }, { stripeCheckoutSessionId: 'cs_ok' }],
            [{ id: 'pr_ok' }], // markPaid for the second (healthy) row
        ];
        getCheckoutSession
            .mockRejectedValueOnce(new Error('stripe boom'))
            .mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_ok', status: 'complete' });

        const r = await paymentRequestService.reconcilePending();
        expect(r.errors).toBe(1);
        expect(r.paid).toBe(1);
        expect(captureError).toHaveBeenCalledTimes(1);
    });

    it('no-ops cleanly when there are no aged pending rows', async () => {
        resultQueue = [[]];
        const r = await paymentRequestService.reconcilePending();
        expect(r.scanned).toBe(0);
        expect(getCheckoutSession).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });
});
