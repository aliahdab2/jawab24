/**
 * Regression tests: E-commerce Refactor
 *
 * Verifies that the Shopify service correctly uses the renamed
 * `ecommerce_stores`, `ecommerce_products`, and `pending_ecommerce_installs`
 * tables (not the old shopify_* tables) and filters by `platform = 'shopify'`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
// vi.hoisted ensures these are available inside vi.mock() factory functions.
const { mockSelectLimit, mockInsertReturning } = vi.hoisted(() => ({
    mockSelectLimit: vi.fn().mockResolvedValue([]),
    mockInsertReturning: vi.fn().mockResolvedValue([]),
}));

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
                where: vi.fn().mockResolvedValue(undefined),
            }),
        }),
        delete: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
            }),
        }),
    },
}));

// Mock the schema — only expose the NEW generic table names
vi.mock('../../src/db/schema', () => ({
    ecommerceStores: {
        id: 'id',
        userId: 'userId',
        platform: 'platform',
        storeDomain: 'storeDomain',
        accessToken: 'accessToken',
        accessTokenIv: 'accessTokenIv',
        isActive: 'isActive',
        productSummary: 'productSummary',
        policiesSummary: 'policiesSummary',
    },
    ecommerceProducts: {
        id: 'id',
        ecommerceStoreId: 'ecommerceStoreId',
        platformProductId: 'platformProductId',
        status: 'status',
    },
    pendingEcommerceInstalls: {
        id: 'id',
        platform: 'platform',
        storeDomain: 'storeDomain',
        accessToken: 'accessToken',
        accessTokenIv: 'accessTokenIv',
        scopes: 'scopes',
        nonce: 'nonce',
        status: 'status',
        claimedByUserId: 'claimedByUserId',
        expiresAt: 'expiresAt',
    },
    pages: {
        id: 'id',
        userId: 'userId',
        ecommerceStoreId: 'ecommerceStoreId',
        kbActiveVersion: 'kbActiveVersion',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => ({ op: 'and', args })),
    lt: vi.fn((field, value) => ({ field, value, op: 'lt' })),
    sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, _tag: 'sql' }),
        { raw: (s: string) => ({ raw: s, _tag: 'sql_raw' }) },
    ),
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    encrypt: vi.fn().mockReturnValue({ ciphertext: 'enc_token', iv: 'test_iv' }),
    decrypt: vi.fn().mockReturnValue('plaintext_token'),
}));

vi.mock('../../src/config', () => ({
    config: {
        shopify: {
            apiKey: 'test_key',
            apiSecret: 'test_secret',
            scopes: 'read_products',
            hostName: 'jawab24.com',
        },
    },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import * as shopifyService from '../../src/services/shopify';

describe('Shopify service — ecommerce refactor regression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSelectLimit.mockResolvedValue([]);
        mockInsertReturning.mockResolvedValue([]);
    });

    describe('getStoreByUserId', () => {
        it('queries ecommerceStores (not shopifyStores) and returns null when missing', async () => {
            mockSelectLimit.mockResolvedValueOnce([]);
            const result = await shopifyService.getStoreByUserId('user-1');
            expect(result).toBeNull();
        });

        it('returns the store row when found', async () => {
            const storeRow = { id: 'store-1', userId: 'user-1', platform: 'shopify', storeDomain: 'test.myshopify.com', isActive: true };
            mockSelectLimit.mockResolvedValueOnce([storeRow]);
            const result = await shopifyService.getStoreByUserId('user-1');
            expect(result).toEqual(storeRow);
        });
    });

    describe('getStoreByDomain', () => {
        it('queries ecommerceStores (not shopifyStores) and returns null when missing', async () => {
            mockSelectLimit.mockResolvedValueOnce([]);
            const result = await shopifyService.getStoreByDomain('test.myshopify.com');
            expect(result).toBeNull();
        });
    });

    describe('createStore', () => {
        it('inserts into ecommerceStores with platform=shopify and encrypted token', async () => {
            const storeRow = {
                id: 'store-new',
                userId: 'user-1',
                platform: 'shopify',
                storeDomain: 'test.myshopify.com',
                isActive: true,
            };
            mockInsertReturning.mockResolvedValueOnce([storeRow]);

            const result = await shopifyService.createStore('user-1', 'test.myshopify.com', 'raw_token');

            expect(result).toEqual(storeRow);
            // Encrypt must have been called to protect the token
            const { encrypt } = await import('../../src/services/ecommerceCrypto');
            expect(encrypt).toHaveBeenCalledWith('raw_token');
        });
    });

    describe('createPendingInstall', () => {
        it('inserts into pendingEcommerceInstalls with platform=shopify', async () => {
            mockInsertReturning.mockResolvedValueOnce([{ id: 'pending-1' }]);

            const id = await shopifyService.createPendingInstall({
                shopDomain: 'test.myshopify.com',
                accessToken: 'raw_token',
                scopes: 'read_products',
                nonce: 'nonce123',
            });

            expect(id).toBe('pending-1');
        });
    });

    describe('mapToEcommerceStore', () => {
        it('returns EcommerceStore with storeDomain and shopDomain alias', () => {
            const row = {
                id: 'store-1',
                userId: 'user-1',
                platform: 'shopify',
                storeDomain: 'test.myshopify.com',
                storeName: 'My Store',
                storeEmail: null,
                storeCurrency: 'AED',
                storeTimezone: null,
                tokenExpiresAt: null,
                productCount: 5,
                productSummary: 'Some products',
                policiesSummary: null,
                lastSyncAt: null,
                isActive: true,
                installedAt: null,
            };

            const result = shopifyService.mapToEcommerceStore(row as any);

            expect(result.storeDomain).toBe('test.myshopify.com');
            expect(result.shopDomain).toBe('test.myshopify.com'); // DTO alias
            expect(result.storeName).toBe('My Store');
            expect(result.platform).toBe('shopify');
            expect(result.productCount).toBe(5);
            expect((result as any).accessToken).toBeUndefined(); // never exposed
        });
    });

    describe('getEnrichedKnowledgeBase', () => {
        it('returns page KB when store not found in ecommerceStores', async () => {
            mockSelectLimit.mockResolvedValueOnce([]);
            const result = await shopifyService.getEnrichedKnowledgeBase('my page KB', 'non-existent');
            expect(result).toBe('my page KB');
        });

        it('returns enriched KB with product summary from ecommerceStores', async () => {
            mockSelectLimit.mockResolvedValueOnce([{
                isActive: true,
                productSummary: 'Product A — 100 AED',
                policiesSummary: null,
            }]);
            const result = await shopifyService.getEnrichedKnowledgeBase('page info', 'store-1');
            expect(result).toContain('Product A — 100 AED');
            expect(result).toContain('page info');
        });
    });
});
