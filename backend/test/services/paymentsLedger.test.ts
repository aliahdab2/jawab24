import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The payments ledger's two pure rules, plus the write path's non-negotiables.
 *
 * `isUnpaid` and `commissionCentsFor` are exported and tested directly rather
 * than re-implemented in the test — a test that inlines the expression drifts
 * silently the day the expression changes (AI_INSTRUCTIONS Rule 19.3).
 */

const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn(),
};
const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
};

vi.mock('../../src/db', () => ({
    db: { insert: vi.fn(() => insertChain), select: vi.fn(() => selectChain), update: vi.fn() },
}));
vi.mock('../../src/db/schema', () => ({
    payments: { id: 'id', userId: 'user_id', idempotencyKey: 'idempotency_key', status: 'status' },
    partners: { id: 'id', commissionPct: 'commission_pct', name: 'name' },
    users: { id: 'id', partnerId: 'partner_id', name: 'name', phone: 'phone', createdAt: 'created_at' },
    adminAuditLogs: {},
}));
vi.mock('drizzle-orm', () => ({
    and: vi.fn(), desc: vi.fn(), eq: vi.fn(), inArray: vi.fn(), isNull: vi.fn(),
    sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}));

import {
    paymentsService,
    commissionCentsFor,
    isUnpaid,
    PaymentValidationError,
    MAX_PAYMENT_CENTS,
} from '../../src/services/payments';

const NOW = new Date('2026-08-16T12:00:00Z');

describe('commissionCentsFor', () => {
    it('takes the stated percentage of the gross', () => {
        // The owner's own example: $790 collected, 20% to the rep.
        expect(commissionCentsFor(79000, 20)).toBe(15800);
    });

    it('rounds to the cent instead of leaving fractional cents', () => {
        // 15% of $33.33 = 499.95 cents — a fractional cent cannot be stored,
        // and truncating would silently under-pay the rep on every odd amount.
        expect(commissionCentsFor(3333, 15)).toBe(500);
    });

    it('is zero when no partner rate applies', () => {
        expect(commissionCentsFor(79000, 0)).toBe(0);
    });
});

describe('isUnpaid', () => {
    const base = { subscriptionStatus: 'active', currentPeriodEnd: null as Date | null, coveredUntil: null as Date | null };

    it('never flags a merchant who is still on trial', () => {
        // A trial has nothing to pay yet — flagging it would send the rep
        // chasing money that is not owed.
        expect(isUnpaid({ ...base, subscriptionStatus: 'trialing', currentPeriodEnd: new Date('2026-08-01') }, NOW)).toBe(false);
    });

    it('never flags a merchant with no subscription at all', () => {
        expect(isUnpaid({ ...base, subscriptionStatus: null }, NOW)).toBe(false);
    });

    it('flags past_due regardless of dates — Stripe already failed to collect', () => {
        expect(isUnpaid({ ...base, subscriptionStatus: 'past_due' }, NOW)).toBe(true);
    });

    it('does not flag a merchant inside a paid period', () => {
        expect(isUnpaid({ ...base, currentPeriodEnd: new Date('2026-09-01') }, NOW)).toBe(false);
    });

    it('flags an ended period with no payment covering past it', () => {
        expect(isUnpaid({ ...base, currentPeriodEnd: new Date('2026-08-10'), coveredUntil: null }, NOW)).toBe(true);
    });

    it('does not flag an ended period a payment already covers', () => {
        // The rep collected a year up front; the subscription row lags behind.
        expect(isUnpaid(
            { ...base, currentPeriodEnd: new Date('2026-08-10'), coveredUntil: new Date('2027-08-10') },
            NOW,
        )).toBe(false);
    });

    it('flags again once the covered period itself lapses', () => {
        expect(isUnpaid(
            { ...base, currentPeriodEnd: new Date('2026-08-10'), coveredUntil: new Date('2026-08-15') },
            NOW,
        )).toBe(true);
    });
});

describe('paymentsService.record', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        insertChain.values.mockReturnThis();
        insertChain.onConflictDoNothing.mockReturnThis();
        insertChain.returning.mockResolvedValue([{ id: 'pay-1', amountCents: 79000, commissionCents: 15800, currency: 'usd' }]);
        selectChain.from.mockReturnThis();
        selectChain.where.mockReturnThis();
        selectChain.limit.mockResolvedValue([{ pct: 20 }]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const validInput = {
        userId: 'merchant-1',
        amountCents: 79000,
        method: 'cash' as const,
        paidAt: new Date('2026-08-15T10:00:00Z'),
    };
    const partnerActor = { userId: 'rep-user-1', collectedBy: 'partner' as const, partnerId: 'partner-1' };

    it('snapshots the commission from the partner row at record time', async () => {
        await paymentsService.record(validInput, partnerActor);

        const values = insertChain.values.mock.calls[0][0];
        expect(values).toMatchObject({ commissionPct: 20, commissionCents: 15800 });
    });

    it('leaves rep-collected money OUTSTANDING, not settled', async () => {
        await paymentsService.record(validInput, partnerActor);

        const values = insertChain.values.mock.calls[0][0];
        // The whole point of the status: the rep is holding this cash. Booking
        // it settled would erase it from what he owes us.
        expect(values.status).toBe('recorded');
        expect(values.settledAt).toBeNull();
    });

    it('settles admin- and Stripe-collected money on arrival', async () => {
        await paymentsService.record(validInput, { userId: 'admin-1', collectedBy: 'admin', partnerId: null });

        const values = insertChain.values.mock.calls[0][0];
        expect(values.status).toBe('settled');
        expect(values.settledAt).toEqual(validInput.paidAt);
    });

    it('forces collectedBy from the actor, never from the input', async () => {
        // A caller cannot smuggle a collector in: the field is not part of
        // RecordPaymentInput at all, and this pins that it stays that way.
        await paymentsService.record(
            { ...validInput, ...({ collectedBy: 'stripe', status: 'settled' } as object) },
            partnerActor,
        );

        const values = insertChain.values.mock.calls[0][0];
        expect(values.collectedBy).toBe('partner');
        expect(values.status).toBe('recorded');
    });

    it('rejects a zero or negative amount', async () => {
        await expect(paymentsService.record({ ...validInput, amountCents: 0 }, partnerActor))
            .rejects.toThrow(PaymentValidationError);
        await expect(paymentsService.record({ ...validInput, amountCents: -500 }, partnerActor))
            .rejects.toThrow(PaymentValidationError);
        expect(insertChain.values).not.toHaveBeenCalled();
    });

    it('rejects an amount above the typo guard', async () => {
        await expect(paymentsService.record({ ...validInput, amountCents: MAX_PAYMENT_CENTS + 1 }, partnerActor))
            .rejects.toMatchObject({ code: 'AMOUNT_TOO_LARGE' });
    });

    it('rejects a future payment date', async () => {
        // A future-dated row drops out of "collected this month" and reappears
        // later — the report silently disagrees with itself.
        await expect(paymentsService.record(
            { ...validInput, paidAt: new Date('2026-09-01T00:00:00Z') },
            partnerActor,
        )).rejects.toMatchObject({ code: 'FUTURE_PAID_AT' });
    });

    it('tolerates small clock skew rather than rejecting a just-now payment', async () => {
        await expect(paymentsService.record(
            { ...validInput, paidAt: new Date(NOW.getTime() + 60_000) },
            partnerActor,
        )).resolves.toBeTruthy();
    });

    it('rejects a covered period that ends before it starts', async () => {
        await expect(paymentsService.record(
            {
                ...validInput,
                coversPeriodStart: new Date('2026-09-01'),
                coversPeriodEnd: new Date('2026-08-01'),
            },
            partnerActor,
        )).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    });

    it('returns the existing row when the same idempotency key is replayed', async () => {
        // A double-tapped submit: the insert conflict-skips (returns []), and
        // the service must resolve to the winner rather than erroring or — far
        // worse — inserting a second payment.
        insertChain.returning.mockResolvedValue([]);
        selectChain.limit.mockResolvedValueOnce([{ pct: 20 }]).mockResolvedValueOnce([{ id: 'pay-existing' }]);

        const result = await paymentsService.record(
            { ...validInput, idempotencyKey: 'key-1' },
            partnerActor,
        );

        expect(result).toMatchObject({ id: 'pay-existing' });
    });

    it('does not attribute a Stripe row to a human recorder', async () => {
        await paymentsService.record(validInput, { userId: 'merchant-1', collectedBy: 'stripe', partnerId: 'partner-1' });

        const values = insertChain.values.mock.calls[0][0];
        expect(values.recordedByUserId).toBeNull();
    });
});
