import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Portal login binding.
 *
 * Regression guard for a defect caught before merge: binding matched only on
 * email, but Jawab24 has NO email login — a phone-OTP signup (the product's
 * primary identity) leaves `users.email` NULL, so a phone-first reseller was
 * locked out of the portal permanently with no self-service fix.
 */

const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
};
const updateWhere = vi.fn().mockResolvedValue(undefined);
const updateChain = { set: vi.fn().mockReturnValue({ where: updateWhere }) };

vi.mock('../../src/db', () => ({
    db: { select: vi.fn(() => selectChain), update: vi.fn(() => updateChain) },
}));
vi.mock('../../src/db/schema', () => ({
    partners: { id: 'id', email: 'email', phone: 'phone', userId: 'user_id', isActive: 'is_active' },
    users: { id: 'id', partnerId: 'partner_id', partnerNote: 'partner_note' },
    subscriptions: {}, plans: {}, pages: {},
}));
vi.mock('drizzle-orm', () => ({
    and: (...a: unknown[]) => ({ and: a }),
    or: (...a: unknown[]) => ({ or: a.filter(Boolean) }),
    desc: vi.fn(), eq: (a: unknown, b: unknown) => ({ eq: [a, b] }), inArray: vi.fn(),
    sql: Object.assign((s: unknown, ...v: unknown[]) => ({ sql: s, v }), { join: vi.fn(), raw: vi.fn() }),
}));
vi.mock('../../src/services/admin/users', () => ({ adminUsersService: { getUserDetail: vi.fn() } }));

import { partnerPortalService } from '../../src/services/partnerPortal';

const PARTNER = { id: 'p-1', name: 'Ahmad', email: null, phone: '+963944123456', userId: null, isActive: true };

describe('resolvePartnerForUser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectChain.from.mockReturnThis();
        selectChain.where.mockReturnThis();
        updateChain.set.mockReturnValue({ where: updateWhere });
    });

    /**
     * Asserts on the QUERY, not just the mocked result. A mock that resolves
     * with a partner row passes no matter what the WHERE clause contains, so
     * "it returned the partner" proves nothing about phone matching — the
     * value has to appear in the query the service actually built.
     */
    it('binds a PHONE-signup partner who has no email at all', async () => {
        selectChain.limit
            .mockResolvedValueOnce([])          // no existing user_id link
            .mockResolvedValueOnce([PARTNER]);  // anchor lookup

        const result = await partnerPortalService.resolvePartnerForUser({
            id: 'u-1',
            email: null,        // exactly what a phone-OTP signup produces
            phone: '+963944123456',
        });

        expect(result).toMatchObject({ id: 'p-1' });
        // The phone must be part of the anchor lookup (2nd select).
        const anchorWhere = JSON.stringify(selectChain.where.mock.calls[1]);
        expect(anchorWhere).toContain('+963944123456');
        // The link is persisted so later visits skip the anchor match.
        expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1' }));
    });

    it('still binds an email-signup partner, matched case-insensitively', async () => {
        const emailPartner = { ...PARTNER, email: 'ahmad.tabbaa@gmail.com', phone: null };
        selectChain.limit
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([emailPartner]);

        const result = await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: 'Ahmad.Tabbaa@Gmail.com', phone: null,
        });

        expect(result).toMatchObject({ id: 'p-1' });
        const anchorWhere = JSON.stringify(selectChain.where.mock.calls[1]);
        expect(anchorWhere).toContain('ahmad.tabbaa@gmail.com');   // lowercased
        expect(anchorWhere).not.toContain('Ahmad.Tabbaa@Gmail.com');
    });

    it('queries BOTH anchors when the user carries email and phone', async () => {
        selectChain.limit
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([PARTNER]);

        await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: 'a@b.com', phone: '+963944123456',
        });

        const anchorWhere = JSON.stringify(selectChain.where.mock.calls[1]);
        expect(anchorWhere).toContain('a@b.com');
        expect(anchorWhere).toContain('+963944123456');
    });

    it('prefers the persisted user_id link without re-matching anchors', async () => {
        selectChain.limit.mockResolvedValueOnce([{ ...PARTNER, userId: 'u-1' }]);

        const result = await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: null, phone: '+963944123456',
        });

        expect(result).toMatchObject({ id: 'p-1' });
        expect(selectChain.limit).toHaveBeenCalledTimes(1);
        expect(updateChain.set).not.toHaveBeenCalled();
    });

    it('returns null when the user carries neither anchor', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        const result = await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: null, phone: null,
        });

        expect(result).toBeNull();
        // No anchor to match on — must not run a second, unfiltered query.
        expect(selectChain.limit).toHaveBeenCalledTimes(1);
    });

    it('refuses to re-bind a partner already linked to a DIFFERENT login', async () => {
        selectChain.limit
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ ...PARTNER, userId: 'someone-else' }]);

        const result = await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: null, phone: '+963944123456',
        });

        expect(result).toBeNull();
        expect(updateChain.set).not.toHaveBeenCalled();
    });
});
