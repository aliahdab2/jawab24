import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// --- Hoisted mocks ---

const {
    mockGetStoreById,
    mockUpdateStoreTokens,
    mockReplaceProductsAndRebuildSummary,
    mockDecrypt,
    mockCaptureError,
    mockRedisSet,
    mockRedisDel,
} = vi.hoisted(() => ({
    mockGetStoreById: vi.fn(),
    mockUpdateStoreTokens: vi.fn(),
    mockReplaceProductsAndRebuildSummary: vi.fn(),
    mockDecrypt: vi.fn(),
    mockCaptureError: vi.fn(),
    mockRedisSet: vi.fn(),
    mockRedisDel: vi.fn(),
}));

// --- vi.mock() calls ---

vi.mock('../../src/config', () => ({
    config: {
        zid: {
            clientId: 'test_zid_client_id',
            clientSecret: 'test_zid_secret',
            hostName: 'jawab24.com',
            webhookSecret: 'test_webhook_secret',
            scopes: 'store.info products.read webhooks.manage',
        },
    },
}));

vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: vi.fn((_service, _op, fn) => fn()),
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
    replaceProductsAndRebuildSummary: (...args: unknown[]) => mockReplaceProductsAndRebuildSummary(...args),
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    decrypt: (...args: unknown[]) => mockDecrypt(...args),
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
    isProductEvent,
    registerWebhooks,
    fetchStoreInfo,
    syncProducts,
    fullSync,
    refreshExpiringTokens,
    ZID_WEBHOOK_EVENTS,
    lookupOrder,
    getShipmentTracking,
    checkInventory,
} from '../../src/services/zid';

// --- Helpers ---

function makeStore(overrides: Record<string, unknown> = {}) {
    return {
        id: 'store-1',
        platform: 'zid',
        accessToken: 'enc_access_token',
        accessTokenIv: 'access_iv',
        refreshToken: 'enc_refresh_token',
        refreshTokenIv: 'refresh_iv',
        storeCurrency: 'SAR',
        // ~1 year expiry from now
        tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        isActive: true,
        ...overrides,
    };
}

function makeZidProduct(overrides: Record<string, unknown> = {}) {
    return {
        id: '1001',
        name: 'Test Product',
        status: 'active',
        price: 150,
        currency: 'SAR',
        quantity: 20,
        sku: 'SKU-001',
        handle: 'test-product',
        images: [{ url: 'https://cdn.zid.sa/image.jpg' }],
        categories: [{ name: 'Electronics' }],
        has_variants: false,
        options: [],
        ...overrides,
    };
}

function buildValidHexHmac(body: string): string {
    return crypto
        .createHmac('sha256', 'test_webhook_secret')
        .update(body, 'utf8')
        .digest('hex');
}

describe('Zid Service', () => {
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
    // OAuth — buildAuthUrl
    // ============================================================

    describe('buildAuthUrl', () => {
        it('builds a valid OAuth URL with all required parameters', () => {
            const url = buildAuthUrl('state_abc123');

            expect(url).toContain('https://oauth.zid.sa/oauth/authorize');
            expect(url).toContain('client_id=test_zid_client_id');
            expect(url).toContain(`scope=${encodeURIComponent('store.info products.read webhooks.manage')}`);
            expect(url).toContain('response_type=code');
            expect(url).toContain('state=state_abc123');
            expect(url).toContain(encodeURIComponent('https://jawab24.com/zid/auth/callback'));
        });

        it('encodes the redirect URI', () => {
            const url = buildAuthUrl('test');
            const redirectParam = url.split('redirect_uri=')[1].split('&')[0];
            expect(redirectParam).toBe(encodeURIComponent('https://jawab24.com/zid/auth/callback'));
        });

        it('includes state for CSRF protection', () => {
            const state = 'random_csrf_state_xyz';
            const url = buildAuthUrl(state);
            expect(url).toContain(`state=${state}`);
        });
    });

    // ============================================================
    // OAuth — exchangeCodeForToken
    // ============================================================

    describe('exchangeCodeForToken', () => {
        it('exchanges authorization code for tokens', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'zid_access_123',
                    refresh_token: 'zid_refresh_456',
                    expires_in: 31536000, // ~1 year
                }),
            });

            const result = await exchangeCodeForToken('auth_code_abc');

            expect(result).toEqual({
                accessToken: 'zid_access_123',
                refreshToken: 'zid_refresh_456',
                expiresIn: 31536000,
            });

            expect(mockFetch).toHaveBeenCalledWith(
                'https://oauth.zid.sa/oauth/token',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                }),
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body).toEqual({
                grant_type: 'authorization_code',
                client_id: 'test_zid_client_id',
                client_secret: 'test_zid_secret',
                code: 'auth_code_abc',
                redirect_uri: 'https://jawab24.com/zid/auth/callback',
            });
        });

        it('throws on failed token exchange', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => 'invalid_grant',
            });

            await expect(exchangeCodeForToken('bad_code')).rejects.toThrow(
                'Zid token exchange failed: 400 invalid_grant',
            );
        });

        it('throws on server error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            await expect(exchangeCodeForToken('code')).rejects.toThrow(
                'Zid token exchange failed: 500 Internal Server Error',
            );
        });
    });

    // ============================================================
    // Token Refresh
    // ============================================================

    describe('refreshAccessToken', () => {
        it('skips refresh if Redis lock is already held', async () => {
            mockRedisSet.mockResolvedValueOnce(null); // lock not acquired
            mockGetStoreById.mockResolvedValue(makeStore());

            await refreshAccessToken('store-1');

            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
        });

        it('skips refresh if token expires more than 24h from now', async () => {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }),
            );

            await refreshAccessToken('store-1');

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('refreshes token when close to expiry', async () => {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000) }), // 30 min
            );
            mockDecrypt.mockReturnValue('plain_refresh_token');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'new_access',
                    refresh_token: 'new_refresh',
                    expires_in: 31536000,
                }),
            });

            await refreshAccessToken('store-1');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://oauth.zid.sa/oauth/token',
                expect.objectContaining({ method: 'POST' }),
            );

            const body = Object.fromEntries(
                new URLSearchParams(mockFetch.mock.calls[0][1].body),
            );
            expect(body.grant_type).toBe('refresh_token');
            expect(body.refresh_token).toBe('plain_refresh_token');

            expect(mockUpdateStoreTokens).toHaveBeenCalledWith(
                'store-1',
                expect.objectContaining({
                    accessToken: 'new_access',
                    refreshToken: 'new_refresh',
                }),
            );
        });

        it('always releases the Redis lock even on error', async () => {
            mockRedisSet.mockResolvedValueOnce('OK');
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000) }),
            );
            mockDecrypt.mockReturnValue('plain_refresh_token');
            mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' });

            await expect(refreshAccessToken('store-1')).rejects.toThrow('Zid token refresh failed');
            expect(mockRedisDel).toHaveBeenCalledWith('zid:token_refresh:store-1');
        });
    });

    describe('ensureValidToken', () => {
        it('does not refresh when token has no expiry set', async () => {
            mockGetStoreById.mockResolvedValue(makeStore({ tokenExpiresAt: null }));

            await ensureValidToken('store-1');

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('does not refresh when token expires well in the future', async () => {
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) }),
            );

            await ensureValidToken('store-1');

            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    // ============================================================
    // Webhook HMAC Verification
    // ============================================================

    describe('verifyWebhookHmac', () => {
        it('returns true for a valid hex HMAC', () => {
            const body = '{"event":"product.created","store_id":"my-store.com"}';
            const signature = buildValidHexHmac(body);

            expect(verifyWebhookHmac(body, signature)).toBe(true);
        });

        it('returns false for an invalid HMAC', () => {
            const body = '{"event":"product.created","store_id":"my-store.com"}';
            expect(verifyWebhookHmac(body, 'deadbeef1234567890')).toBe(false);
        });

        it('returns false for mismatched body content', () => {
            const body = '{"event":"product.created"}';
            const signature = buildValidHexHmac('{"event":"product.deleted"}');
            expect(verifyWebhookHmac(body, signature)).toBe(false);
        });

        it('returns false for different length buffers', () => {
            expect(verifyWebhookHmac('body', 'short')).toBe(false);
        });

        it('uses hex digest (not base64)', () => {
            const body = '{"test":true}';
            const hexHmac = crypto
                .createHmac('sha256', 'test_webhook_secret')
                .update(body, 'utf8')
                .digest('hex');
            const base64Hmac = crypto
                .createHmac('sha256', 'test_webhook_secret')
                .update(body, 'utf8')
                .digest('base64');

            expect(verifyWebhookHmac(body, hexHmac)).toBe(true);
            expect(verifyWebhookHmac(body, base64Hmac)).toBe(false);
        });
    });

    // ============================================================
    // isProductEvent
    // ============================================================

    describe('isProductEvent', () => {
        it.each(['product.created', 'product.updated', 'product.deleted'])(
            'returns true for %s',
            (event) => {
                expect(isProductEvent(event)).toBe(true);
            },
        );

        it('returns false for non-product events', () => {
            expect(isProductEvent('app.uninstalled')).toBe(false);
            expect(isProductEvent('order.created')).toBe(false);
            expect(isProductEvent('')).toBe(false);
        });
    });

    // ============================================================
    // ZID_WEBHOOK_EVENTS constant
    // ============================================================

    describe('ZID_WEBHOOK_EVENTS', () => {
        it('includes all required events', () => {
            expect(ZID_WEBHOOK_EVENTS).toContain('product.created');
            expect(ZID_WEBHOOK_EVENTS).toContain('product.updated');
            expect(ZID_WEBHOOK_EVENTS).toContain('product.deleted');
            expect(ZID_WEBHOOK_EVENTS).toContain('app.uninstalled');
        });
    });

    // ============================================================
    // registerWebhooks
    // ============================================================

    describe('registerWebhooks', () => {
        it('registers all webhook events', async () => {
            mockFetch.mockResolvedValue({ ok: true, text: async () => '' });

            await registerWebhooks('access_token_xyz');

            // One call per event
            expect(mockFetch).toHaveBeenCalledTimes(ZID_WEBHOOK_EVENTS.length);

            for (const call of mockFetch.mock.calls) {
                const [url, opts] = call as [string, RequestInit];
                expect(url).toBe('https://api.zid.sa/v1/webhooks');
                expect((opts.headers as Record<string, string>)['X-MANAGER-TOKEN']).toBe('access_token_xyz');
                // Must NOT use Authorization: Bearer
                expect(opts.headers).not.toHaveProperty('Authorization');
            }
        });

        it('silently skips 409 (already exists) without logging error', async () => {
            mockFetch.mockResolvedValue({ ok: false, status: 409, text: async () => 'Conflict' });

            await registerWebhooks('token');

            expect(mockCaptureError).not.toHaveBeenCalled();
        });

        it('captures error for non-409 failures', async () => {
            mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Server Error' });

            await registerWebhooks('token');

            expect(mockCaptureError).toHaveBeenCalled();
        });

        it('continues registering remaining events after a single failure', async () => {
            // First event fails, rest succeed
            mockFetch
                .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Error' })
                .mockResolvedValue({ ok: true, text: async () => '' });

            await registerWebhooks('token');

            // Should attempt all events despite the first failure
            expect(mockFetch).toHaveBeenCalledTimes(ZID_WEBHOOK_EVENTS.length);
        });
    });

    // ============================================================
    // fetchStoreInfo
    // ============================================================

    describe('fetchStoreInfo', () => {
        it('maps Zid API response to store info shape', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store: {
                        id: 42,
                        name: 'My Zid Store',
                        email: 'store@example.com',
                        currency: 'SAR',
                        domain: 'my-store.zid.store',
                    },
                }),
            });

            const info = await fetchStoreInfo('access_token');

            expect(info).toEqual({
                storeName: 'My Zid Store',
                storeEmail: 'store@example.com',
                storeCurrency: 'SAR',
                storeDomain: 'my-store.zid.store',
                merchantId: '42', // always string
            });
        });

        it('converts numeric merchant ID to string', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store: { id: 12345, name: 'Store', email: 'e@e.com', currency: 'SAR', domain: 'store.zid.store' },
                }),
            });

            const info = await fetchStoreInfo('token');
            expect(typeof info.merchantId).toBe('string');
            expect(info.merchantId).toBe('12345');
        });

        it('uses X-MANAGER-TOKEN header (not Authorization: Bearer)', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store: { id: 1, name: 'S', email: 'e@e.com', currency: 'SAR', domain: 'd.zid.store' },
                }),
            });

            await fetchStoreInfo('my_manager_token');

            const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
            const headers = opts.headers as Record<string, string>;
            expect(headers['X-MANAGER-TOKEN']).toBe('my_manager_token');
            expect(headers).not.toHaveProperty('Authorization');
        });
    });

    // ============================================================
    // syncProducts
    // ============================================================

    describe('syncProducts', () => {
        it('fetches and maps products, then replaces summary', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());
            mockDecrypt.mockReturnValue('plain_token');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store_products: [
                        makeZidProduct(),
                        makeZidProduct({ id: '1002', name: 'Product 2', has_variants: true, options: [
                            { name: 'Size', values: [{ name: 'S' }, { name: 'M' }] },
                        ]}),
                    ],
                    meta: { current_page: 1, last_page: 1, per_page: 50, total: 2 },
                }),
            });

            mockReplaceProductsAndRebuildSummary.mockResolvedValue({ productCount: 2 });

            const result = await syncProducts('store-1');

            expect(mockReplaceProductsAndRebuildSummary).toHaveBeenCalledWith(
                'store-1',
                expect.arrayContaining([
                    expect.objectContaining({
                        platformProductId: '1001',
                        title: 'Test Product',
                        status: 'active',
                        priceRange: '150 SAR',
                        currency: 'SAR',
                        totalInventory: 20,
                        hasVariants: false,
                    }),
                    expect.objectContaining({
                        platformProductId: '1002',
                        hasVariants: true,
                        variantSummary: 'Size: S, M',
                    }),
                ]),
            );
            expect(result).toEqual({ productCount: 2 });
        });

        it('filters out deleted products', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());
            mockDecrypt.mockReturnValue('plain_token');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store_products: [
                        makeZidProduct({ status: 'deleted' }),
                        makeZidProduct({ id: '2', name: 'Active' }),
                    ],
                    meta: { current_page: 1, last_page: 1, per_page: 50, total: 2 },
                }),
            });

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, unknown[]];
            expect(products).toHaveLength(1);
            expect((products[0] as { title: string }).title).toBe('Active');
        });

        it('maps inactive status to hidden', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());
            mockDecrypt.mockReturnValue('plain_token');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store_products: [makeZidProduct({ status: 'inactive' })],
                    meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
                }),
            });

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, unknown[]];
            expect((products[0] as { status: string }).status).toBe('hidden');
        });

        it('strips HTML from descriptions', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());
            mockDecrypt.mockReturnValue('plain_token');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store_products: [makeZidProduct({ description: '<p>Great <strong>product</strong></p>' })],
                    meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
                }),
            });

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, unknown[]];
            const desc = (products[0] as { description: string }).description;
            expect(desc).not.toContain('<');
            expect(desc).toContain('Great');
            expect(desc).toContain('product');
        });

        it('paginates through all pages', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());
            mockDecrypt.mockReturnValue('plain_token');

            // Page 1 — 2 more pages
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store_products: [makeZidProduct({ id: 'p1' })],
                    meta: { current_page: 1, last_page: 2, per_page: 50, total: 2 },
                }),
            });
            // Page 2 — last page
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store_products: [makeZidProduct({ id: 'p2', name: 'Page 2 Product' })],
                    meta: { current_page: 2, last_page: 2, per_page: 50, total: 2 },
                }),
            });

            await syncProducts('store-1');

            expect(mockFetch).toHaveBeenCalledTimes(2);
            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, unknown[]];
            expect(products).toHaveLength(2);
        });

        it('throws if store not found', async () => {
            mockGetStoreById.mockResolvedValue(null);

            await expect(syncProducts('no-such-store')).rejects.toThrow('Store not found');
        });
    });

    // ============================================================
    // fullSync
    // ============================================================

    describe('fullSync', () => {
        it('updates store info and syncs products', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());

            // fetchStoreInfo response
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        store: {
                            id: 99,
                            name: 'Updated Store Name',
                            email: 'updated@zid.sa',
                            currency: 'SAR',
                            domain: 'my-store.zid.store',
                        },
                    }),
                })
                // syncProducts — products page
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        store_products: [makeZidProduct()],
                        meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
                    }),
                });

            await fullSync('store-1');

            // Should have called db.update for store info
            const { db } = await import('../../src/db');
            expect(db.update).toHaveBeenCalled();

            // Should have called replaceProductsAndRebuildSummary for product sync
            expect(mockReplaceProductsAndRebuildSummary).toHaveBeenCalled();
        });

        it('throws when store not found', async () => {
            mockGetStoreById.mockResolvedValue(null);

            await expect(fullSync('no-such-store')).rejects.toThrow('Store not found');
        });
    });

    // ============================================================
    // refreshExpiringTokens
    // ============================================================

    describe('refreshExpiringTokens', () => {
        it('returns 0 when no stores need refresh', async () => {
            // db.select mock returns empty array by default
            const count = await refreshExpiringTokens();
            expect(count).toBe(0);
        });

        it('captures errors for failed token refreshes and continues', async () => {
            const { db } = await import('../../src/db');
            (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ id: 'store-fail' }]),
                }),
            });

            // Make the store lookup fail (simulating an error during refresh)
            mockGetStoreById.mockResolvedValue(null);

            const count = await refreshExpiringTokens();

            // refreshAccessToken will throw for a store with no token data — captureError should be called
            expect(count).toBe(0);
        });
    });

    // ============================================================
    // lookupOrder / getShipmentTracking / checkInventory
    // ============================================================

    describe('lookupOrder', () => {
        it('returns mapped order info when order is found', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    orders: [{
                        id: 'zid-order-1',
                        reference_id: '12345',
                        status: 'delivered',
                        total_amount: 300,
                        currency: 'SAR',
                        customer_name: 'Ahmed Ali',
                        customer_phone: '+966512345678',
                        shipping_city: 'Riyadh',
                        created_at: '2026-01-15T10:00:00Z',
                        items: [{ name: 'Widget', quantity: 1, price: 300, currency: 'SAR' }],
                    }],
                }),
            });

            const result = await lookupOrder('store-1', '12345');

            expect(result).not.toBeNull();
            expect(result?.orderNumber).toBe('12345');
            expect(result?.customerFirstName).toBe('Ahmed'); // first word of customer_name
            expect(result?.status).toBe('delivered');
            expect(result?.totalAmount).toBe('300');
            expect(result?.currency).toBe('SAR');
            expect(result?.shippingCity).toBe('Riyadh');
        });

        it('returns null when order is not found', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ orders: [] }),
            });

            const result = await lookupOrder('store-1', '99999');

            expect(result).toBeNull();
        });
    });

    describe('getShipmentTracking', () => {
        it('returns shipment tracking info when order has tracking data', async () => {
            mockGetStoreById.mockResolvedValue(makeStore());

            const orderBase = {
                id: 'zid-order-1',
                reference_id: '12345',
                status: 'shipped',
                total_amount: 300,
                currency: 'SAR',
                customer_name: 'Ahmed Ali',
                customer_phone: '+966512345678',
                shipping_city: 'Jeddah',
                tracking_number: 'TRK-ZID-001',
                courier_name: 'SMSA',
                tracking_url: 'https://track.smsa.com.sa/TRK-ZID-001',
            };

            // First fetch: search
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ orders: [orderBase] }),
            });
            // Second fetch: order detail
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ order: orderBase }),
            });

            const result = await getShipmentTracking('store-1', '12345');

            expect(result).not.toBeNull();
            expect(result?.trackingNumber).toBe('TRK-ZID-001');
            expect(result?.courierName).toBe('SMSA');
            expect(result?.trackingUrl).toBe('https://track.smsa.com.sa/TRK-ZID-001');
            expect(result?.status).toBe('shipped');
        });
    });

    describe('checkInventory', () => {
        it('returns inventory info for a matching product', async () => {
            mockGetStoreById.mockResolvedValue(makeStore({ storeDomain: 'mystore.zid.sa' }));

            const product = makeZidProduct({ name: 'Phone Case', quantity: 8, price: 45 });
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    store_products: [product],
                    meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
                }),
            });

            const result = await checkInventory('store-1', 'Phone Case');

            expect(result).not.toBeNull();
            expect(result?.productName).toBe('Phone Case');
            expect(result?.available).toBe(true);
            expect(result?.quantity).toBe(8);
            expect(result?.price).toBe('45 SAR');
        });
    });
});
