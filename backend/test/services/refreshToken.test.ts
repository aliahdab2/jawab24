import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock database — capture arguments passed to .values() and .set()
const mockSelect = vi.fn();
const mockInsertValues = vi.fn();
const mockSetArgs = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock('../../src/db', () => ({
    db: {
        select: () => ({ from: () => ({ where: mockSelect }) }),
        insert: () => ({ values: (...args: unknown[]) => mockInsertValues(...args) }),
        update: () => ({
            set: (...args: unknown[]) => {
                mockSetArgs(...args);
                return { where: mockUpdateWhere };
            },
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    refreshTokens: { id: 'id', tokenHash: 'token_hash', userId: 'user_id' },
    users: {},
    subscriptions: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((_col: unknown, val: unknown) => val),
}));

const mockGetUserById = vi.fn();
vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: (...args: unknown[]) => mockGetUserById(...args),
    },
}));

import { RefreshTokenService } from '../../src/services/refreshToken';

describe('RefreshTokenService', () => {
    let service: RefreshTokenService;

    const mockUser = {
        id: 'user_123',
        facebookId: 'fb_123',
        name: 'Test User',
        email: 'test@example.com',
        picture: null,
        facebookAccessToken: null,
        facebookTokenExpiresAt: null,
        isAdmin: false,
        hasInstagramPermission: false,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        service = new RefreshTokenService();
        vi.clearAllMocks();
    });

    describe('createRefreshToken', () => {
        it('should generate a random token and store its hash', async () => {
            mockInsertValues.mockResolvedValue(undefined);

            const token = await service.createRefreshToken('user_123');

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            // Token should be 80 hex chars (40 random bytes)
            expect(token).toMatch(/^[0-9a-f]{80}$/);
            expect(mockInsertValues).toHaveBeenCalledTimes(1);
        });

        it('should store hashed token and correct userId in DB', async () => {
            mockInsertValues.mockResolvedValue(undefined);

            const rawToken = await service.createRefreshToken('user_123');
            const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');

            // Verify the actual values passed to db.insert().values()
            const insertArg = mockInsertValues.mock.calls[0][0];
            expect(insertArg.userId).toBe('user_123');
            expect(insertArg.tokenHash).toBe(expectedHash);
            expect(insertArg.tokenHash).not.toBe(rawToken); // Hash, not raw
            expect(insertArg.expiresAt).toBeInstanceOf(Date);
        });

        it('should set expiry to approximately 7 days from now', async () => {
            mockInsertValues.mockResolvedValue(undefined);

            const before = Date.now();
            await service.createRefreshToken('user_123');
            const after = Date.now();

            const insertArg = mockInsertValues.mock.calls[0][0];
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            expect(insertArg.expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs);
            expect(insertArg.expiresAt.getTime()).toBeLessThanOrEqual(after + sevenDaysMs);
        });

        it('should generate unique tokens on each call', async () => {
            mockInsertValues.mockResolvedValue(undefined);

            const token1 = await service.createRefreshToken('user_123');
            const token2 = await service.createRefreshToken('user_123');

            expect(token1).not.toBe(token2);
        });
    });

    describe('rotateRefreshToken', () => {
        it('should return null for unknown token', async () => {
            mockSelect.mockResolvedValue([]);

            const result = await service.rotateRefreshToken('unknown_token_hex');

            expect(result).toBeNull();
        });

        it('should return null for revoked token', async () => {
            mockSelect.mockResolvedValue([{
                id: 'rt_1',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                expiresAt: new Date(Date.now() + 86400000),
                revokedAt: new Date(), // Revoked
                createdAt: new Date(),
            }]);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
            expect(mockGetUserById).not.toHaveBeenCalled();
        });

        it('should return null for expired token', async () => {
            mockSelect.mockResolvedValue([{
                id: 'rt_1',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                expiresAt: new Date(Date.now() - 1000), // Expired
                revokedAt: null,
                createdAt: new Date(),
            }]);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
            expect(mockGetUserById).not.toHaveBeenCalled();
        });

        it('should return null if user not found', async () => {
            mockSelect.mockResolvedValue([{
                id: 'rt_1',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                expiresAt: new Date(Date.now() + 86400000),
                revokedAt: null,
                createdAt: new Date(),
            }]);
            mockGetUserById.mockResolvedValue(null);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
        });

        it('should revoke old token and create new one on success', async () => {
            mockSelect.mockResolvedValue([{
                id: 'rt_1',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                expiresAt: new Date(Date.now() + 86400000),
                revokedAt: null,
                createdAt: new Date(),
            }]);
            mockGetUserById.mockResolvedValue(mockUser);
            mockUpdateWhere.mockResolvedValue(undefined);
            mockInsertValues.mockResolvedValue(undefined);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).not.toBeNull();
            expect(result!.user).toEqual(mockUser);
            expect(typeof result!.newRefreshToken).toBe('string');
            expect(result!.newRefreshToken.length).toBe(80);
            // Old token should be revoked: .set({ revokedAt: <Date> })
            expect(mockSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({ revokedAt: expect.any(Date) }),
            );
            // New token should be created
            expect(mockInsertValues).toHaveBeenCalledTimes(1);
        });

        it('should return a different token than the one provided', async () => {
            mockSelect.mockResolvedValue([{
                id: 'rt_1',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                expiresAt: new Date(Date.now() + 86400000),
                revokedAt: null,
                createdAt: new Date(),
            }]);
            mockGetUserById.mockResolvedValue(mockUser);
            mockUpdateWhere.mockResolvedValue(undefined);
            mockInsertValues.mockResolvedValue(undefined);

            const oldToken = 'a'.repeat(80);
            const result = await service.rotateRefreshToken(oldToken);

            expect(result).not.toBeNull();
            expect(result!.newRefreshToken).not.toBe(oldToken);
        });
    });

    describe('revokeRefreshToken', () => {
        it('should hash the raw token and set revokedAt', async () => {
            mockUpdateWhere.mockResolvedValue(undefined);

            await service.revokeRefreshToken('some_raw_token');

            // Verify .set() was called with revokedAt as a Date
            expect(mockSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({ revokedAt: expect.any(Date) }),
            );
            expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
        });

        it('should not throw if token does not exist', async () => {
            mockUpdateWhere.mockResolvedValue(undefined);

            await expect(
                service.revokeRefreshToken('nonexistent_token')
            ).resolves.not.toThrow();
        });

        it('should not throw if token is already revoked', async () => {
            mockUpdateWhere.mockResolvedValue(undefined);

            await expect(
                service.revokeRefreshToken('already_revoked_token')
            ).resolves.not.toThrow();
        });
    });

    describe('token hashing', () => {
        it('should store SHA-256 hash (64 hex chars) not the raw token', async () => {
            mockInsertValues.mockResolvedValue(undefined);

            const rawToken = await service.createRefreshToken('user_123');
            const insertArg = mockInsertValues.mock.calls[0][0];

            // Hash should be 64 hex chars (SHA-256)
            expect(insertArg.tokenHash).toMatch(/^[0-9a-f]{64}$/);
            // Hash should NOT be the raw token
            expect(insertArg.tokenHash).not.toBe(rawToken);
            // Hash should match what we'd compute from the raw token
            const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            expect(insertArg.tokenHash).toBe(expectedHash);
        });

        it('different tokens should produce different hashes in DB', async () => {
            mockInsertValues.mockResolvedValue(undefined);

            await service.createRefreshToken('user_123');
            await service.createRefreshToken('user_123');

            const hash1 = mockInsertValues.mock.calls[0][0].tokenHash;
            const hash2 = mockInsertValues.mock.calls[1][0].tokenHash;
            expect(hash1).not.toBe(hash2);
        });
    });
});
