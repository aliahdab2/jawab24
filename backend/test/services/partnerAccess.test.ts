import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `isPartnerUser` answers "render the Partner nav entry?" on the LOGIN path,
 * for every user in the product. Its defining property is what it must NOT do:
 * claim a partner row. `resolvePartnerForUser` binds an unclaimed row to
 * whoever asks first — correct on the portal's own endpoints (covered in
 * partnerBinding.test.ts), catastrophic at login, where it would hand
 * possession of a rep's merchant book to the next merchant who happens to
 * share the phone, with no portal request ever made.
 */

// vi.hoisted: the mock factory below is hoisted above these declarations, and
// `partnerAccess` imports `db` at module load, so the factory runs before a
// plain const would be initialised.
const { selectChain, dbUpdate, dbInsert } = vi.hoisted(() => ({
    selectChain: {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(),
    },
    dbUpdate: vi.fn(),
    dbInsert: vi.fn(),
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => selectChain),
        update: dbUpdate,
        insert: dbInsert,
    },
}));
vi.mock('../../src/db/schema', () => ({
    partners: { id: 'id', email: 'email', phone: 'phone', userId: 'user_id', isActive: 'is_active' },
}));
vi.mock('drizzle-orm', () => ({
    and: (...a: unknown[]) => ({ and: a }),
    or: (...a: unknown[]) => ({ or: a.filter(Boolean) }),
    isNull: (c: unknown) => ({ isNull: c }),
    eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
}));

import { isPartnerUser } from '../../src/services/partnerAccess';

describe('isPartnerUser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectChain.from.mockReturnThis();
        selectChain.where.mockReturnThis();
    });

    it('never writes — no claim, no audit row, no matter what matches', async () => {
        selectChain.limit.mockResolvedValueOnce([{ id: 'p-1' }]);

        await isPartnerUser({ id: 'u-1', phone: '+963944123456' });

        expect(dbUpdate).not.toHaveBeenCalled();
        expect(dbInsert).not.toHaveBeenCalled();
    });

    it('is true for a partner already bound to this login', async () => {
        selectChain.limit.mockResolvedValueOnce([{ id: 'p-1' }]);

        await expect(isPartnerUser({ id: 'u-1', phone: null })).resolves.toBe(true);
    });

    it('is false for an ordinary merchant', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        await expect(isPartnerUser({ id: 'u-9', phone: '+963900000000' })).resolves.toBe(false);
    });

    /**
     * The phone anchor must carry `user_id IS NULL`, exactly as the claim path
     * does. Without it a merchant sharing a phone with an ALREADY-BOUND partner
     * row gets a menu entry the portal answers 403 to — a dead link that reads
     * as a broken feature, and an unnecessary hint that the row exists.
     */
    it('restricts the phone anchor to unclaimed rows', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        await isPartnerUser({ id: 'u-1', phone: '+963944123456' });

        const where = JSON.stringify(selectChain.where.mock.calls[0]);
        expect(where).toContain('+963944123456');
        expect(where).toContain('isNull');
        // Deactivated partners keep their row; the entry must disappear.
        expect(where).toContain('is_active');
    });

    it('does not query the phone anchor at all when the user has no phone', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        await isPartnerUser({ id: 'u-1', phone: null });

        const where = JSON.stringify(selectChain.where.mock.calls[0]);
        expect(where).not.toContain('isNull');
        expect(where).toContain('user_id');
    });

    it('ignores a whitespace-only phone rather than matching on it', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        await isPartnerUser({ id: 'u-1', phone: '   ' });

        const where = JSON.stringify(selectChain.where.mock.calls[0]);
        expect(where).not.toContain('isNull');
    });

    /**
     * The email anchor is absent here for the same reason it was removed from
     * the claim path: `users.email` is settable to any value by any
     * authenticated user (PATCH /auth/profile, no verification) and is not
     * unique, so matching on it would surface a rep's portal entry to a
     * merchant who simply typed the rep's address into their own profile.
     */
    it('never matches on email', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        await isPartnerUser({ id: 'u-1', phone: '+963944123456' } as { id: string; phone: string });

        const where = JSON.stringify(selectChain.where.mock.calls[0]);
        expect(where).not.toContain('email');
    });
});
