import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isUserAdmin, requireAdmin } from '../../src/middleware/admin';
import { FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../src/middleware/auth';

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

    describe('isUserAdmin', () => {
        it('should return false when user not found', async () => {
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            const result = await isUserAdmin('non-existent-user');
            expect(result).toBe(false);
        });

        it('should return false when user has no email', async () => {
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ email: null }]),
                }),
            });

            const result = await isUserAdmin('user-without-email');
            expect(result).toBe(false);
        });

        it('should return false when email is not in admin list', async () => {
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ email: 'regular@example.com' }]),
                }),
            });

            const result = await isUserAdmin('regular-user');
            expect(result).toBe(false);
        });

        it('should handle database errors gracefully', async () => {
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockRejectedValue(new Error('DB Error')),
                }),
            });

            const result = await isUserAdmin('any-user');
            expect(result).toBe(false);
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
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ email: 'regular@example.com' }]),
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
    });
});
