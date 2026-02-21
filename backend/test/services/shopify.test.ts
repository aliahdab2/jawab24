import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// --- Mocks ---

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

const txProxy = {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    update: () => mockUpdate(),
    delete: () => mockDelete(),
};

const mockExecute = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/db', () => ({
    db: {
        select: () => mockSelect(),
        insert: () => mockInsert(),
        update: () => mockUpdate(),
        delete: () => mockDelete(),
        execute: (...args: unknown[]) => mockExecute(...args),
        transaction: async (fn: (tx: typeof txProxy) => Promise<void>) => fn(txProxy),
    },
}));

vi.mock('../../src/db/schema', () => ({
    ecommerceStores: {
        id: 'id',
        userId: 'user_id',
        storeDomain: 'store_domain',
        platform: 'platform',
        isActive: 'is_active',
    },
    ecommerceProducts: {
        ecommerceStoreId: 'ecommerce_store_id',
        status: 'status',
    },
    pages: {
        id: 'id',
        userId: 'user_id',
        ecommerceStoreId: 'ecommerce_store_id',
        kbActiveVersion: 'kb_active_version',
    },
    pendingEcommerceInstalls: {
        id: 'id',
        platform: 'platform',
        storeDomain: 'store_domain',
        status: 'status',
        expiresAt: 'expires_at',
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

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

vi.mock('../../src/config', () => ({
    config: {
        shopify: {
            apiKey: 'test_api_key',
            apiSecret: 'test_api_secret',
            scopes: 'read_products,read_content',
            hostName: 'jawab24.com',
        },
    },
}));

// Mock Redis
const mockRedisScan = vi.fn().mockResolvedValue(['0', []]);
const mockRedisDel = vi.fn().mockResolvedValue(0);
vi.mock('../../src/lib/redis', () => ({
    redis: {
        scan: (...args: unknown[]) => mockRedisScan(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        quit: vi.fn(),
    },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocks
import {
    buildAuthUrl,
    verifyWebhookHmac,
    buildVariantSummary,
    getEnrichedKnowledgeBase,
    mapToEcommerceStore,
    exchangeCodeForToken,
    registerWebhooks,
    linkStoreToPage,
    invalidateCachesForStore,
} from '../../src/services/shopify';

describe('Shopify Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- buildAuthUrl ---

    describe('buildAuthUrl', () => {
        it('should build a valid OAuth URL', () => {
            const url = buildAuthUrl('test-store.myshopify.com', 'abc123');

            expect(url).toContain('test-store.myshopify.com/admin/oauth/authorize');
            expect(url).toContain('client_id=test_api_key');
            expect(url).toContain('scope=read_products,read_content');
            expect(url).toContain('state=abc123');
            expect(url).toContain(encodeURIComponent('https://jawab24.com/shopify/auth/callback'));
        });

        it('should encode the redirect URI', () => {
            const url = buildAuthUrl('my-store.myshopify.com', 'state123');
            expect(url).toContain('redirect_uri=');
            expect(url).not.toContain('redirect_uri=https://'); // Should be encoded
        });
    });

    // --- verifyWebhookHmac ---

    describe('verifyWebhookHmac', () => {
        it('should return true for a valid HMAC', () => {
            const body = '{"test": "data"}';
            const hash = crypto
                .createHmac('sha256', 'test_api_secret')
                .update(body, 'utf8')
                .digest('base64');

            expect(verifyWebhookHmac(body, hash)).toBe(true);
        });

        it('should return false for an invalid HMAC', () => {
            const body = '{"test": "data"}';
            expect(verifyWebhookHmac(body, 'invalid_hmac_value')).toBe(false);
        });

        it('should return false for mismatched body content', () => {
            const body = '{"test": "data"}';
            const hash = crypto
                .createHmac('sha256', 'test_api_secret')
                .update('different body', 'utf8')
                .digest('base64');

            expect(verifyWebhookHmac(body, hash)).toBe(false);
        });

        it('should return false for different length buffers', () => {
            expect(verifyWebhookHmac('body', 'short')).toBe(false);
        });
    });

    // --- exchangeCodeForToken ---

    describe('exchangeCodeForToken', () => {
        it('should exchange code for access token', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'shpat_test123' }),
            });

            const token = await exchangeCodeForToken('test-store.myshopify.com', 'auth_code_123');

            expect(token).toBe('shpat_test123');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-store.myshopify.com/admin/oauth/access_token',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('auth_code_123'),
                })
            );
        });

        it('should throw on failed token exchange', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

            await expect(
                exchangeCodeForToken('test-store.myshopify.com', 'bad_code')
            ).rejects.toThrow('Shopify token exchange failed: 400');
        });
    });

    // --- registerWebhooks ---

    describe('registerWebhooks', () => {
        it('should register both webhooks', async () => {
            mockFetch.mockResolvedValue({ ok: true });

            await registerWebhooks('test-store.myshopify.com', 'token123');

            expect(mockFetch).toHaveBeenCalledTimes(2);
            // First call: app/uninstalled
            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-store.myshopify.com/admin/api/2025-01/webhooks.json',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('app/uninstalled'),
                })
            );
            // Second call: products/update
            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-store.myshopify.com/admin/api/2025-01/webhooks.json',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('products/update'),
                })
            );
        });

        it('should not throw on 422 (already exists)', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 422,
                text: async () => 'already exists',
            });

            // Should not throw
            await registerWebhooks('test-store.myshopify.com', 'token123');
        });

        it('should log error on non-422 failure but not throw', async () => {
            mockCaptureError.mockClear();
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => 'server error',
            });

            await registerWebhooks('test-store.myshopify.com', 'token123');
            expect(mockCaptureError).toHaveBeenCalled();
        });
    });

    // --- buildVariantSummary ---

    describe('buildVariantSummary', () => {
        it('should group options by name', () => {
            const variants = [
                {
                    title: 'S / Black',
                    selectedOptions: [
                        { name: 'Size', value: 'S' },
                        { name: 'Color', value: 'Black' },
                    ],
                },
                {
                    title: 'M / Black',
                    selectedOptions: [
                        { name: 'Size', value: 'M' },
                        { name: 'Color', value: 'Black' },
                    ],
                },
                {
                    title: 'S / White',
                    selectedOptions: [
                        { name: 'Size', value: 'S' },
                        { name: 'Color', value: 'White' },
                    ],
                },
            ];

            const result = buildVariantSummary(variants);
            expect(result).toContain('Size: S, M');
            expect(result).toContain('Color: Black, White');
            expect(result).toContain(' | ');
        });

        it('should skip Default Title variants', () => {
            const variants = [
                {
                    title: 'Default Title',
                    selectedOptions: [{ name: 'Title', value: 'Default Title' }],
                },
            ];

            const result = buildVariantSummary(variants);
            expect(result).toBe('');
        });

        it('should handle empty variants', () => {
            expect(buildVariantSummary([])).toBe('');
        });

        it('should handle single option group', () => {
            const variants = [
                { title: 'S', selectedOptions: [{ name: 'Size', value: 'S' }] },
                { title: 'M', selectedOptions: [{ name: 'Size', value: 'M' }] },
                { title: 'L', selectedOptions: [{ name: 'Size', value: 'L' }] },
            ];

            const result = buildVariantSummary(variants);
            expect(result).toBe('Size: S, M, L');
        });
    });

    // --- linkStoreToPage ---

    describe('linkStoreToPage', () => {
        it('should throw if page does not belong to user', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            await expect(
                linkStoreToPage('store-1', 'page-1', 'user-1')
            ).rejects.toThrow('Page not found or does not belong to user');
        });

        it('should link page when user owns it', async () => {
            const mockWhere = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'page-1', userId: 'user-1' }]),
            });
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({ where: mockWhere }),
            });

            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            mockUpdate.mockReturnValue({
                set: mockSet,
            });

            await linkStoreToPage('store-1', 'page-1', 'user-1');
            expect(mockUpdate).toHaveBeenCalled();
        });
    });

    // --- getEnrichedKnowledgeBase ---

    describe('getEnrichedKnowledgeBase', () => {
        it('should return pageKB when store not found', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('page KB content', 'non-existent');
            expect(result).toBe('page KB content');
        });

        it('should return pageKB when store is inactive', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ isActive: false }]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('page KB', 'store-1');
            expect(result).toBe('page KB');
        });

        it('should prioritize Shopify data over page KB', async () => {
            const store = {
                isActive: true,
                productSummary: 'Product A — 100 AED\nProduct B — 200 AED',
                policiesSummary: 'Shipping: 2-3 days',
            };
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([store]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('My page info', 'store-1');
            expect(result).toContain('Product A — 100 AED');
            expect(result).toContain('Shipping: 2-3 days');
            expect(result).toContain('My page info');
        });

        it('should truncate page KB to stay under 1500 chars', async () => {
            const longProductSummary = 'X'.repeat(1400);
            const store = {
                isActive: true,
                productSummary: longProductSummary,
                policiesSummary: null,
            };
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([store]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('Page KB that should be truncated', 'store-1');
            expect(result.length).toBeLessThanOrEqual(1500 + 10); // Allow for separator
        });

        it('should skip page KB when remaining space is less than 100 chars', async () => {
            const store = {
                isActive: true,
                productSummary: 'X'.repeat(1450),
                policiesSummary: null,
            };
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([store]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('Should be excluded', 'store-1');
            expect(result).not.toContain('Should be excluded');
        });

        it('should return empty string when no data available', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase(undefined, 'non-existent');
            expect(result).toBe('');
        });
    });

    // --- mapToEcommerceStore ---

    describe('mapToEcommerceStore', () => {
        it('should map database row to EcommerceStore type', () => {
            const row = {
                id: 'store-1',
                userId: 'user-1',
                platform: 'shopify',
                storeDomain: 'test.myshopify.com',
                accessToken: 'shpat_xxx',
                storeName: 'Test Store',
                storeEmail: 'test@example.com',
                storeCurrency: 'AED',
                storeTimezone: 'GST',
                platformData: { planName: 'basic' },
                productCount: 42,
                productSummary: 'Products summary',
                policiesSummary: 'Policies summary',
                lastSyncAt: new Date('2026-01-01'),
                isActive: true,
                installedAt: new Date('2025-12-01'),
                uninstalledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = mapToEcommerceStore(row as any);

            expect(result.id).toBe('store-1');
            expect(result.userId).toBe('user-1');
            expect(result.storeDomain).toBe('test.myshopify.com');
            expect(result.shopDomain).toBe('test.myshopify.com'); // DTO alias
            expect(result.storeName).toBe('Test Store');
            expect(result.productCount).toBe(42);
            expect(result.isActive).toBe(true);
            // Should NOT expose accessToken
            expect((result as any).accessToken).toBeUndefined();
        });

        it('should default productCount to 0 when null', () => {
            const row = {
                id: 'store-1',
                userId: 'user-1',
                platform: 'shopify',
                storeDomain: 'test.myshopify.com',
                productCount: null,
                isActive: null,
            };

            const result = mapToEcommerceStore(row as any);
            expect(result.productCount).toBe(0);
            expect(result.isActive).toBe(true);
        });
    });

    // --- invalidateCachesForStore ---

    describe('invalidateCachesForStore', () => {
        /** Helper: mock db.select().from(pages).where(...) to return linked pages */
        function mockLinkedPages(pageIds: string[]) {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(pageIds.map(id => ({ id }))),
                }),
            });
        }

        it('should return 0 and skip work when no pages linked', async () => {
            mockLinkedPages([]);

            const result = await invalidateCachesForStore('store-1');

            expect(result).toBe(0);
            expect(mockUpdate).not.toHaveBeenCalled();
            expect(mockRedisScan).not.toHaveBeenCalled();
        });

        it('should bump kbActiveVersion on all linked pages', async () => {
            mockLinkedPages(['page-1', 'page-2']);

            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            mockUpdate.mockReturnValue({ set: mockSet });

            await invalidateCachesForStore('store-1');

            // Should have called update for each page
            expect(mockUpdate).toHaveBeenCalledTimes(2);
        });

        it('should scan and delete Redis ai_reply cache keys', async () => {
            mockLinkedPages(['page-1']);

            mockUpdate.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            // Simulate Redis scan returning some cache keys
            mockRedisScan
                .mockResolvedValueOnce(['42', ['cache:ai_reply:abc123', 'cache:ai_reply:def456']])
                .mockResolvedValueOnce(['0', ['cache:ai_reply:ghi789']]);

            await invalidateCachesForStore('store-1');

            // Should have called scan with the right pattern
            expect(mockRedisScan).toHaveBeenCalledWith('0', 'MATCH', 'cache:ai_reply:*', 'COUNT', 200);
            // Should have deleted all found keys
            expect(mockRedisDel).toHaveBeenCalledWith('cache:ai_reply:abc123', 'cache:ai_reply:def456', 'cache:ai_reply:ghi789');
        });

        it('should delete semantic_cache rows for affected pages', async () => {
            mockLinkedPages(['page-1', 'page-2']);

            mockUpdate.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            await invalidateCachesForStore('store-1');

            // Should have called db.execute for each page (semantic_cache delete)
            expect(mockExecute).toHaveBeenCalledTimes(2);
        });

        it('should return the count of invalidated pages', async () => {
            mockLinkedPages(['page-1', 'page-2', 'page-3']);

            mockUpdate.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            const result = await invalidateCachesForStore('store-1');
            expect(result).toBe(3);
        });

        it('should not throw when Redis is unavailable', async () => {
            mockLinkedPages(['page-1']);

            mockUpdate.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            // Simulate Redis failure
            mockRedisScan.mockRejectedValueOnce(new Error('Connection refused'));

            // Should not throw — best-effort
            const result = await invalidateCachesForStore('store-1');
            expect(result).toBe(1);
        });

        it('should capture error and return 0 when DB query fails', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockRejectedValue(new Error('DB down')),
                }),
            });

            const result = await invalidateCachesForStore('store-1');

            expect(result).toBe(0);
            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                'E-commerce cache invalidation failed',
                expect.objectContaining({ tags: { service: 'shopify' } }),
            );
        });
    });
});
