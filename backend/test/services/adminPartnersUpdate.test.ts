import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Admin partner update — the operational half of the portal's access boundary.
 *
 * `userId: null` is the ONLY way to release a portal link that landed on the
 * wrong account, and `isActive: false` is the only way to cut a reseller's
 * access to merchant data. Both existed nowhere before, which meant either
 * situation could only be fixed by a hand-written UPDATE against production.
 * These tests pin that they work and that they cannot create an ambiguous
 * binding on the way.
 */

const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
};
const updateReturning = vi.fn();
const updateChain = {
    set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: updateReturning }) }),
};
const insertValues = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => selectChain),
        update: vi.fn(() => updateChain),
        insert: vi.fn(() => ({ values: insertValues })),
    },
}));
vi.mock('../../src/db/schema', () => ({
    partners: { id: 'id', name: 'name', email: 'email', phone: 'phone', userId: 'user_id', isActive: 'is_active', commissionPct: 'commission_pct', createdAt: 'created_at' },
    users: { id: 'id', partnerId: 'partner_id', partnerNote: 'partner_note' },
    adminAuditLogs: { id: 'id', action: 'action' },
}));
vi.mock('drizzle-orm', () => ({
    and: (...a: unknown[]) => ({ and: a }),
    or: (...a: unknown[]) => ({ or: a.filter(Boolean) }),
    ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
    eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
    asc: vi.fn(),
    sql: Object.assign((s: unknown, ...v: unknown[]) => ({ sql: s, v }), { join: vi.fn(), raw: vi.fn() }),
}));

import { adminPartnersService } from '../../src/services/admin/partners';
import { ConflictError, NotFoundError, ValidationError } from '../../src/utils/errors';

const EXISTING = {
    id: 'p-1', name: 'Ahmad', email: 'ahmad@example.com', phone: '+963944123456',
    userId: 'u-old', commissionPct: 20, isActive: true,
    createdAt: new Date('2026-08-01'), updatedAt: new Date('2026-08-01'),
};

describe('adminPartnersService.update', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectChain.from.mockReturnThis();
        selectChain.where.mockReturnThis();
        updateChain.set.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: updateReturning }) });
    });

    it('unbinds the portal login when userId is null', async () => {
        selectChain.limit.mockResolvedValueOnce([EXISTING]);
        updateReturning.mockResolvedValueOnce([{ ...EXISTING, userId: null }]);

        const result = await adminPartnersService.update('p-1', { userId: null }, 'admin-1');

        expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
        expect(result.userId).toBeNull();
    });

    it('links a specific account for an email-only partner who cannot auto-bind', async () => {
        selectChain.limit
            .mockResolvedValueOnce([{ ...EXISTING, phone: null, userId: null }])  // the partner
            .mockResolvedValueOnce([{ id: 'u-new' }])                             // target user exists
            .mockResolvedValueOnce([]);                                           // not linked elsewhere
        updateReturning.mockResolvedValueOnce([{ ...EXISTING, phone: null, userId: 'u-new' }]);

        const result = await adminPartnersService.update('p-1', { userId: 'u-new' }, 'admin-1');

        expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-new' }));
        expect(result.userId).toBe('u-new');
    });

    it('refuses to link an account that already belongs to another partner', async () => {
        selectChain.limit
            .mockResolvedValueOnce([EXISTING])
            .mockResolvedValueOnce([{ id: 'u-new' }])
            .mockResolvedValueOnce([{ id: 'p-2' }]);   // already taken

        // partners.user_id is not unique in the schema, so without this check
        // two rows could point at one login and resolvePartnerForUser's
        // `.limit(1)` would decide which reseller you are by planner order.
        await expect(adminPartnersService.update('p-1', { userId: 'u-new' }, 'admin-1'))
            .rejects.toBeInstanceOf(ConflictError);
        expect(updateChain.set).not.toHaveBeenCalled();
    });

    it('refuses to link a user that does not exist', async () => {
        selectChain.limit
            .mockResolvedValueOnce([EXISTING])
            .mockResolvedValueOnce([]);   // no such user

        await expect(adminPartnersService.update('p-1', { userId: 'ghost' }, 'admin-1'))
            .rejects.toBeInstanceOf(NotFoundError);
        expect(updateChain.set).not.toHaveBeenCalled();
    });

    it('deactivates a partner, which is what cuts their portal access', async () => {
        selectChain.limit.mockResolvedValueOnce([EXISTING]);
        updateReturning.mockResolvedValueOnce([{ ...EXISTING, isActive: false }]);

        const result = await adminPartnersService.update('p-1', { isActive: false }, 'admin-1');

        expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
        expect(result.isActive).toBe(false);
    });

    it('rejects clearing both contacts, which would leave the partner unreachable', async () => {
        selectChain.limit.mockResolvedValueOnce([{ ...EXISTING, phone: null }]);

        await expect(adminPartnersService.update('p-1', { email: null }, 'admin-1'))
            .rejects.toBeInstanceOf(ValidationError);
        expect(updateChain.set).not.toHaveBeenCalled();
    });

    it('rejects an anchor already used by another partner with 409, not a raw 500', async () => {
        selectChain.limit
            .mockResolvedValueOnce([EXISTING])
            .mockResolvedValueOnce([{ id: 'p-2' }]);   // anchor clash

        await expect(adminPartnersService.update('p-1', { phone: '+963900000000' }, 'admin-1'))
            .rejects.toBeInstanceOf(ConflictError);
    });

    it('404s on an unknown partner', async () => {
        selectChain.limit.mockResolvedValueOnce([]);

        await expect(adminPartnersService.update('nope', { isActive: false }, 'admin-1'))
            .rejects.toBeInstanceOf(NotFoundError);
    });

    it('audits the change with both the previous and the new binding', async () => {
        selectChain.limit.mockResolvedValueOnce([EXISTING]);
        updateReturning.mockResolvedValueOnce([{ ...EXISTING, userId: null }]);

        await adminPartnersService.update('p-1', { userId: null }, 'admin-1');

        expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
            action: 'partner_updated',
            adminUserId: 'admin-1',
            previousValue: expect.objectContaining({ userId: 'u-old' }),
            newValue: expect.objectContaining({ userId: null }),
        }));
    });

    it('lowercases a new email so it matches the partial unique index', async () => {
        selectChain.limit
            .mockResolvedValueOnce([EXISTING])
            .mockResolvedValueOnce([]);   // no clash
        updateReturning.mockResolvedValueOnce([EXISTING]);

        await adminPartnersService.update('p-1', { email: 'Ahmad.NEW@Example.COM' }, 'admin-1');

        expect(updateChain.set).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'ahmad.new@example.com' }),
        );
    });
});
