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
    refreshTokens: {
        id: 'id',
        tokenHash: 'token_hash',
        userId: 'user_id',
        familyId: 'family_id',
        revokedAt: 'revoked_at',
        replacedByTokenHash: 'replaced_by_token_hash',
    },
    users: {},
    subscriptions: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((_col: unknown, val: unknown) => val),
    and: vi.fn((...conds: unknown[]) => ({ and: conds })),
    isNull: vi.fn((col: unknown) => ({ isNull: col })),
    isNotNull: vi.fn((col: unknown) => ({ isNotNull: col })),
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

        it('should set expiry to approximately 60 days from now', async () => {
            mockInsertValues.mockResolvedValue(undefined);

            const before = Date.now();
            await service.createRefreshToken('user_123');
            const after = Date.now();

            const insertArg = mockInsertValues.mock.calls[0][0];
            const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
            expect(insertArg.expiresAt.getTime()).toBeGreaterThanOrEqual(before + sixtyDaysMs);
            expect(insertArg.expiresAt.getTime()).toBeLessThanOrEqual(after + sixtyDaysMs);
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

        it('should return null for logout-revoked token (no successor), even seconds after revocation', async () => {
            mockSelect.mockResolvedValue([{
                id: 'rt_1',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                expiresAt: new Date(Date.now() + 86400000),
                revokedAt: new Date(), // Revoked by logout — replacedByTokenHash null
                replacedByTokenHash: null,
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

        it('should record the successor hash on the revoked row (marks rotation, enables grace)', async () => {
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

            const expectedHash = crypto.createHash('sha256').update(result!.newRefreshToken).digest('hex');
            expect(mockSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({ revokedAt: expect.any(Date), replacedByTokenHash: expectedHash }),
            );
        });
    });

    // Two-tab race regression (prod 2026-07-30): tabs sharing one cookie jar race a
    // refresh; the loser presents the just-rotated predecessor. Strict single-use
    // rotation 401'd it and the frontend killed the whole session.
    describe('rotation reuse-grace window', () => {
        const rotatedRecord = (revokedAgoMs: number, overrides: Record<string, unknown> = {}) => ({
            id: 'rt_1',
            userId: 'user_123',
            tokenHash: 'hash_abc',
            familyId: 'fam_1',
            expiresAt: new Date(Date.now() + 86400000),
            revokedAt: new Date(Date.now() - revokedAgoMs),
            replacedByTokenHash: 'hash_of_successor',
            createdAt: new Date(),
            ...overrides,
        });

        /** Family-terminated probe finds nothing → family still alive. */
        const familyAlive = () => mockSelect.mockResolvedValueOnce([]);

        it('accepts a rotation-revoked token within the grace window and mints a fresh successor', async () => {
            mockSelect.mockResolvedValueOnce([rotatedRecord(30_000)]); // rotated 30s ago
            familyAlive();
            mockGetUserById.mockResolvedValue(mockUser);
            mockInsertValues.mockResolvedValue(undefined);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).not.toBeNull();
            expect(result!.user).toEqual(mockUser);
            expect(result!.newRefreshToken).toMatch(/^[0-9a-f]{80}$/);
            // Successor joins the SAME family so it stays revocable with it
            expect(mockInsertValues.mock.calls[0][0].familyId).toBe('fam_1');
            // The predecessor row is left untouched — no second revocation write
            expect(mockSetArgs).not.toHaveBeenCalled();
        });

        it('rejects a rotation-revoked token beyond the grace window (potential replay)', async () => {
            mockSelect.mockResolvedValueOnce([rotatedRecord(120_000)]); // rotated 2min ago
            mockUpdateWhere.mockResolvedValue(undefined);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
            expect(mockGetUserById).not.toHaveBeenCalled();
        });

        it('reuse detection: beyond-grace replay revokes the whole family (RFC 9700 §4.14.2)', async () => {
            mockSelect.mockResolvedValueOnce([rotatedRecord(120_000)]);
            mockUpdateWhere.mockResolvedValue(undefined);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
            // Family-wide revocation — reaches grace-minted branches a
            // replacedByTokenHash chain walk could never have found. It must NOT
            // write replacedByTokenHash: that absence marks the family terminated.
            expect(mockSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({ revokedAt: expect.any(Date) }),
            );
            expect(mockSetArgs.mock.calls[0][0]).not.toHaveProperty('replacedByTokenHash');
        });

        it('reuse detection does NOT fire for terminally-revoked tokens (nothing left to kill)', async () => {
            mockSelect.mockResolvedValueOnce([rotatedRecord(120_000, { replacedByTokenHash: null })]);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
            expect(mockSetArgs).not.toHaveBeenCalled();
        });

        // Security review finding: without this check, grace would undo an
        // explicit logout for up to 60s for anyone holding the predecessor.
        it('refuses grace reuse once the family was terminated by logout', async () => {
            mockSelect
                .mockResolvedValueOnce([rotatedRecord(30_000)])
                // Family-terminated probe: a sibling revoked WITHOUT a successor
                .mockResolvedValueOnce([{ id: 'rt_2' }]);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
            expect(mockGetUserById).not.toHaveBeenCalled();
            expect(mockInsertValues).not.toHaveBeenCalled();
        });

        it('rejects an expired token even within the grace window', async () => {
            mockSelect.mockResolvedValueOnce([rotatedRecord(30_000, { expiresAt: new Date(Date.now() - 1000) })]);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
        });

        it('rejects grace reuse when the user no longer exists', async () => {
            mockSelect.mockResolvedValueOnce([rotatedRecord(30_000)]);
            familyAlive();
            mockGetUserById.mockResolvedValue(null);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).toBeNull();
        });

        it('a legacy row with no familyId adopts its own id as the family root', async () => {
            mockSelect.mockResolvedValueOnce([{
                id: 'rt_legacy',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                familyId: null, // predates the column
                expiresAt: new Date(Date.now() + 86400000),
                revokedAt: null,
                replacedByTokenHash: null,
                createdAt: new Date(),
            }]);
            mockGetUserById.mockResolvedValue(mockUser);
            mockUpdateWhere.mockResolvedValue(undefined);
            mockInsertValues.mockResolvedValue(undefined);

            const result = await service.rotateRefreshToken('some_raw_token');

            expect(result).not.toBeNull();
            expect(mockInsertValues.mock.calls[0][0].familyId).toBe('rt_legacy');
            // The legacy row is backfilled so it joins the family it just started
            expect(mockSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({ familyId: 'rt_legacy' }),
            );
        });
    });

    describe('revokeRefreshToken (logout)', () => {
        it('should hash the raw token and set revokedAt', async () => {
            mockSelect.mockResolvedValue([]);
            mockUpdateWhere.mockResolvedValue(undefined);

            await service.revokeRefreshToken('some_raw_token');

            // Verify .set() was called with revokedAt as a Date
            expect(mockSetArgs).toHaveBeenCalledWith(
                expect.objectContaining({ revokedAt: expect.any(Date) }),
            );
            expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
        });

        // Without family-wide revocation, a successor minted through the grace
        // window survives the logout that was meant to end the session.
        it('revokes the whole family so a grace-minted successor cannot outlive logout', async () => {
            mockSelect.mockResolvedValue([{
                id: 'rt_1',
                userId: 'user_123',
                tokenHash: 'hash_abc',
                familyId: 'fam_1',
                expiresAt: new Date(Date.now() + 86400000),
                revokedAt: null,
                replacedByTokenHash: null,
                createdAt: new Date(),
            }]);
            mockUpdateWhere.mockResolvedValue(undefined);

            await service.revokeRefreshToken('some_raw_token');

            // Two writes: the presented row, then the rest of the live family
            expect(mockUpdateWhere).toHaveBeenCalledTimes(2);
            expect(mockSetArgs).toHaveBeenLastCalledWith(
                expect.objectContaining({ revokedAt: expect.any(Date) }),
            );
        });

        it('should not throw if token does not exist', async () => {
            mockSelect.mockResolvedValue([]);
            mockUpdateWhere.mockResolvedValue(undefined);

            await expect(
                service.revokeRefreshToken('nonexistent_token')
            ).resolves.not.toThrow();
        });

        it('should not throw if token is already revoked', async () => {
            mockSelect.mockResolvedValue([]);
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
