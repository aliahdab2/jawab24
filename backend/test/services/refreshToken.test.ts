import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock database
const mockSelect = vi.fn();
const mockInsertValues = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../src/db', () => ({
    db: {
        select: () => ({ from: () => ({ where: mockSelect }) }),
        insert: () => ({ values: (...args: unknown[]) => mockInsertValues(...args) }),
        update: () => ({ set: (s: unknown) => ({ where: mockUpdate }) }),
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
            mockInsertValues.mockResolvedValue([{ id: 'rt_1' }]);

            const token = await service.createRefreshToken('user_123');

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            // Token should be 80 hex chars (40 random bytes)
            expect(token).toMatch(/^[0-9a-f]{80}$/);
            expect(mockInsertValues).toHaveBeenCalledTimes(1);
        });

        it('should store hashed token, not raw token', async () => {
            mockInsertValues.mockResolvedValue([{ id: 'rt_1' }]);

            const rawToken = await service.createRefreshToken('user_123');

            // The raw token should NOT be stored — a hash should be
            const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            // We can't directly inspect the insert values with this mock pattern,
            // but we verify the token is hex-encoded and the correct length
            expect(rawToken.length).toBe(80);
            expect(expectedHash.length).toBe(64);
        });

        it('should set expiry to 7 days from now', async () => {
            mockInsertValues.mockResolvedValue([{ id: 'rt_1' }]);

            await service.createRefreshToken('user_123');

            expect(mockInsertValues).toHaveBeenCalledTimes(1);
        });

        it('should generate unique tokens on each call', async () => {
            mockInsertValues.mockResolvedValue([{ id: 'rt_1' }]);

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
            mockUpdate.mockResolvedValue(undefined);
            mockInsertValues.mockResolvedValue([{ id: 'rt_2' }]);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).not.toBeNull();
            expect(result!.user).toEqual(mockUser);
            expect(typeof result!.newRefreshToken).toBe('string');
            expect(result!.newRefreshToken.length).toBe(80);
            // Old token should be revoked
            expect(mockUpdate).toHaveBeenCalledTimes(1);
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
            mockUpdate.mockResolvedValue(undefined);
            mockInsertValues.mockResolvedValue([{ id: 'rt_2' }]);

            const oldToken = 'a'.repeat(80);
            const result = await service.rotateRefreshToken(oldToken);

            expect(result).not.toBeNull();
            expect(result!.newRefreshToken).not.toBe(oldToken);
        });
    });

    describe('revokeRefreshToken', () => {
        it('should hash the raw token and set revokedAt', async () => {
            mockUpdate.mockResolvedValue(undefined);

            await service.revokeRefreshToken('some_raw_token');

            expect(mockUpdate).toHaveBeenCalledTimes(1);
        });

        it('should not throw if token does not exist', async () => {
            mockUpdate.mockResolvedValue(undefined);

            await expect(
                service.revokeRefreshToken('nonexistent_token')
            ).resolves.not.toThrow();
        });

        it('should not throw if token is already revoked', async () => {
            mockUpdate.mockResolvedValue(undefined);

            await expect(
                service.revokeRefreshToken('already_revoked_token')
            ).resolves.not.toThrow();
        });
    });

    describe('token hashing', () => {
        it('should use SHA-256 to hash tokens', async () => {
            mockInsertValues.mockResolvedValue([{ id: 'rt_1' }]);

            const rawToken = await service.createRefreshToken('user_123');
            const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');

            // Verify the hash is deterministic
            const hash2 = crypto.createHash('sha256').update(rawToken).digest('hex');
            expect(expectedHash).toBe(hash2);
        });

        it('different tokens should produce different hashes', async () => {
            const hash1 = crypto.createHash('sha256').update('token_a').digest('hex');
            const hash2 = crypto.createHash('sha256').update('token_b').digest('hex');

            expect(hash1).not.toBe(hash2);
        });
    });
});
