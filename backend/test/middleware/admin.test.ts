import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isUserAdmin, requireAdmin } from '../../src/middleware/admin';
import { FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../src/middleware/auth';
import { db } from '../../src/db';

// Mock the database
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn(),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
}));

describe('Admin Middleware', () => {
    let mockRequest: Partial<AuthenticatedRequest>;
    let mockReply: Partial<FastifyReply>;
    let statusMock: ReturnType<typeof vi.fn>;
    let sendMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        
        sendMock = vi.fn().mockReturnThis();
        statusMock = vi.fn().mockReturnValue({ send: sendMock });
        
        mockRequest = {
            user: {
                userId: 'test-user-id',
                facebookId: 'fb-123',
            },
        };
        
        mockReply = {
            status: statusMock,
            send: sendMock,
        };
    });

    // Admin status is now decided by the `is_admin` DB column (set only by the trusted
    // ensureAdminUsers bootstrap / CLI scripts), NOT by the user's self-settable email.
    describe('isUserAdmin', () => {
        const mockRow = (row: unknown) => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(row === undefined ? [] : [row]),
                }),
            });
        };

        it('should return false when user not found', async () => {
            mockRow(undefined);
            expect(await isUserAdmin('non-existent-user')).toBe(false);
        });

        it('should return true when the is_admin column is true', async () => {
            mockRow({ isAdmin: true });
            expect(await isUserAdmin('real-admin')).toBe(true);
        });

        it('should return false when is_admin is false', async () => {
            mockRow({ isAdmin: false });
            expect(await isUserAdmin('regular-user')).toBe(false);
        });

        it('should return false when is_admin is null/undefined', async () => {
            mockRow({ isAdmin: null });
            expect(await isUserAdmin('user-without-flag')).toBe(false);
        });

        // Regression: setting an admin-looking email must NOT grant admin. Before the
        // fix, isUserAdmin compared the (self-settable) email against ADMIN_EMAILS.
        it('should return false even when the email looks like an admin address but is_admin is false', async () => {
            mockRow({ email: 'admin@jawab24.com', isAdmin: false });
            expect(await isUserAdmin('attacker-who-set-admin-email')).toBe(false);
        });

        it('should handle database errors gracefully', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockRejectedValue(new Error('DB Error')),
                }),
            });
            expect(await isUserAdmin('any-user')).toBe(false);
        });
    });

    describe('requireAdmin middleware', () => {
        it('should return 401 when user is not authenticated', async () => {
            mockRequest.user = undefined;

            await requireAdmin(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(statusMock).toHaveBeenCalledWith(401);
            expect(sendMock).toHaveBeenCalledWith({
                error: true,
                message: 'Authentication required',
                code: 'AUTH_REQUIRED',
            });
        });

        it('should return 403 when user is not admin', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ isAdmin: false }]),
                }),
            });

            await requireAdmin(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(statusMock).toHaveBeenCalledWith(403);
            expect(sendMock).toHaveBeenCalledWith({
                error: true,
                message: 'Admin access required',
                code: 'ADMIN_REQUIRED',
            });
        });

        it('should pass (no error response) when the user is a real admin', async () => {
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ isAdmin: true }]),
                }),
            });

            await requireAdmin(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(statusMock).not.toHaveBeenCalled();
        });

        it('rejects an embedded session even when its owner IS a real admin (never reads the DB)', async () => {
            // This gate re-reads admin status from the DB, so the JWT flag-clear
            // alone would not stop it — the session marker must. The db.select
            // spy must never be reached.
            const dbSelect = db.select as ReturnType<typeof vi.fn>;
            dbSelect.mockClear();
            mockRequest.user = { userId: 'owner-1', isAdmin: true, embeddedPlatform: 'zid' };
            mockRequest.url = '/admin/plans';
            mockRequest.log = { warn: vi.fn() } as never;

            await requireAdmin(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(statusMock).toHaveBeenCalledWith(403);
            expect(sendMock).toHaveBeenCalledWith({
                error: true,
                message: 'Admin access required',
                code: 'ADMIN_REQUIRED',
            });
            expect(dbSelect).not.toHaveBeenCalled();
        });
    });
});
