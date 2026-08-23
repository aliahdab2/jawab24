import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// --- Hoisted mocks for use inside vi.mock() factories ---

const {
    mockGetStoreById,
    mockUpdateStoreTokens,
    mockReplaceProductsAndRebuildSummary,
    mockSaveStoreCategories,
    mockDecrypt,
    mockCaptureError,
    mockRedisSet,
    mockRedisDel,
} = vi.hoisted(() => ({
    mockGetStoreById: vi.fn(),
    mockUpdateStoreTokens: vi.fn(),
    mockReplaceProductsAndRebuildSummary: vi.fn(),
    mockSaveStoreCategories: vi.fn(),
    mockDecrypt: vi.fn(),
    mockCaptureError: vi.fn(),
    mockRedisSet: vi.fn(),
    mockRedisDel: vi.fn(),
}));

// --- vi.mock() calls ---

vi.mock('../../src/config', () => ({
    config: {
        salla: {
            clientId: 'test_salla_client_id',
            clientSecret: 'test_salla_secret',
            hostName: 'jawab24.com',
            webhookSecret: 'test_webhook_secret',
            scopes: 'offline_access products.read_write settings.read',
        },
    },
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([]),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    ecommerceStores: {
        id: 'id',
        platform: 'platform',
        isActive: 'isActive',
        tokenExpiresAt: 'tokenExpiresAt',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => ({ op: 'and', args })),
    lt: vi.fn((field, value) => ({ field, value, op: 'lt' })),
}));

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    updateStoreTokens: (...args: unknown[]) => mockUpdateStoreTokens(...args),
    markStoreNeedsReauth: vi.fn().mockResolvedValue(undefined),
    replaceProductsAndRebuildSummary: (...args: unknown[]) => mockReplaceProductsAndRebuildSummary(...args),
    applySyncedStoreInfo: vi.fn().mockResolvedValue(undefined),
    saveStoreCategories: (...args: unknown[]) => mockSaveStoreCategories(...args),
    PRODUCT_SAFETY_CAP: 5000,
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    decrypt: (...args: unknown[]) => mockDecrypt(...args),
    encryptOptional: vi.fn(() => ({})),
    decryptOptional: (...args: unknown[]) => (args[0] && args[1] ? mockDecrypt(...args) : undefined),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: (...args: unknown[]) => mockRedisSet(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
    },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// --- Import after mocks ---
import {
    buildAuthUrl,
    exchangeCodeForToken,
    refreshAccessToken,
    ensureValidToken,
    verifyWebhookHmac,
    fetchStoreInfo,
    syncProducts,
    registerWebhooks,
    getStoresNeedingTokenRefresh,
    refreshExpiringTokens,
    lookupOrder,
    getShipmentTracking,
    getProductById,
    composeSallaPhone,
} from '../../src/services/salla';

// --- Helpers ---

/** Create a mock store object with sensible defaults */
function makeStore(overrides: Record<string, unknown> = {}) {
    return {
        id: 'store-1',
        platform: 'salla',
        accessToken: 'enc_access_token',
        accessTokenIv: 'access_iv',
        refreshToken: 'enc_refresh_token',
        refreshTokenIv: 'refresh_iv',
        tokenExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        isActive: true,
        ...overrides,
    };
}

/** Create a mock Salla product */
function makeSallaProduct(overrides: Record<string, unknown> = {}) {
    return {
        id: 1001,
        name: 'Test Product',
        type: 'product',
        status: 'sale',
        price: { amount: 100, currency: 'SAR' },
        quantity: 50,
        options: [],
        categories: [{ name: 'Electronics' }],
        sku: 'SKU-001',
        ...overrides,
    };
}

/** Build a valid hex HMAC for the given body using the test webhook secret */
function buildValidHexHmac(body: string): string {
    return crypto
        .createHmac('sha256', 'test_webhook_secret')
        .update(body, 'utf8')
        .digest('hex');
}

describe('Salla Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mockDecrypt.mockReturnValue('decrypted_token');
        mockUpdateStoreTokens.mockResolvedValue(undefined);
        mockReplaceProductsAndRebuildSummary.mockResolvedValue({ productCount: 0 });
        mockRedisSet.mockResolvedValue('OK');
        mockRedisDel.mockResolvedValue(1);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ============================================================
    // OAuth
    // ============================================================

    describe('buildAuthUrl', () => {
        it('should build a valid OAuth URL with all required parameters', () => {
            const url = buildAuthUrl('state_abc123');

            expect(url).toContain('https://accounts.salla.sa/oauth2/auth');
            expect(url).toContain('client_id=test_salla_client_id');
            expect(url).toContain(`scope=${encodeURIComponent('offline_access products.read_write settings.read')}`);
            expect(url).toContain('response_type=code');
            expect(url).toContain('state=state_abc123');
            expect(url).toContain(encodeURIComponent('https://jawab24.com/salla/auth/callback'));
        });

        it('should encode the redirect URI', () => {
            const url = buildAuthUrl('test');

            expect(url).toContain('redirect_uri=');
            // The redirect_uri value should be URL-encoded (no raw "://" in the value portion)
            const redirectParam = url.split('redirect_uri=')[1].split('&')[0];
            expect(redirectParam).toBe(encodeURIComponent('https://jawab24.com/salla/auth/callback'));
        });

        it('should include the state parameter for CSRF protection', () => {
            const state = 'random_csrf_state_xyz';
            const url = buildAuthUrl(state);

            expect(url).toContain(`state=${state}`);
        });
    });

    describe('exchangeCodeForToken', () => {
        it('should exchange authorization code for tokens', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'salla_access_123',
                    refresh_token: 'salla_refresh_456',
                    expires_in: 1209600, // 14 days
                }),
            });

            const result = await exchangeCodeForToken('auth_code_abc');

            expect(result).toEqual({
                accessToken: 'salla_access_123',
                refreshToken: 'salla_refresh_456',
                expiresIn: 1209600,
            });

            expect(mockFetch).toHaveBeenCalledWith(
                'https://accounts.salla.sa/oauth2/token',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: expect.stringContaining('auth_code_abc'),
                }),
            );

            // Verify the body is form-urlencoded with all required fields (RFC 6749)
            const body = Object.fromEntries(
                new URLSearchParams(mockFetch.mock.calls[0][1].body),
            );
            expect(body).toEqual({
                grant_type: 'authorization_code',
                client_id: 'test_salla_client_id',
                client_secret: 'test_salla_secret',
                code: 'auth_code_abc',
                redirect_uri: 'https://jawab24.com/salla/auth/callback',
            });
        });

        it('should throw on failed token exchange', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => 'invalid_grant',
            });

            await expect(exchangeCodeForToken('bad_code')).rejects.toThrow(
                'Salla token exchange failed: 400 invalid_grant',
            );
        });

        it('should throw on server error during exchange', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            await expect(exchangeCodeForToken('code')).rejects.toThrow(
                'Salla token exchange failed: 500 Internal Server Error',
            );
        });
    });

    // ============================================================
    // Webhook HMAC Verification (hex-specific)
    // ============================================================

    describe('verifyWebhookHmac', () => {
        it('should return true for a valid hex HMAC', () => {
            const body = '{"event":"product.created","data":{"id":123}}';
            const signature = buildValidHexHmac(body);

            expect(verifyWebhookHmac(body, signature)).toBe(true);
        });

        it('should return false for an invalid HMAC', () => {
            const body = '{"event":"product.created","data":{"id":123}}';

            expect(verifyWebhookHmac(body, 'deadbeef1234567890')).toBe(false);
        });

        it('should return false for mismatched body content', () => {
            const body = '{"event":"product.created"}';
            const signature = buildValidHexHmac('{"event":"product.deleted"}');

            expect(verifyWebhookHmac(body, signature)).toBe(false);
        });

        it('should return false for different length buffers', () => {
            expect(verifyWebhookHmac('body', 'short')).toBe(false);
        });

        it('should use hex digest, not base64', () => {
            const body = '{"test": true}';
            const hexHmac = crypto
                .createHmac('sha256', 'test_webhook_secret')
                .update(body, 'utf8')
                .digest('hex');
            const base64Hmac = crypto
                .createHmac('sha256', 'test_webhook_secret')
                .update(body, 'utf8')
                .digest('base64');

            // hex should pass
            expect(verifyWebhookHmac(body, hexHmac)).toBe(true);
            // base64 should fail (different encoding, different length)
            expect(verifyWebhookHmac(body, base64Hmac)).toBe(false);
        });

        it('should handle empty body', () => {
            const body = '';
            const signature = buildValidHexHmac(body);

            expect(verifyWebhookHmac(body, signature)).toBe(true);
        });
    });

    // ============================================================
    // Token Refresh (CRITICAL)
    // ============================================================

    describe('refreshAccessToken', () => {
        it('should successfully refresh tokens and store new encrypted values', async () => {
            mockRedisSet.mockResolvedValueOnce('OK'); // Lock acquired
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // expires in 12h (< 24h)
            }));
            mockDecrypt.mockReturnValueOnce('decrypted_refresh_token');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'new_access_token',
                    refresh_token: 'new_refresh_token',
                    expires_in: 1209600,
                }),
            });

            await refreshAccessToken('store-1');

            // Should have called fetch to refresh
            expect(mockFetch).toHaveBeenCalledWith(
                'https://accounts.salla.sa/oauth2/token',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('refresh_token'),
                }),
            );

            const body = Object.fromEntries(
                new URLSearchParams(mockFetch.mock.calls[0][1].body),
            );
            expect(body.grant_type).toBe('refresh_token');
            expect(body.refresh_token).toBe('decrypted_refresh_token');
            expect(body.client_id).toBe('test_salla_client_id');
            expect(body.client_secret).toBe('test_salla_secret');

            // Should have stored new tokens
            expect(mockUpdateStoreTokens).toHaveBeenCalledWith('store-1', {
                accessToken: 'new_access_token',
                refreshToken: 'new_refresh_token',
                tokenExpiresAt: expect.any(Date),
            });

            // Should have released the lock
            expect(mockRedisDel).toHaveBeenCalledWith('salla:token_refresh:store-1');
        });

        it('should re-check expiry after acquiring lock and skip if already refreshed', async () => {
            mockRedisSet.mockResolvedValueOnce('OK'); // Lock acquired
            // Store token was already refreshed by another process (expires in 3 days)
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            }));

            await refreshAccessToken('store-1');

            // Should NOT have called fetch since token is still valid
            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockUpdateStoreTokens).not.toHaveBeenCalled();

            // Lock should still be released
            expect(mockRedisDel).toHaveBeenCalledWith('salla:token_refresh:store-1');
        });

        it('should wait and return when lock is not acquired', async () => {
            mockRedisSet.mockResolvedValueOnce(null); // Lock NOT acquired

            const start = Date.now();
            const promise = refreshAccessToken('store-1');

            // Advance timers to resolve the 2000ms wait
            await vi.advanceTimersByTimeAsync(2000);
            await promise;

            // Should NOT have called any store or fetch operations
            expect(mockGetStoreById).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
            // Should NOT release a lock it didn't acquire
            expect(mockRedisDel).not.toHaveBeenCalled();
        });

        it('should release lock and propagate error when refresh fails', async () => {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
            }));
            mockDecrypt.mockReturnValueOnce('decrypted_refresh_token');

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => 'invalid_token',
            });

            await expect(refreshAccessToken('store-1')).rejects.toThrow(
                'Salla token refresh failed: 401 invalid_token',
            );

            // Lock MUST be released even on error
            expect(mockRedisDel).toHaveBeenCalledWith('salla:token_refresh:store-1');
        });

        it('should throw when store has no refresh token', async () => {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
                refreshToken: null,
                refreshTokenIv: null,
            }));

            await expect(refreshAccessToken('store-1')).rejects.toThrow(
                'No refresh token for Salla store store-1',
            );

            // Lock must be released
            expect(mockRedisDel).toHaveBeenCalledWith('salla:token_refresh:store-1');
        });

        it('should throw when store is not found', async () => {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(null);

            await expect(refreshAccessToken('store-1')).rejects.toThrow('Store not found');

            // Lock must be released
            expect(mockRedisDel).toHaveBeenCalledWith('salla:token_refresh:store-1');
        });

        it('should acquire Redis lock with NX and 30s TTL', async () => {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // fresh
            }));

            await refreshAccessToken('store-1');

            expect(mockRedisSet).toHaveBeenCalledWith(
                'salla:token_refresh:store-1',
                '1',
                'EX',
                30,
                'NX',
            );
        });
    });

    describe('ensureValidToken', () => {
        it('should skip refresh when token is fresh (> 24h until expiry)', async () => {
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
            }));

            await ensureValidToken('store-1');

            // Should NOT attempt to refresh
            expect(mockRedisSet).not.toHaveBeenCalled();
        });

        it('should skip refresh when tokenExpiresAt is null', async () => {
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: null,
            }));

            await ensureValidToken('store-1');

            expect(mockRedisSet).not.toHaveBeenCalled();
        });

        it('should trigger refresh when token expires within 24h', async () => {
            // First call to ensureValidToken -> getStoreById
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6h from now
            }));
            // Second call inside refreshAccessToken -> getStoreById
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            }));
            mockRedisSet.mockResolvedValueOnce('OK');
            mockDecrypt.mockReturnValueOnce('decrypted_refresh');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'new_at',
                    refresh_token: 'new_rt',
                    expires_in: 1209600,
                }),
            });

            await ensureValidToken('store-1');

            // Should have called refresh (which calls fetch)
            expect(mockFetch).toHaveBeenCalled();
            expect(mockUpdateStoreTokens).toHaveBeenCalled();
        });

        it('should throw when store is not found', async () => {
            mockGetStoreById.mockResolvedValueOnce(null);

            await expect(ensureValidToken('store-1')).rejects.toThrow('Store not found');
        });
    });

    // ============================================================
    // Products (page-based pagination)
    // ============================================================

    describe('syncProducts', () => {
        /** Helper to set up fetch mocks for product pages */
        function setupProductFetch(pages: Array<{ data: unknown[]; currentPage: number; totalPages: number }>) {
            for (const page of pages) {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        data: page.data,
                        pagination: {
                            currentPage: page.currentPage,
                            totalPages: page.totalPages,
                            perPage: 65,
                            total: page.data.length * page.totalPages,
                        },
                    }),
                });
            }
        }

        beforeEach(() => {
            // ensureValidToken will call getStoreById — token is fresh so no refresh needed
            mockGetStoreById.mockResolvedValue(makeStore({
                tokenExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
            }));
            mockDecrypt.mockReturnValue('decrypted_access_token');
        });

        it('should sync a single page of products', async () => {
            const product = makeSallaProduct({ id: 1, name: 'Widget', status: 'sale' });
            setupProductFetch([
                { data: [product], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            expect(mockReplaceProductsAndRebuildSummary).toHaveBeenCalledWith(
                'store-1',
                expect.arrayContaining([
                    expect.objectContaining({
                        platformProductId: '1',
                        title: 'Widget',
                        status: 'active', // mapped from 'sale'
                    }),
                ]),
            );
        });

        it('should handle multi-page pagination', async () => {
            const page1Products = [
                makeSallaProduct({ id: 1, name: 'Product A', status: 'sale' }),
                makeSallaProduct({ id: 2, name: 'Product B', status: 'sale' }),
            ];
            const page2Products = [
                makeSallaProduct({ id: 3, name: 'Product C', status: 'out' }),
            ];

            setupProductFetch([
                { data: page1Products, currentPage: 1, totalPages: 2 },
                { data: page2Products, currentPage: 2, totalPages: 2 },
            ]);

            await syncProducts('store-1');

            const mappedProducts = mockReplaceProductsAndRebuildSummary.mock.calls[0][1];
            expect(mappedProducts).toHaveLength(3);
            expect(mappedProducts[0].title).toBe('Product A');
            expect(mappedProducts[1].title).toBe('Product B');
            expect(mappedProducts[2].title).toBe('Product C');
        });

        it('should handle empty product response', async () => {
            setupProductFetch([
                { data: [], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            expect(mockReplaceProductsAndRebuildSummary).toHaveBeenCalledWith('store-1', []);
        });

        it('should map Salla status "sale" to "active"', async () => {
            setupProductFetch([
                { data: [makeSallaProduct({ status: 'sale' })], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1];
            expect(mapped[0].status).toBe('active');
        });

        it('should map Salla status "out" to "out_of_stock"', async () => {
            setupProductFetch([
                { data: [makeSallaProduct({ status: 'out' })], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1];
            expect(mapped[0].status).toBe('out_of_stock');
        });

        it('should map Salla status "hidden" to "hidden"', async () => {
            setupProductFetch([
                { data: [makeSallaProduct({ status: 'hidden' })], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1];
            expect(mapped[0].status).toBe('hidden');
        });

        it('should filter out deleted products', async () => {
            setupProductFetch([
                {
                    data: [
                        makeSallaProduct({ id: 1, status: 'sale' }),
                        makeSallaProduct({ id: 2, status: 'deleted' }),
                        makeSallaProduct({ id: 3, status: 'out' }),
                    ],
                    currentPage: 1,
                    totalPages: 1,
                },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1];
            expect(mapped).toHaveLength(2);
            expect(mapped.map((p: { platformProductId: string }) => p.platformProductId)).toEqual(['1', '3']);
        });

        it('should correctly map product fields', async () => {
            const product = makeSallaProduct({
                id: 42,
                name: 'Premium Widget',
                status: 'sale',
                price: { amount: 299.99, currency: 'SAR' },
                quantity: 25,
                categories: [{ name: 'Gadgets', urls: { customer: 'https://mystore.salla.sa/gadgets/c77' } }],
                urls: { customer: 'https://mystore.salla.sa/premium-widget/p42' },
                options: [
                    {
                        name: 'Size',
                        values: [{ name: 'Small' }, { name: 'Large' }],
                    },
                ],
            });

            setupProductFetch([
                { data: [product], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1][0];
            expect(mapped).toEqual(expect.objectContaining({
                platformProductId: '42',
                title: 'Premium Widget',
                status: 'active',
                priceRange: '299.99 SAR',
                currency: 'SAR',
                totalInventory: 25,
                productType: 'Gadgets',
                vendor: null,
                hasVariants: true,
                variantSummary: 'Size: Small, Large',
                tags: null,
                // Salla has no slug: the link is the platform's own customer URL.
                handle: null,
                productUrl: 'https://mystore.salla.sa/premium-widget/p42',
            }));
        });

        it('persists the category links the products carry (distinct, before the summary rebuild)', async () => {
            const gadgets = { name: 'Gadgets', urls: { customer: 'https://mystore.salla.sa/gadgets/c77' } };
            const audio = { name: 'Audio', urls: { customer: 'https://mystore.salla.sa/audio/c78' } };
            setupProductFetch([{
                data: [
                    makeSallaProduct({ id: 1, categories: [gadgets] }),
                    makeSallaProduct({ id: 2, categories: [gadgets, audio] }),
                    makeSallaProduct({ id: 3, categories: [{ name: 'No link' }] }),
                    makeSallaProduct({ id: 4, status: 'deleted', categories: [{ name: 'Gone', urls: { customer: 'https://x/c1' } }] }),
                ],
                currentPage: 1, totalPages: 1,
            }]);

            await syncProducts('store-1');

            expect(mockSaveStoreCategories).toHaveBeenCalledTimes(1);
            const [storeId, categories] = mockSaveStoreCategories.mock.calls[0];
            expect(storeId).toBe('store-1');
            // Raw gather: duplicates and link-less entries are the saver's job to drop;
            // a DELETED product contributes nothing.
            expect(categories).toEqual([
                { name: 'Gadgets', url: 'https://mystore.salla.sa/gadgets/c77' },
                { name: 'Gadgets', url: 'https://mystore.salla.sa/gadgets/c77' },
                { name: 'Audio', url: 'https://mystore.salla.sa/audio/c78' },
            ]);
            expect(mockSaveStoreCategories.mock.invocationCallOrder[0])
                .toBeLessThan(mockReplaceProductsAndRebuildSummary.mock.invocationCallOrder[0]);
        });

        it('a product without urls.customer is stored without a link — never an invented one', async () => {
            setupProductFetch([{ data: [makeSallaProduct({ id: 5 })], currentPage: 1, totalPages: 1 }]);
            await syncProducts('store-1');
            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1][0];
            expect(mapped.handle).toBeNull();
            expect(mapped.productUrl).toBeNull();
        });

        it('should handle products with no categories', async () => {
            const product = makeSallaProduct({
                categories: [],
            });

            setupProductFetch([
                { data: [product], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1][0];
            expect(mapped.productType).toBeNull();
        });

        it('should handle products with null quantity', async () => {
            const product = makeSallaProduct({
                quantity: null,
            });

            setupProductFetch([
                { data: [product], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1][0];
            expect(mapped.totalInventory).toBe(0);
        });

        it('should handle products with multiple option groups', async () => {
            const product = makeSallaProduct({
                options: [
                    { name: 'Color', values: [{ name: 'Red' }, { name: 'Blue' }] },
                    { name: 'Size', values: [{ name: 'S' }, { name: 'M' }, { name: 'L' }] },
                ],
            });

            setupProductFetch([
                { data: [product], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1][0];
            expect(mapped.hasVariants).toBe(true);
            expect(mapped.variantSummary).toBe('Color: Red, Blue | Size: S, M, L');
        });

        it('should set hasVariants=false and variantSummary=null for products with no options', async () => {
            const product = makeSallaProduct({
                options: [],
            });

            setupProductFetch([
                { data: [product], currentPage: 1, totalPages: 1 },
            ]);

            await syncProducts('store-1');

            const mapped = mockReplaceProductsAndRebuildSummary.mock.calls[0][1][0];
            expect(mapped.hasVariants).toBe(false);
            expect(mapped.variantSummary).toBeNull();
        });
    });

    // ============================================================
    // Store Info
    // ============================================================

    describe('fetchStoreInfo', () => {
        it('should parse store info from API response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: {
                        name: 'My Salla Store',
                        email: 'merchant@example.com',
                        currency: 'SAR',
                        domain: 'mystore.salla.sa',
                        id: 98765,
                    },
                }),
            });

            const result = await fetchStoreInfo('access_token_123');

            expect(result).toEqual({
                storeName: 'My Salla Store',
                storeEmail: 'merchant@example.com',
                storeCurrency: 'SAR',
                storeDomain: 'mystore.salla.sa',
                merchantId: '98765',
                storeType: null,
            });
        });

        it('should surface the store environment type (demo | development | live) for the claim gate', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: { name: 'متجر تجريبي', email: 'jkgsyu3w6pzzfrzw@email.partners', currency: 'SAR', domain: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw', id: 2108580704, type: 'demo' },
                }),
            });

            const result = await fetchStoreInfo('token');
            expect(result.storeType).toBe('demo');
            // Salla hands the domain over as a full URL, with a path for demo stores.
            // The column is an identity key: scheme stripped, path kept, never
            // `https://https://` downstream (the 2026-08-23 catalog-block defect).
            expect(result.storeDomain).toBe('demostore.salla.sa/dev-jkgsyu3w6pzzfrzw');
        });

        it('should convert numeric merchant id to string', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: { name: 'Store', email: 'a@b.com', currency: 'SAR', domain: 'x.salla.sa', id: 12345 },
                }),
            });

            const result = await fetchStoreInfo('token');
            expect(typeof result.merchantId).toBe('string');
            expect(result.merchantId).toBe('12345');
        });

        it('should pass the access token as Bearer authorization', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: { name: 'S', email: 'e', currency: 'C', domain: 'd', id: 1 },
                }),
            });

            await fetchStoreInfo('my_bearer_token');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.salla.dev/admin/v2/store/info',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer my_bearer_token',
                    }),
                }),
            );
        });
    });

    // ============================================================
    // Webhook Registration
    // ============================================================

    describe('registerWebhooks', () => {
        const WEBHOOK_URL = 'https://jawab24.com/salla/webhooks';
        const LIST_URL = 'https://api.salla.dev/admin/v2/webhooks';
        const SUBSCRIBE_URL = 'https://api.salla.dev/admin/v2/webhooks/subscribe';

        /** Route fetch by call: the listing GET answers with `existing`, every write with `write`. */
        const routeFetch = (
            existing: Array<{ id: number; event: string; url: string }>,
            write: { ok: boolean; status?: number; text?: () => Promise<string> } = { ok: true },
        ) => {
            mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
                if (url === LIST_URL && (!init?.method || init.method === 'GET')) {
                    return { ok: true, status: 200, json: async () => ({ data: existing }) };
                }
                return write;
            });
        };
        const writeCalls = () => mockFetch.mock.calls.filter(
            (call: [string, { method?: string }]) => call[1]?.method === 'POST' || call[1]?.method === 'PUT',
        ) as Array<[string, { method: string; body: string }]>;

        it('should register all 11 webhook events after listing what Salla already holds', async () => {
            routeFetch([]);

            await registerWebhooks('access_token');

            // 1 listing GET + 11 subscribes
            expect(mockFetch).toHaveBeenCalledTimes(12);
            expect(mockFetch.mock.calls[0][0]).toBe(LIST_URL);

            const events = writeCalls().map(call => JSON.parse(call[1].body).event);
            expect(events).toEqual([
                'product.created',
                'product.deleted',
                'product.price.updated',
                'product.status.updated',
                'product.quantity.low',
                'app.uninstalled',
                'order.created',
                'order.updated',
                'order.status.updated',
                'order.shipment.created',
                'abandoned.cart',
            ]);
        });

        // The defect this pins (2026-08-23): subscriptions registered without these
        // fields delivered with NO X-Salla-Signature, and the HMAC check refused every
        // order and product event with 401 — none had ever been accepted.
        it('every subscription carries the signature strategy, the configured secret and payload version 2', async () => {
            routeFetch([]);

            await registerWebhooks('token');

            for (const [url, init] of writeCalls()) {
                expect(url).toBe(SUBSCRIBE_URL);
                const body = JSON.parse(init.body);
                expect(body.security_strategy).toBe('signature');
                expect(body.secret).toBe('test_webhook_secret');
                expect(body.version).toBe(2);
            }
        });

        it('UPDATES an existing subscription for our URL in place instead of re-subscribing (a re-subscribe 422s and leaves it unsigned)', async () => {
            routeFetch([
                { id: 1069900204, event: 'order.created', url: WEBHOOK_URL },
                { id: 445433511, event: 'order.status.updated', url: WEBHOOK_URL },
                // Someone else's subscription for the same event — not ours, must not be touched.
                { id: 999, event: 'product.created', url: 'https://other.example/hook' },
            ]);

            const result = await registerWebhooks('token');

            const writes = writeCalls();
            const puts = writes.filter(c => c[1].method === 'PUT');
            expect(puts.map(c => c[0]).sort()).toEqual([
                'https://api.salla.dev/admin/v2/webhooks/1069900204',
                'https://api.salla.dev/admin/v2/webhooks/445433511',
            ].sort());
            // The live API rejects an update without `event` (422 «حقل event غير صالح»,
            // measured 2026-08-23) even though the docs omit it — so every PUT must
            // name the event of the row it repairs, or the row stays unsigned.
            const expectedEventById: Record<string, string> = { '1069900204': 'order.created', '445433511': 'order.status.updated' };
            for (const [url, init] of puts) {
                const body = JSON.parse(init.body);
                const id = url.split('/').pop() as string;
                expect(body).toMatchObject({ event: expectedEventById[id], url: WEBHOOK_URL, security_strategy: 'signature', secret: 'test_webhook_secret', version: 2 });
            }
            // The other 9 events are subscribed fresh — including product.created, whose
            // only existing subscription belongs to a different URL.
            expect(writes.filter(c => c[1].method === 'POST')).toHaveLength(9);
            expect(result.registered).toHaveLength(11);
            expect(result.failed).toEqual([]);
        });

        it('should not report error on 422 (webhook already exists) when the listing could not see it', async () => {
            routeFetch([], { ok: false, status: 422, text: async () => 'already exists' });

            const result = await registerWebhooks('token');

            expect(mockCaptureError).not.toHaveBeenCalled();
            expect(result.registered).toHaveLength(11);
        });

        it('a 422 on an UPDATE is a real failure, not "already exists"', async () => {
            routeFetch(
                [{ id: 1069900204, event: 'order.created', url: WEBHOOK_URL }],
                { ok: false, status: 422, text: async () => 'invalid' },
            );

            const result = await registerWebhooks('token');

            expect(result.failed).toEqual(expect.arrayContaining([expect.objectContaining({ topic: 'order.created', status: 422 })]));
        });

        it('falls back to blind subscribes (still signed) when the listing fails, and reports the listing once', async () => {
            mockFetch.mockImplementation(async (url: string) => {
                if (url === LIST_URL) return { ok: false, status: 403 };
                return { ok: true };
            });

            const result = await registerWebhooks('token');

            expect(writeCalls().every(([url, init]) => url === SUBSCRIBE_URL && JSON.parse(init.body).security_strategy === 'signature')).toBe(true);
            expect(result.registered).toHaveLength(11);
            expect(mockCaptureError).toHaveBeenCalledTimes(1);
        });

        it('should capture error on non-422 failure but not throw', async () => {
            routeFetch([], { ok: false, status: 500, text: async () => 'server error' });

            // Should not throw
            await registerWebhooks('token');

            expect(mockCaptureError).toHaveBeenCalled();
        });

        it('should capture error when fetch throws but not propagate', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));

            await registerWebhooks('token');

            expect(mockCaptureError).toHaveBeenCalled();
        });

        it('should register all events to a single webhook URL', async () => {
            routeFetch([]);

            await registerWebhooks('token');

            const urls = writeCalls().map(call => JSON.parse(call[1].body).url);

            // All events point to the same single endpoint
            expect(urls.every((u: string) => u === WEBHOOK_URL)).toBe(true);
        });
    });

    // ============================================================
    // Periodic Token Refresh
    // ============================================================

    describe('refreshExpiringTokens', () => {
        it('should refresh tokens for all stores needing refresh', async () => {
            // Mock getStoresNeedingTokenRefresh via db.select
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { id: 'store-1' },
                        { id: 'store-2' },
                    ]),
                }),
            });

            // For each store's refreshAccessToken call:
            // store-1
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                id: 'store-1',
                tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            }));
            mockDecrypt.mockReturnValueOnce('refresh_1');
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'new_at_1',
                    refresh_token: 'new_rt_1',
                    expires_in: 1209600,
                }),
            });

            // store-2
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                id: 'store-2',
                tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            }));
            mockDecrypt.mockReturnValueOnce('refresh_2');
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'new_at_2',
                    refresh_token: 'new_rt_2',
                    expires_in: 1209600,
                }),
            });

            const count = await refreshExpiringTokens();
            expect(count).toBe(2);
        });

        it('should capture error for failed refresh and continue with others', async () => {
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([
                        { id: 'store-fail' },
                        { id: 'store-ok' },
                    ]),
                }),
            });

            // store-fail: lock acquired but store not found
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(null);

            // store-ok: succeeds
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValueOnce(makeStore({
                id: 'store-ok',
                tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            }));
            mockDecrypt.mockReturnValueOnce('refresh_ok');
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'new_at',
                    refresh_token: 'new_rt',
                    expires_in: 1209600,
                }),
            });

            const count = await refreshExpiringTokens();

            // Only one succeeded
            expect(count).toBe(1);
            // Error was captured for the failed one
            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                expect.stringContaining('store-fail'),
                expect.objectContaining({ tags: { service: 'salla' } }),
            );
        });

        it('should return 0 when no stores need refresh', async () => {
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            const count = await refreshExpiringTokens();
            expect(count).toBe(0);
        });
    });

    // ============================================================
    // lookupOrder / getShipmentTracking / getProductById
    // ============================================================

    describe('lookupOrder', () => {
        beforeEach(() => {
            // Token is far in the future — ensureValidToken short-circuits
            mockGetStoreById.mockResolvedValue(makeStore({
                tokenExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            }));
        });

        it('returns mapped order info when order is found', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{
                        id: 5001,
                        reference_id: '12345',
                        status: { slug: 'completed', name: 'Completed' },
                        payment_method: 'card',
                        amounts: { total: { amount: 250, currency: 'SAR' }, cash_on_delivery: { amount: 0 } },
                        customer: { first_name: 'Ahmed', mobile: '+966512345678' },
                        shipping: { address: { city: 'Riyadh', district: 'Olaya' } },
                        items: [{ name: 'Widget', quantity: 2, amounts: { price_without_tax: { amount: 100 }, total: { amount: 200, currency: 'SAR' } } }],
                        date: { date: '2026-01-15 10:00:00' },
                    }],
                }),
            });

            const result = await lookupOrder('store-1', '12345');

            expect(result).not.toBeNull();
            expect(result?.orderNumber).toBe('12345');
            expect(result?.customerFirstName).toBe('Ahmed');
            expect(result?.status).toBe('delivered'); // 'completed' maps to 'delivered'
            expect(result?.totalAmount).toBe('250');
            expect(result?.currency).toBe('SAR');
            expect(result?.shippingCity).toBe('Riyadh');
        });

        it('returns null when order is not found', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ data: [] }),
            });

            const result = await lookupOrder('store-1', '99999');

            expect(result).toBeNull();
        });

        // Regression: the orders LIST endpoint (what lookupOrder hits) returns a
        // LIGHTER shape than the DETAIL endpoint — verified against a live store
        // 2026-06-27. It has a top-level `total` (NOT `amounts`), items WITHOUT
        // per-item amounts, and a bare-number `mobile` + separate `mobile_code`.
        // The old mapper read `order.amounts.total.amount` + `item.amounts.total`
        // + raw `order.customer.mobile`, so every real lookup threw
        // "Cannot read properties of undefined (reading 'total')".
        it('maps the real LIST-endpoint shape without throwing (top-level total, split phone, item w/o amounts)', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{
                        id: 1686116368,
                        reference_id: 263215797, // live list endpoint returns this as a NUMBER
                        status: { slug: 'under_review', name: 'بإنتظار المراجعة' },
                        total: { amount: 174, currency: 'SAR' },          // top-level, NOT amounts
                        customer: { first_name: 'Test', mobile: 555123456, mobile_code: '+966' },
                        items: [{ name: 'فستان', quantity: 1 }],            // no per-item amounts
                        date: { date: '2026-05-30 17:05:33.000000' },
                        // no `amounts`, no `shipping` — exactly as the list endpoint returns
                    }],
                }),
            });

            const result = await lookupOrder('store-1', '263215797');

            expect(result).not.toBeNull();
            expect(result?.orderNumber).toBe('263215797');
            expect(result?.totalAmount).toBe('174');
            expect(result?.currency).toBe('SAR');
            // mobile (555123456) + mobile_code (+966) composed into full international
            expect(result?.customerPhone).toBe('+966555123456');
            expect(result?.status).toBe('pending'); // under_review → pending
            expect(result?.items).toEqual([{ name: 'فستان', quantity: 1, price: '' }]);
        });
    });

    describe('getShipmentTracking', () => {
        beforeEach(() => {
            mockGetStoreById.mockResolvedValue(makeStore({
                tokenExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            }));
        });

        /**
         * Route each mocked fetch by URL rather than by call order — the order detail and the
         * shipments lookup are issued concurrently, so sequential `mockResolvedValueOnce`
         * would pin an ordering the implementation is free to change.
         *
         * ⚠️ Order payloads here deliberately carry NO `shipments` key. Salla serves order
         * detail in "light" format to every app created after 15 Aug 2024 (ours dates from
         * 2026-02-25), and light omits shipments entirely. Fixtures that inline a `shipments`
         * array describe a response we can never receive — that is exactly how this bug
         * survived review, so do not reintroduce one.
         */
        function mockSallaRoutes(opts: {
            order: Record<string, unknown>;
            shipments?: unknown[];
            shipmentsStatus?: number;
        }) {
            mockFetch.mockImplementation(async (url: string) => {
                if (url.includes('/shipments')) {
                    if (opts.shipmentsStatus && opts.shipmentsStatus >= 400) {
                        return { ok: false, status: opts.shipmentsStatus, json: async () => ({}) };
                    }
                    return { ok: true, json: async () => ({ data: opts.shipments ?? [] }) };
                }
                if (/\/orders\/\d+$/.test(url)) {
                    return { ok: true, json: async () => ({ data: opts.order }) };
                }
                return { ok: true, json: async () => ({ data: [opts.order] }) };
            });
        }

        const shippedOrder = {
            id: 5001,
            reference_id: '12345',
            status: { slug: 'shipped', name: 'Shipped' },
            payment_method: 'card',
            amounts: { total: { amount: 250, currency: 'SAR' }, cash_on_delivery: { amount: 0 } },
            customer: { first_name: 'Ahmed', mobile: '+966512345678' },
            shipping: { address: { city: 'Jeddah', district: 'Al Hamra' } },
            items: [],
            date: { date: '2026-01-15 10:00:00' },
        };

        // Regression (2026-08-17): tracking used to be read off `order.shipments[0]` on the
        // order-detail payload. The light response never carries that field, so every Salla
        // customer asking "where is my order" got a blank tracking number. Tracking must come
        // from the separate List Shipments endpoint.
        it('reads tracking from the List Shipments endpoint, not the order payload', async () => {
            mockSallaRoutes({
                order: shippedOrder,
                shipments: [{
                    tracking_number: 'TRK-ARX-001',
                    courier_name: 'Aramex',
                    tracking_link: 'https://www.aramex.com/track/TRK-ARX-001',
                }],
            });

            const result = await getShipmentTracking('store-1', '12345');

            expect(result).not.toBeNull();
            expect(result?.orderNumber).toBe('12345');
            expect(result?.trackingNumber).toBe('TRK-ARX-001');
            expect(result?.courierName).toBe('Aramex');
            expect(result?.trackingUrl).toBe('https://www.aramex.com/track/TRK-ARX-001');
            expect(result?.status).toBe('shipped');
            expect(result?.shippingCity).toBe('Jeddah');

            // Scoped to the order — an unfiltered /shipments call would return the whole
            // store's shipments and hand the customer somebody else's tracking number.
            const shipmentCall = mockFetch.mock.calls.find((c: unknown[]) => String(c[0]).includes('/shipments'));
            expect(shipmentCall?.[0]).toBe('https://api.salla.dev/admin/v2/shipments?order_id=5001');
        });

        // A store that authorised before `shipping.read` was added to the app answers 403.
        // Losing tracking is acceptable; losing the whole answer is not.
        it('degrades to status-only when the shipments lookup is forbidden', async () => {
            mockSallaRoutes({ order: shippedOrder, shipmentsStatus: 403 });

            const result = await getShipmentTracking('store-1', '12345');

            expect(result).not.toBeNull();
            expect(result?.status).toBe('shipped');
            expect(result?.customerPhone).toBe('+966512345678');
            expect(result?.trackingNumber).toBeUndefined();
            expect(result?.courierName).toBeUndefined();
            expect(mockCaptureError).toHaveBeenCalled();
        });

        it('returns no tracking when the order has no shipment yet', async () => {
            mockSallaRoutes({ order: shippedOrder, shipments: [] });

            const result = await getShipmentTracking('store-1', '12345');

            expect(result).not.toBeNull();
            expect(result?.trackingNumber).toBeUndefined();
        });

        // Multi-package orders (and a cancelled shipment followed by its replacement) return
        // several shipments with no documented ordering. Taking [0] blindly would answer
        // "no tracking" while the number the customer asked for sits in the next element.
        it('prefers the shipment that actually carries a tracking number', async () => {
            mockSallaRoutes({
                order: shippedOrder,
                shipments: [
                    { tracking_number: null, courier_name: null, tracking_link: null },
                    { tracking_number: 'TRK-REAL-9', courier_name: 'SMSA', tracking_link: 'https://smsa/9' },
                ],
            });

            const result = await getShipmentTracking('store-1', '12345');

            expect(result?.trackingNumber).toBe('TRK-REAL-9');
            expect(result?.courierName).toBe('SMSA');
        });

        // The List Shipments schema names the tracking URL both ways; accepting only one
        // would drop the link for stores whose courier populates the other.
        it('accepts tracking_url when the shipment has no tracking_link', async () => {
            mockSallaRoutes({
                order: shippedOrder,
                shipments: [{ tracking_number: 'TRK-3', courier_name: 'Aramex', tracking_url: 'https://aramex/3' }],
            });

            const result = await getShipmentTracking('store-1', '12345');

            expect(result?.trackingUrl).toBe('https://aramex/3');
        });

        // Regression: customerPhone is used for Phase-2 identity verification
        // (phonesMatch). A bare local number would never match the customer's real
        // international number — compose mobile + mobile_code.
        it('composes the split mobile + mobile_code into the verification phone', async () => {
            mockSallaRoutes({
                order: {
                    id: 5002,
                    reference_id: '67890',
                    status: { slug: 'shipped', name: 'Shipped' },
                    customer: { first_name: 'Sara', mobile: 501112222, mobile_code: '+966' },
                    date: { date: '2026-02-01 09:00:00' },
                },
                shipments: [{ tracking_number: 'TRK-2', courier_name: 'SMSA', tracking_link: null }],
            });

            const result = await getShipmentTracking('store-1', '67890');

            expect(result?.customerPhone).toBe('+966501112222');
        });
    });

    describe('composeSallaPhone', () => {
        it('prepends mobile_code to a bare local number', () => {
            expect(composeSallaPhone(555123456, '+966')).toBe('+966555123456');
            expect(composeSallaPhone('555123456', '+971')).toBe('+971555123456');
        });
        it('returns an already-international number unchanged', () => {
            expect(composeSallaPhone('+966555123456', '+966')).toBe('+966555123456');
        });
        it('returns the bare number when no code is present', () => {
            expect(composeSallaPhone(555123456)).toBe('555123456');
        });
        it('returns undefined for empty/missing mobile', () => {
            expect(composeSallaPhone(undefined, '+966')).toBeUndefined();
            expect(composeSallaPhone(null, '+966')).toBeUndefined();
            expect(composeSallaPhone('', '+966')).toBeUndefined();
        });
    });

    describe('getProductById (D-092)', () => {
        beforeEach(() => {
            mockGetStoreById.mockResolvedValue(makeStore({
                tokenExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                storeDomain: 'mystore.salla.sa',
            }));
        });

        it('GETs /admin/v2/products/{id} and maps through the SAME mapper the sync uses', async () => {
            const product = makeSallaProduct({
                id: 1001, name: 'Phone Case', quantity: 15, status: 'sale', thumbnail: 'https://cdn/case.jpg',
                // Salla's real link field. There is NO slug — the `/p/{slug}` URL this
                // test used to assert was an invented shape (2026-08-23).
                urls: { customer: 'https://mystore.salla.sa/phone-case/p1001', admin: 'https://s.salla.sa/products/1001' },
                options: [{ name: 'Color', values: [{ name: 'Black' }, { name: 'Blue' }] }],
            });
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: product }) });

            const result = await getProductById('store-1', '1001');

            expect((mockFetch.mock.calls[0] as [string])[0]).toBe('https://api.salla.dev/admin/v2/products/1001');
            expect(result).toMatchObject({
                platformProductId: '1001',
                title: 'Phone Case',
                status: 'active',
                priceRange: '100 SAR',
                totalInventory: 15,
                handle: null,
                imageUrl: 'https://cdn/case.jpg',
                productUrl: 'https://mystore.salla.sa/phone-case/p1001',
                // Salla reports stock per product; the per-option figure is the product's, labelled as such.
                variants: [
                    { name: 'Color: Black', available: true, quantity: 15 },
                    { name: 'Color: Blue', available: true, quantity: 15 },
                ],
            });
        });

        it('maps a sold-out product to status out_of_stock (never hides it)', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: makeSallaProduct({ id: 1002, status: 'out', quantity: 0 }) }) });
            const result = await getProductById('store-1', '1002');
            expect(result?.status).toBe('out_of_stock');
        });

        it('returns null on 404, on a deleted product, and when the envelope carries a DIFFERENT id', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers(), text: async () => 'nope' });
            expect(await getProductById('store-1', '9999')).toBeNull();

            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: makeSallaProduct({ id: 1003, status: 'deleted' }) }) });
            expect(await getProductById('store-1', '1003')).toBeNull();

            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: makeSallaProduct({ id: 5555 }) }) });
            expect(await getProductById('store-1', '1004')).toBeNull();
        });
    });

    });
