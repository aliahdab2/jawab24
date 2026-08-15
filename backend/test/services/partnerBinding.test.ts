import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Portal login binding — an access boundary, so these tests pin WHICH identity
 * anchor is trusted, not merely that binding works.
 *
 * The rule: the PHONE binds; the EMAIL never does. `users.phone` is unique and
 * can only be set by proving possession via OTP. `users.email` is settable to
 * any value by any authenticated user (PATCH /auth/profile, no verification)
 * and is not unique — so auto-binding on it let any merchant who knew a rep's
 * address take permanent possession of that rep's portal and read every
 * attributed merchant's name, phone and note.
 */

const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
};
// The claim UPDATE ends in .returning() — [] means the IS NULL guard matched
// no row, i.e. a concurrent request claimed this partner first.
const updateReturning = vi.fn().mockResolvedValue([{ id: 'p-1' }]);
const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
const updateChain = { set: vi.fn().mockReturnValue({ where: updateWhere }) };
const insertValues = vi.fn().mockResolvedValue(undefined);
const insertChain = { values: insertValues };

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => updateChain),
        insert: vi.fn(() => insertChain),
    },
}));
vi.mock('../../src/db/schema', () => ({
    partners: { id: 'id', email: 'email', phone: 'phone', userId: 'user_id', isActive: 'is_active' },
    users: { id: 'id', partnerId: 'partner_id', partnerNote: 'partner_note' },
    adminAuditLogs: { id: 'id', action: 'action' },
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
        updateWhere.mockReturnValue({ returning: updateReturning });
        updateReturning.mockResolvedValue([{ id: 'p-1' }]);
        insertChain.values = insertValues;
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

        expect(result).toMatchObject({ id: 'p-1', userId: 'u-1' });
        // The phone must be part of the anchor lookup (2nd select).
        const anchorWhere = JSON.stringify(selectChain.where.mock.calls[1]);
        expect(anchorWhere).toContain('+963944123456');
        // The link is persisted so later visits skip the anchor match.
        expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1' }));
    });

    // ---------------------------------------------------------------
    // The email anchor is GONE — this is the security regression guard
    // ---------------------------------------------------------------
    describe('email is not an identity anchor', () => {
        it('does NOT bind a partner by a matching email when the user has no phone', async () => {
            selectChain.limit.mockResolvedValueOnce([]);   // no user_id link

            const result = await partnerPortalService.resolvePartnerForUser({
                id: 'attacker-user',
                // The rep's address, set on the attacker's own account via
                // PATCH /auth/profile — which requires no verification at all.
                email: 'ahmad.tabbaa@gmail.com',
                phone: null,
            });

            expect(result).toBeNull();
            // Must not even run an anchor lookup: with no phone there is no
            // trustworthy anchor to look up.
            expect(selectChain.limit).toHaveBeenCalledTimes(1);
            expect(updateChain.set).not.toHaveBeenCalled();
        });

        it('never puts the email in the anchor query, even when the user has both', async () => {
            selectChain.limit
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([PARTNER]);

            await partnerPortalService.resolvePartnerForUser({
                id: 'u-1',
                email: 'ahmad.tabbaa@gmail.com',
                phone: '+963944123456',
            });

            const anchorWhere = JSON.stringify(selectChain.where.mock.calls[1]);
            expect(anchorWhere).toContain('+963944123456');
            // An email-bearing anchor query would re-open the hijack.
            expect(anchorWhere).not.toContain('ahmad.tabbaa@gmail.com');
        });

        it('does not bind an email-only partner row to a same-email login', async () => {
            const emailOnlyPartner = { ...PARTNER, email: 'ahmad.tabbaa@gmail.com', phone: null };
            selectChain.limit
                .mockResolvedValueOnce([])
                // Even if a row somehow comes back, the query was keyed on the
                // caller's phone — an email-only partner cannot match it.
                .mockResolvedValueOnce([emailOnlyPartner]);

            await partnerPortalService.resolvePartnerForUser({
                id: 'u-1', email: 'ahmad.tabbaa@gmail.com', phone: '+963900000000',
            });

            const anchorWhere = JSON.stringify(selectChain.where.mock.calls[1]);
            expect(anchorWhere).not.toContain('ahmad.tabbaa@gmail.com');
            expect(anchorWhere).toContain('+963900000000');
        });
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

    it('returns null when the user carries no phone at all', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        const result = await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: null, phone: null,
        });

        expect(result).toBeNull();
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

    it('loses gracefully when a concurrent request claims the partner first', async () => {
        selectChain.limit
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([PARTNER]);
        // The `WHERE user_id IS NULL` guard matched nothing — someone else won.
        updateReturning.mockResolvedValueOnce([]);

        const result = await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: null, phone: '+963944123456',
        });

        // Returning `matched` here would hand THIS request the merchant book
        // even though the row now belongs to another login.
        expect(result).toBeNull();
        expect(insertValues).not.toHaveBeenCalled();
    });

    it('audits the bind so the claiming account is recoverable after the fact', async () => {
        selectChain.limit
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([PARTNER]);

        await partnerPortalService.resolvePartnerForUser({
            id: 'u-1', email: null, phone: '+963944123456',
        });

        expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
            action: 'partner_portal_bound',
            targetUserId: 'u-1',
            newValue: expect.objectContaining({ partnerId: 'p-1', userId: 'u-1' }),
        }));
    });
});
