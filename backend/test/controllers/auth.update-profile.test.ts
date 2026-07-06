import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

// Mock database
vi.mock('../../src/db', () => ({
    db: {
        update: vi.fn(),
        select: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: {
        id: 'id',
        email: 'email',
        name: 'name',
        updatedAt: 'updated_at',
    },
    subscriptions: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    sql: vi.fn(),
}));

// updateProfile's escalation guard reads config.adminEmails, which config/index.ts
// parses from ADMIN_EMAILS at import time. Set it (via hoisted, so it runs before the
// controller import loads config) to give the guard a known reserved address.
vi.hoisted(() => {
    process.env.ADMIN_EMAILS = 'admin@jawab24.com';
});

// Import after mocking
import { AuthController } from '../../src/controllers/auth';
import { db } from '../../src/db';

describe('AuthController - updateProfile', () => {
    let authController: AuthController;
    let mockRequest: Partial<AuthenticatedRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        authController = new AuthController();

        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    describe('PATCH /auth/profile - Update user email', () => {
        it('should update user email successfully', async () => {
            mockRequest = {
                body: { email: 'newemail@example.com' },
                user: { userId: 'user_123', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            const mockUpdatedUser = {
                id: 'user_123',
                facebookId: 'fb_123',
                name: 'Test User',
                email: 'newemail@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Mock update chain
            const mockWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            // Mock select chain
            const mockSelectWhere = vi.fn().mockResolvedValue([mockUpdatedUser]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(db.update).toHaveBeenCalled();
            expect(mockSet).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: 'newemail@example.com',
                    updatedAt: expect.any(Date),
                })
            );

            expect(mockReply.send).toHaveBeenCalledWith({
                id: 'user_123',
                facebookId: 'fb_123',
                name: 'Test User',
                email: 'newemail@example.com',
                hasEmail: true,
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
            });
        });

        it('should update user name successfully', async () => {
            mockRequest = {
                body: { name: 'Updated Name' },
                user: { userId: 'user_123', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            const mockUpdatedUser = {
                id: 'user_123',
                facebookId: 'fb_123',
                name: 'Updated Name',
                email: 'test@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const mockWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const mockSelectWhere = vi.fn().mockResolvedValue([mockUpdatedUser]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockSet).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Updated Name',
                    updatedAt: expect.any(Date),
                })
            );

            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Updated Name',
                    hasEmail: true,
                })
            );
        });

        it('should update both email and name', async () => {
            mockRequest = {
                body: { email: 'new@example.com', name: 'New Name' },
                user: { userId: 'user_123', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            const mockUpdatedUser = {
                id: 'user_123',
                facebookId: 'fb_123',
                name: 'New Name',
                email: 'new@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const mockWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const mockSelectWhere = vi.fn().mockResolvedValue([mockUpdatedUser]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockSet).toHaveBeenCalledWith(
                expect.objectContaining({
                    email: 'new@example.com',
                    name: 'New Name',
                    updatedAt: expect.any(Date),
                })
            );
        });

        it('should return 401 if user is not authenticated', async () => {
            mockRequest = {
                body: { email: 'test@example.com' },
                user: undefined,
                log: { error: vi.fn() },
            };

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should return 400 if email format is invalid', async () => {
            mockRequest = {
                body: { email: 'invalid-email' },
                user: { userId: 'user_123', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Invalid email format' });
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should return 400 if no fields to update', async () => {
            mockRequest = {
                body: {},
                user: { userId: 'user_123', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'No fields to update' });
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should return 404 if user not found after update', async () => {
            mockRequest = {
                body: { email: 'test@example.com' },
                user: { userId: 'deleted_user', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            const mockWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            // User not found
            const mockSelectWhere = vi.fn().mockResolvedValue([]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'User not found' });
        });

        it('should handle database errors gracefully', async () => {
            mockRequest = {
                body: { email: 'test@example.com' },
                user: { userId: 'user_123', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            vi.mocked(db.update).mockImplementation(() => {
                throw new Error('Database connection failed');
            });

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Internal Server Error' });
            expect(mockRequest.log!.error).toHaveBeenCalled();
        });
    });

    // Anti-privilege-escalation: a non-admin must not be able to claim an
    // ADMIN_EMAILS-listed address (which ensureAdminUsers would auto-promote).
    describe('PATCH /auth/profile - admin-email escalation guard', () => {
        it('should return 403 when a non-admin tries to claim an admin-listed email', async () => {
            mockRequest = {
                body: { email: 'admin@jawab24.com' },
                user: { userId: 'attacker', facebookId: 'fb_x' },
                log: { error: vi.fn() },
            };

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'This email address is not allowed' });
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should block the admin email case-insensitively', async () => {
            mockRequest = {
                body: { email: 'ADMIN@Jawab24.com' },
                user: { userId: 'attacker', facebookId: 'fb_x' },
                log: { error: vi.fn() },
            };

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(db.update).not.toHaveBeenCalled();
        });

        it('should ALLOW an existing admin to set the admin-listed email', async () => {
            mockRequest = {
                body: { email: 'admin@jawab24.com' },
                user: { userId: 'the_admin', facebookId: 'fb_a', isAdmin: true },
                log: { error: vi.fn() },
            };

            const mockUpdatedUser = {
                id: 'the_admin', facebookId: 'fb_a', name: 'Admin',
                email: 'admin@jawab24.com', createdAt: new Date(), updatedAt: new Date(),
            };
            const mockWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
            const mockSelectWhere = vi.fn().mockResolvedValue([mockUpdatedUser]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(db.update).toHaveBeenCalled();
            expect(mockReply.status).not.toHaveBeenCalledWith(403);
        });

        it('should allow a non-admin to set a non-admin email (guard is narrow)', async () => {
            mockRequest = {
                body: { email: 'normal@example.com' },
                user: { userId: 'user_123', facebookId: 'fb_123' },
                log: { error: vi.fn() },
            };

            const mockUpdatedUser = {
                id: 'user_123', facebookId: 'fb_123', name: 'User',
                email: 'normal@example.com', createdAt: new Date(), updatedAt: new Date(),
            };
            const mockWhere = vi.fn().mockResolvedValue(undefined);
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
            const mockSelectWhere = vi.fn().mockResolvedValue([mockUpdatedUser]);
            const mockFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            await authController.updateProfile(
                mockRequest as AuthenticatedRequest,
                mockReply as FastifyReply
            );

            expect(db.update).toHaveBeenCalled();
            expect(mockReply.status).not.toHaveBeenCalledWith(403);
        });
    });
});
