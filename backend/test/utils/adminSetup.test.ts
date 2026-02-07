import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: {
        id: 'users.id',
        email: 'users.email',
        name: 'users.name',
        isAdmin: 'users.is_admin',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((a: any, b: any) => ({ op: 'eq', field: a, value: b })),
    ilike: vi.fn((a: any, b: any) => ({ op: 'ilike', field: a, value: b })),
}));

import { ensureAdminUsers, promoteToAdmin, demoteAdmin, listAdmins } from '../../src/utils/adminSetup';
import { db } from '../../src/db';

function mockSelectUser(user: Record<string, any> | null) {
    const mockLimit = vi.fn().mockResolvedValue(user ? [user] : []);
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);
    return { mockFrom, mockWhere };
}

function mockUpdate() {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
    return { mockSet, mockWhere };
}

describe('adminSetup utilities', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('ensureAdminUsers', () => {
        it('should do nothing when ADMIN_EMAILS is not set', async () => {
            delete process.env.ADMIN_EMAILS;
            delete process.env.ADMIN_EMAIL;

            await ensureAdminUsers();

            expect(db.select).not.toHaveBeenCalled();
        });

        it('should promote a non-admin user', async () => {
            process.env.ADMIN_EMAILS = 'admin@example.com';
            mockSelectUser({ id: 'u-1', email: 'admin@example.com', isAdmin: false });
            mockUpdate();

            await ensureAdminUsers();

            expect(db.update).toHaveBeenCalled();
        });

        it('should skip already-admin users', async () => {
            process.env.ADMIN_EMAILS = 'admin@example.com';
            mockSelectUser({ id: 'u-1', email: 'admin@example.com', isAdmin: true });

            await ensureAdminUsers();

            expect(db.update).not.toHaveBeenCalled();
        });

        it('should handle user not found gracefully', async () => {
            process.env.ADMIN_EMAILS = 'missing@example.com';
            mockSelectUser(null);

            await ensureAdminUsers();

            expect(db.update).not.toHaveBeenCalled();
        });

        it('should handle comma-separated list of emails', async () => {
            process.env.ADMIN_EMAILS = ' admin1@test.com , admin2@test.com ';

            // Mock two select calls
            const mockLimit1 = vi.fn().mockResolvedValue([{ id: 'u-1', email: 'admin1@test.com', isAdmin: true }]);
            const mockWhere1 = vi.fn().mockReturnValue({ limit: mockLimit1 });
            const mockFrom1 = vi.fn().mockReturnValue({ where: mockWhere1 });

            const mockLimit2 = vi.fn().mockResolvedValue([{ id: 'u-2', email: 'admin2@test.com', isAdmin: true }]);
            const mockWhere2 = vi.fn().mockReturnValue({ limit: mockLimit2 });
            const mockFrom2 = vi.fn().mockReturnValue({ where: mockWhere2 });

            vi.mocked(db.select)
                .mockReturnValueOnce({ from: mockFrom1 } as any)
                .mockReturnValueOnce({ from: mockFrom2 } as any);

            await ensureAdminUsers();

            expect(db.select).toHaveBeenCalledTimes(2);
        });

        it('should fall back to ADMIN_EMAIL env var', async () => {
            delete process.env.ADMIN_EMAILS;
            process.env.ADMIN_EMAIL = 'fallback@example.com';
            mockSelectUser({ id: 'u-1', email: 'fallback@example.com', isAdmin: true });

            await ensureAdminUsers();

            expect(db.select).toHaveBeenCalledTimes(1);
        });
    });

    describe('promoteToAdmin', () => {
        it('should promote user and return success', async () => {
            mockSelectUser({ id: 'u-1', email: 'user@test.com', name: 'Test', isAdmin: false });
            mockUpdate();

            const result = await promoteToAdmin('user@test.com');

            expect(result.success).toBe(true);
            expect(db.update).toHaveBeenCalled();
        });

        it('should return success if user is already admin', async () => {
            mockSelectUser({ id: 'u-1', email: 'user@test.com', name: 'Test', isAdmin: true });

            const result = await promoteToAdmin('user@test.com');

            expect(result.success).toBe(true);
            expect(result.message).toContain('already an admin');
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should return failure if user not found', async () => {
            mockSelectUser(null);

            const result = await promoteToAdmin('nobody@test.com');

            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

        it('should normalize email to lowercase', async () => {
            mockSelectUser({ id: 'u-1', email: 'user@test.com', name: 'Test', isAdmin: false });
            mockUpdate();

            await promoteToAdmin('  USER@TEST.COM  ');

            // The ilike mock should have been called with the normalized email
            expect(db.select).toHaveBeenCalled();
        });
    });

    describe('demoteAdmin', () => {
        it('should demote admin and return success', async () => {
            mockSelectUser({ id: 'u-1', email: 'admin@test.com', name: 'Admin', isAdmin: true });
            mockUpdate();

            const result = await demoteAdmin('admin@test.com');

            expect(result.success).toBe(true);
            expect(db.update).toHaveBeenCalled();
        });

        it('should return success if user is not an admin', async () => {
            mockSelectUser({ id: 'u-1', email: 'user@test.com', name: 'User', isAdmin: false });

            const result = await demoteAdmin('user@test.com');

            expect(result.success).toBe(true);
            expect(result.message).toContain('not an admin');
        });

        it('should return failure if user not found', async () => {
            mockSelectUser(null);

            const result = await demoteAdmin('ghost@test.com');

            expect(result.success).toBe(false);
        });
    });

    describe('listAdmins', () => {
        it('should return all admin users', async () => {
            const admins = [
                { id: 'u-1', email: 'a@test.com', name: 'Admin 1' },
                { id: 'u-2', email: 'b@test.com', name: 'Admin 2' },
            ];
            const mockWhere = vi.fn().mockResolvedValue(admins);
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const result = await listAdmins();

            expect(result).toEqual(admins);
            expect(result).toHaveLength(2);
        });

        it('should return empty array when no admins', async () => {
            const mockWhere = vi.fn().mockResolvedValue([]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const result = await listAdmins();

            expect(result).toEqual([]);
        });
    });
});
