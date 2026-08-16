import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The partner portal's ONLY write. Its security boundary is the ownership gate:
 * a reseller may record money against his own merchants and nobody else's.
 *
 * These tests assert on the QUERY the service builds, not just on its return
 * value. A db-mock returns whatever it was told to regardless of the WHERE
 * clause, so a value-only assertion passes with the gate deleted — the exact
 * trap the first version of the portal's phone test fell into.
 */

const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
};

vi.mock('../../src/db', () => ({ db: { select: vi.fn(() => selectChain), insert: vi.fn(), update: vi.fn() } }));
vi.mock('../../src/db/schema', () => ({
    partners: { id: 'partners.id', userId: 'partners.user_id', isActive: 'partners.is_active' },
    users: { id: 'users.id', partnerId: 'users.partner_id', partnerNote: 'users.partner_note' },
    payments: {}, subscriptions: {}, plans: {}, pages: {}, adminAuditLogs: {},
}));
vi.mock('drizzle-orm', () => ({
    // `and`/`eq` record their arguments so a test can read back the predicate
    // the service actually built.
    and: vi.fn((...conditions) => ({ op: 'and', conditions })),
    eq: vi.fn((column, value) => ({ op: 'eq', column, value })),
    desc: vi.fn(), inArray: vi.fn(), isNull: vi.fn(),
    sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}));
vi.mock('../../src/services/admin/users', () => ({ adminUsersService: { getUserDetail: vi.fn() } }));
vi.mock('../../src/services/payments', () => ({
    paymentsService: { record: vi.fn(), listForMerchant: vi.fn(), getPaymentStateFor: vi.fn(), listForPartner: vi.fn() },
    isUnpaid: vi.fn(() => false),
}));

import { partnerPortalService } from '../../src/services/partnerPortal';
import { paymentsService } from '../../src/services/payments';

const INPUT = {
    amountCents: 79000,
    method: 'cash' as const,
    paidAt: new Date('2026-08-15T10:00:00Z'),
};

describe('partnerPortalService.recordPayment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectChain.from.mockReturnThis();
        selectChain.where.mockReturnThis();
        vi.mocked(paymentsService.record).mockResolvedValue({ id: 'pay-1' } as never);
    });

    it('refuses to write when the merchant is not attributed to this partner', async () => {
        selectChain.limit.mockResolvedValue([]);   // gate finds no such row

        const result = await partnerPortalService.recordPayment(
            { id: 'partner-1' }, 'someone-elses-merchant', INPUT, 'rep-user-1',
        );

        // Null → the controller answers 404, so the status code cannot be used
        // to prove whether that merchant id exists at all.
        expect(result).toBeNull();
        expect(paymentsService.record).not.toHaveBeenCalled();
    });

    it('scopes the gate query by BOTH the merchant id and the calling partner', async () => {
        selectChain.limit.mockResolvedValue([{ id: 'merchant-1' }]);

        await partnerPortalService.recordPayment({ id: 'partner-1' }, 'merchant-1', INPUT, 'rep-user-1');

        // Read the predicate back. Matching on the merchant id ALONE would let
        // any reseller write against any merchant in the database.
        const predicate = selectChain.where.mock.calls[0][0];
        expect(predicate).toMatchObject({
            op: 'and',
            conditions: expect.arrayContaining([
                { op: 'eq', column: 'users.id', value: 'merchant-1' },
                { op: 'eq', column: 'users.partner_id', value: 'partner-1' },
            ]),
        });
    });

    it('forces the payment to be collected BY THE PARTNER, whatever the caller sent', async () => {
        selectChain.limit.mockResolvedValue([{ id: 'merchant-1' }]);

        await partnerPortalService.recordPayment(
            { id: 'partner-1' },
            'merchant-1',
            // A hostile body trying to book its own cash as already settled.
            { ...INPUT, ...({ collectedBy: 'admin', partnerId: 'other-partner', status: 'settled' } as object) },
            'rep-user-1',
        );

        const [, actor] = vi.mocked(paymentsService.record).mock.calls[0];
        expect(actor).toEqual({ userId: 'rep-user-1', collectedBy: 'partner', partnerId: 'partner-1' });
    });

    it('records against the merchant from the URL, not one named in the body', async () => {
        selectChain.limit.mockResolvedValue([{ id: 'merchant-1' }]);

        await partnerPortalService.recordPayment(
            { id: 'partner-1' },
            'merchant-1',
            { ...INPUT, ...({ userId: 'victim-merchant' } as object) },
            'rep-user-1',
        );

        const [input] = vi.mocked(paymentsService.record).mock.calls[0];
        expect(input.userId).toBe('merchant-1');
    });
});
