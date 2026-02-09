import { describe, it, expect, vi, beforeEach } from 'vitest';

// Vitest hoists vi.mock calls to the top. Variables used inside must be
// declared with vi.hoisted() or the factory must be self-contained.

vi.mock('../../src/config', () => ({
    config: {
        shopify: {
            apiKey: 'test_key',
            apiSecret: 'test_secret',
            scopes: 'read_products',
            hostName: 'jawab24.com',
            tokenEncryptionKey: 'test-encryption-key-must-be-32-chars-long!!',
        },
    },
}));

vi.mock('../../src/services/shopifyCrypto', () => ({
    encrypt: vi.fn().mockReturnValue({ ciphertext: 'encrypted_token', iv: 'test_iv' }),
    decrypt: vi.fn().mockReturnValue('decrypted_access_token'),
}));

// Use vi.hoisted for shared mock state
const { mockSelectLimit, mockInsertReturning, mockUpdateWhere, mockDeleteReturning } = vi.hoisted(() => {
    const mockSelectLimit = vi.fn().mockResolvedValue([]);
    const mockInsertReturning = vi.fn().mockResolvedValue([]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    const mockDeleteReturning = vi.fn().mockResolvedValue([]);
    return { mockSelectLimit, mockInsertReturning, mockUpdateWhere, mockDeleteReturning };
});

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: mockSelectLimit,
                }),
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockReturnValue({
                    returning: mockInsertReturning,
                }),
                returning: mockInsertReturning,
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: mockUpdateWhere,
            }),
        }),
        delete: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: mockDeleteReturning,
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    shopifyStores: { id: 'id', shopDomain: 'shopDomain', userId: 'userId', isActive: 'isActive' },
    shopifyProducts: { shopifyStoreId: 'shopifyStoreId', status: 'status' },
    pages: { id: 'id', userId: 'userId', shopifyStoreId: 'shopifyStoreId' },
    pendingShopifyInstalls: {
        id: 'id', shopDomain: 'shopDomain', accessToken: 'accessToken',
        accessTokenIv: 'accessTokenIv', scopes: 'scopes', nonce: 'nonce',
        status: 'status', claimedByUserId: 'claimedByUserId', expiresAt: 'expiresAt',
    },
}));

// Import after mocks
import * as shopifyService from '../../src/services/shopify';

describe('Pending Install Flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSelectLimit.mockResolvedValue([]);
        mockInsertReturning.mockResolvedValue([]);
        mockDeleteReturning.mockResolvedValue([]);
    });

    describe('createPendingInstall', () => {
        it('should create a pending install and return its ID', async () => {
            mockInsertReturning.mockResolvedValueOnce([{ id: 'pending-uuid-123' }]);

            const result = await shopifyService.createPendingInstall({
                shopDomain: 'test.myshopify.com',
                accessToken: 'shpat_test_token',
                scopes: 'read_products',
                nonce: 'test_nonce',
            });

            expect(result).toBe('pending-uuid-123');
        });

        it('should encrypt the access token before storage', async () => {
            const { encrypt } = await import('../../src/services/shopifyCrypto');
            mockInsertReturning.mockResolvedValueOnce([{ id: 'test-id' }]);

            await shopifyService.createPendingInstall({
                shopDomain: 'test.myshopify.com',
                accessToken: 'shpat_secret_token',
                scopes: 'read_products',
                nonce: 'nonce123',
            });

            expect(encrypt).toHaveBeenCalledWith('shpat_secret_token');
        });
    });

    describe('claimPendingInstall', () => {
        it('should return null for non-existent pending install', async () => {
            mockSelectLimit.mockResolvedValueOnce([]);

            const result = await shopifyService.claimPendingInstall('non-existent-id', 'user-123');
            expect(result).toBeNull();
        });

        it('should return null for expired pending install', async () => {
            mockSelectLimit.mockResolvedValueOnce([{
                id: 'pending-123',
                shopDomain: 'test.myshopify.com',
                accessToken: 'encrypted',
                accessTokenIv: 'iv',
                status: 'pending',
                expiresAt: new Date(Date.now() - 60000), // expired
            }]);

            const result = await shopifyService.claimPendingInstall('pending-123', 'user-123');
            expect(result).toBeNull();
        });

        it('should return null for already claimed install', async () => {
            mockSelectLimit.mockResolvedValueOnce([{
                id: 'pending-123',
                shopDomain: 'test.myshopify.com',
                accessToken: 'encrypted',
                accessTokenIv: 'iv',
                status: 'claimed',
                expiresAt: new Date(Date.now() + 300000),
            }]);

            const result = await shopifyService.claimPendingInstall('pending-123', 'user-123');
            expect(result).toBeNull();
        });

        it('should throw if shop is already linked to another active user', async () => {
            mockSelectLimit
                // pending install
                .mockResolvedValueOnce([{
                    id: 'pending-123',
                    shopDomain: 'test.myshopify.com',
                    accessToken: 'encrypted',
                    accessTokenIv: 'iv',
                    status: 'pending',
                    expiresAt: new Date(Date.now() + 300000),
                }])
                // getStoreByDomain returns existing active store for different user
                .mockResolvedValueOnce([{
                    id: 'store-abc',
                    userId: 'different-user',
                    shopDomain: 'test.myshopify.com',
                    isActive: true,
                }]);

            await expect(
                shopifyService.claimPendingInstall('pending-123', 'user-123')
            ).rejects.toThrow('already connected to another account');
        });

        it('should create store and mark as claimed on success', async () => {
            const storeRow = {
                id: 'store-new',
                userId: 'user-123',
                shopDomain: 'test.myshopify.com',
                isActive: true,
            };

            mockSelectLimit
                // pending install
                .mockResolvedValueOnce([{
                    id: 'pending-123',
                    shopDomain: 'test.myshopify.com',
                    accessToken: 'encrypted',
                    accessTokenIv: 'test_iv',
                    status: 'pending',
                    expiresAt: new Date(Date.now() + 300000),
                }])
                // getStoreByDomain returns null
                .mockResolvedValueOnce([]);

            mockInsertReturning.mockResolvedValueOnce([storeRow]);

            // Mock registerWebhooks
            vi.spyOn(shopifyService, 'registerWebhooks' as any).mockResolvedValue(undefined);

            const result = await shopifyService.claimPendingInstall('pending-123', 'user-123');
            expect(result).toEqual(storeRow);
        });
    });

    describe('cleanupExpiredInstalls', () => {
        it('should return count of deleted expired records', async () => {
            mockDeleteReturning.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);

            const count = await shopifyService.cleanupExpiredInstalls();
            expect(count).toBe(2);
        });

        it('should return 0 when no expired records', async () => {
            mockDeleteReturning.mockResolvedValueOnce([]);

            const count = await shopifyService.cleanupExpiredInstalls();
            expect(count).toBe(0);
        });
    });
});
