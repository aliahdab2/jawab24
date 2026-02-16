import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocked shopify service functions ---
const mockBuildAuthUrl = vi.fn().mockReturnValue('https://test-store.myshopify.com/admin/oauth/authorize?...');
const mockExchangeCodeForToken = vi.fn().mockResolvedValue('shpat_test_token');
const mockCreateStore = vi.fn().mockResolvedValue({ id: 'store-1', shopDomain: 'test.myshopify.com' });
const mockRegisterWebhooks = vi.fn().mockResolvedValue(undefined);
const mockVerifyWebhookHmac = vi.fn();
const mockDeactivateStore = vi.fn().mockResolvedValue(undefined);
const mockGetStoreByDomain = vi.fn();
const mockGetStoreByUserId = vi.fn();
const mockDisconnectStore = vi.fn().mockResolvedValue(undefined);
const mockFullSync = vi.fn().mockResolvedValue({ synced: 10 });
const mockGetProducts = vi.fn().mockResolvedValue([]);
const mockLinkStoreToPage = vi.fn().mockResolvedValue(undefined);
const mockMapToShopifyStore = vi.fn((store) => ({ id: store.id, shopDomain: store.shopDomain }));
const mockCreatePendingInstall = vi.fn().mockResolvedValue('pending-uuid-123');

vi.mock('../../src/services/shopify', () => ({
    buildAuthUrl: (...args: any[]) => mockBuildAuthUrl(...args),
    exchangeCodeForToken: (...args: any[]) => mockExchangeCodeForToken(...args),
    createStore: (...args: any[]) => mockCreateStore(...args),
    registerWebhooks: (...args: any[]) => mockRegisterWebhooks(...args),
    verifyWebhookHmac: (...args: any[]) => mockVerifyWebhookHmac(...args),
    deactivateStore: (...args: any[]) => mockDeactivateStore(...args),
    getStoreByDomain: (...args: any[]) => mockGetStoreByDomain(...args),
    getStoreByUserId: (...args: any[]) => mockGetStoreByUserId(...args),
    disconnectStore: (...args: any[]) => mockDisconnectStore(...args),
    fullSync: (...args: any[]) => mockFullSync(...args),
    getProducts: (...args: any[]) => mockGetProducts(...args),
    linkStoreToPage: (...args: any[]) => mockLinkStoreToPage(...args),
    mapToShopifyStore: (...args: any[]) => mockMapToShopifyStore(...args),
    createPendingInstall: (...args: any[]) => mockCreatePendingInstall(...args),
}));

const mockVerifyToken = vi.fn();
vi.mock('../../src/services/auth', () => ({
    authService: {
        verifyToken: (...args: any[]) => mockVerifyToken(...args),
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        shopify: {
            scopes: 'read_products,read_content',
        },
    },
}));

vi.mock('../../src/services/cookies', () => ({
    PENDING_SHOPIFY_COOKIE_OPTIONS: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        signed: true,
        maxAge: 1800,
    },
    SHOPIFY_NONCE_COOKIE_OPTIONS: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        signed: true,
        maxAge: 600,
    },
}));

vi.mock('@jawab24/shared', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@jawab24/shared')>();
    return {
        ...actual,
        SHOPIFY_SYNC_QUEUE_NAME: 'shopify-sync-queue',
    };
});

// Mock the singleton sync queue
const mockEnqueueSyncJob = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/lib/shopifySyncQueue', () => ({
    enqueueSyncJob: (...args: any[]) => mockEnqueueSyncJob(...args),
}));

import {
    authRedirect,
    authCallback,
    webhookUninstall,
    webhookProductsUpdate,
    gdprCustomerDataRequest,
    gdprCustomerRedact,
    gdprShopRedact,
    getStore,
    connectStore,
    disconnectStoreHandler,
    syncStore,
    getStoreProducts,
    linkPage,
} from '../../src/controllers/shopify';

function mockRequest(overrides: Partial<any> = {}): any {
    return {
        query: {},
        body: {},
        headers: {},
        cookies: {},
        user: { userId: 'user-123', facebookId: 'fb-123' },
        unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
        log: {
            error: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
        },
        ...overrides,
    };
}

function mockReply(): any {
    const reply: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        redirect: vi.fn().mockReturnThis(),
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
    };
    return reply;
}

describe('Shopify Controller', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- authRedirect ---

    describe('authRedirect', () => {
        it('should reject invalid shop domain', async () => {
            const req = mockRequest({ query: { shop: 'invalid-domain' } });
            const rep = mockReply();

            await authRedirect(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
            expect(rep.send).toHaveBeenCalledWith({ error: 'Invalid shop domain' });
        });

        it('should reject missing shop param', async () => {
            const req = mockRequest({ query: {} });
            const rep = mockReply();

            await authRedirect(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should set signed nonce cookie and redirect to Shopify OAuth', async () => {
            const req = mockRequest({ query: { shop: 'test-store.myshopify.com' } });
            const rep = mockReply();

            await authRedirect(req, rep);

            // Should set shopifyNonce cookie with SHOPIFY_NONCE_COOKIE_OPTIONS
            expect(rep.setCookie).toHaveBeenCalledWith(
                'shopifyNonce',
                expect.any(String),
                expect.objectContaining({
                    httpOnly: true,
                    signed: true,
                    sameSite: 'lax',
                })
            );
            // Should call buildAuthUrl with shop and nonce
            expect(mockBuildAuthUrl).toHaveBeenCalledWith(
                'test-store.myshopify.com',
                expect.any(String)
            );
            expect(rep.redirect).toHaveBeenCalled();
        });

        it('should generate unique nonce per request', async () => {
            const req1 = mockRequest({ query: { shop: 'store1.myshopify.com' } });
            const req2 = mockRequest({ query: { shop: 'store2.myshopify.com' } });
            const rep1 = mockReply();
            const rep2 = mockReply();

            await authRedirect(req1, rep1);
            await authRedirect(req2, rep2);

            // Get the nonce values passed to setCookie
            const nonce1 = rep1.setCookie.mock.calls[0][1];
            const nonce2 = rep2.setCookie.mock.calls[0][1];
            expect(nonce1).not.toBe(nonce2);
        });
    });

    // --- authCallback ---

    describe('authCallback', () => {
        it('should reject when nonce does not match (signed cookie validation)', async () => {
            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce_from_url' },
                cookies: { shopifyNonce: 'signed_cookie_value' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'different_nonce' }),
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
            expect(rep.send).toHaveBeenCalledWith({ error: 'Invalid OAuth callback: state mismatch' });
        });

        it('should reject when nonce cookie is missing', async () => {
            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: {},
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should reject when signed cookie is invalid', async () => {
            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'tampered_cookie' },
                unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should create store directly when user is logged in (JWT cookie)', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    if (cookie === 'signed_jwt') return { valid: true, value: 'jwt_token' };
                    return { valid: false, value: null };
                });

            mockVerifyToken.mockReturnValue({ userId: 'user-123' });

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockExchangeCodeForToken).toHaveBeenCalledWith('test.myshopify.com', 'code123');
            expect(mockCreateStore).toHaveBeenCalledWith('user-123', 'test.myshopify.com', 'shpat_test_token');
            expect(mockRegisterWebhooks).toHaveBeenCalledWith('test.myshopify.com', 'shpat_test_token');
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/shopify/onboarding');
        });

        it('should create pending install when user is NOT logged in', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    return { valid: false, value: null };
                });

            mockGetStoreByDomain.mockResolvedValue(null);
            mockCreatePendingInstall.mockResolvedValue('pending-uuid-456');

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockExchangeCodeForToken).toHaveBeenCalledWith('test.myshopify.com', 'code123');
            expect(mockCreatePendingInstall).toHaveBeenCalledWith({
                shopDomain: 'test.myshopify.com',
                accessToken: 'shpat_test_token',
                scopes: 'read_products,read_content',
                nonce: 'nonce123',
            });
            expect(rep.setCookie).toHaveBeenCalledWith(
                'pendingShopifyId',
                'pending-uuid-456',
                expect.objectContaining({ signed: true, sameSite: 'lax' })
            );
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?shopify_pending=true');
        });

        it('should redirect with error when shop is already connected (not logged in)', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    return { valid: false, value: null };
                });

            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1', isActive: true });

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?shopify_error=already_connected');
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
        });

        it('should create pending install when shop exists but is inactive', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    return { valid: false, value: null };
                });

            // Shop exists but is inactive (uninstalled before)
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1', isActive: false });
            mockCreatePendingInstall.mockResolvedValue('pending-uuid-789');

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockCreatePendingInstall).toHaveBeenCalled();
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?shopify_pending=true');
        });

        it('should redirect with error on token exchange failure', async () => {
            mockExchangeCodeForToken.mockRejectedValueOnce(new Error('Token exchange failed'));
            const unsignCookie = vi.fn()
                .mockReturnValue({ valid: true, value: 'nonce123' });

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'badcode', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?shopify_error=auth_failed');
        });

        it('should clear nonce cookie after successful validation', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    return { valid: false, value: null };
                });

            mockGetStoreByDomain.mockResolvedValue(null);
            mockCreatePendingInstall.mockResolvedValue('pending-id');

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.clearCookie).toHaveBeenCalledWith('shopifyNonce', { path: '/' });
        });

        it('should detect logged-in user via Bearer header', async () => {
            const unsignCookie = vi.fn()
                .mockReturnValue({ valid: true, value: 'nonce123' });

            mockVerifyToken.mockReturnValue({ userId: 'user-456' });

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce' },
                headers: { authorization: 'Bearer jwt_token_from_header' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockVerifyToken).toHaveBeenCalledWith('jwt_token_from_header');
            expect(mockCreateStore).toHaveBeenCalledWith('user-456', 'test.myshopify.com', 'shpat_test_token');
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/shopify/onboarding');
        });

        it('should enqueue sync after creating store for logged-in user', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    if (cookie === 'signed_jwt') return { valid: true, value: 'jwt_token' };
                    return { valid: false, value: null };
                });

            mockVerifyToken.mockReturnValue({ userId: 'user-123' });

            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'nonce123' },
                cookies: { shopifyNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            // enqueueSyncJob is fire-and-forget — wait a tick for it to settle
            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1');
        });
    });

    // --- webhookUninstall ---

    describe('webhookUninstall', () => {
        it('should reject missing rawBody', async () => {
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'valid_hmac' },
                body: { myshopify_domain: 'test.myshopify.com' },
            });
            const rep = mockReply();

            await webhookUninstall(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should reject invalid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(false);
            const body = { myshopify_domain: 'test.myshopify.com' };
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'invalid' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookUninstall(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should deactivate store on valid uninstall webhook', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { myshopify_domain: 'test.myshopify.com' };
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookUninstall(req, rep);

            expect(mockDeactivateStore).toHaveBeenCalledWith('test.myshopify.com');
            expect(rep.status).toHaveBeenCalledWith(200);
        });
    });

    // --- webhookProductsUpdate ---

    describe('webhookProductsUpdate', () => {
        it('should enqueue sync on valid webhook', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {};
            const req = mockRequest({
                headers: {
                    'x-shopify-hmac-sha256': 'valid_hmac',
                    'x-shopify-shop-domain': 'test.myshopify.com',
                },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookProductsUpdate(req, rep);

            // enqueueSyncJob is fire-and-forget — wait a tick for it to settle
            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should reject missing rawBody for product webhook', async () => {
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'valid_hmac' },
                body: {},
            });
            const rep = mockReply();

            await webhookProductsUpdate(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should reject invalid HMAC for product webhook', async () => {
            mockVerifyWebhookHmac.mockReturnValue(false);
            const body = {};
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'invalid' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookProductsUpdate(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });
    });

    // --- GDPR ---

    describe('GDPR endpoints', () => {
        it('gdprCustomerDataRequest rejects missing rawBody', async () => {
            const rep = mockReply();
            await gdprCustomerDataRequest(mockRequest(), rep);
            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('gdprCustomerDataRequest returns 200 with valid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = {};
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();
            await gdprCustomerDataRequest(req, rep);
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('gdprCustomerRedact rejects missing rawBody', async () => {
            const rep = mockReply();
            await gdprCustomerRedact(mockRequest(), rep);
            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('gdprCustomerRedact returns 200 with valid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = {};
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();
            await gdprCustomerRedact(req, rep);
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('gdprShopRedact deactivates store with valid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { shop_domain: 'test.myshopify.com' };
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();
            await gdprShopRedact(req, rep);
            expect(mockDeactivateStore).toHaveBeenCalledWith('test.myshopify.com');
        });

        it('gdprShopRedact rejects invalid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(false);
            const body = { shop_domain: 'test.myshopify.com' };
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'invalid' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();
            await gdprShopRedact(req, rep);
            expect(rep.status).toHaveBeenCalledWith(401);
        });
    });

    // --- Protected API ---

    describe('getStore', () => {
        it('should return 404 when no store found', async () => {
            mockGetStoreByUserId.mockResolvedValue(null);
            const req = mockRequest();
            const rep = mockReply();

            await getStore(req, rep);

            expect(rep.status).toHaveBeenCalledWith(404);
        });

        it('should return store data', async () => {
            mockGetStoreByUserId.mockResolvedValue({ id: 'store-1', shopDomain: 'test.myshopify.com' });
            const req = mockRequest();
            const rep = mockReply();

            await getStore(req, rep);

            expect(mockMapToShopifyStore).toHaveBeenCalled();
            expect(rep.send).toHaveBeenCalled();
        });
    });

    describe('connectStore', () => {
        it('should reject invalid shop domain', async () => {
            const req = mockRequest({ body: { shopDomain: 'not-a-shopify-domain' } });
            const rep = mockReply();

            await connectStore(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should set nonce cookie and return auth URL', async () => {
            const req = mockRequest({ body: { shopDomain: 'mystore.myshopify.com' } });
            const rep = mockReply();

            await connectStore(req, rep);

            expect(rep.setCookie).toHaveBeenCalledWith(
                'shopifyNonce',
                expect.any(String),
                expect.objectContaining({ signed: true })
            );
            expect(rep.send).toHaveBeenCalledWith({ authUrl: expect.any(String) });
        });
    });

    describe('disconnectStoreHandler', () => {
        it('should return 404 when no store', async () => {
            mockGetStoreByUserId.mockResolvedValue(null);
            const rep = mockReply();

            await disconnectStoreHandler(mockRequest(), rep);

            expect(rep.status).toHaveBeenCalledWith(404);
        });

        it('should disconnect store', async () => {
            mockGetStoreByUserId.mockResolvedValue({ id: 'store-1' });
            const rep = mockReply();

            await disconnectStoreHandler(mockRequest(), rep);

            expect(mockDisconnectStore).toHaveBeenCalledWith('store-1');
            expect(rep.send).toHaveBeenCalledWith({ ok: true });
        });
    });

    describe('syncStore', () => {
        it('should sync and return result', async () => {
            mockGetStoreByUserId.mockResolvedValue({ id: 'store-1' });
            const rep = mockReply();

            await syncStore(mockRequest(), rep);

            expect(mockFullSync).toHaveBeenCalledWith('store-1');
            expect(rep.send).toHaveBeenCalledWith({ synced: 10 });
        });
    });

    describe('getStoreProducts', () => {
        it('should return products', async () => {
            mockGetStoreByUserId.mockResolvedValue({ id: 'store-1' });
            mockGetProducts.mockResolvedValue([{ id: 'p1', title: 'Product 1' }]);
            const rep = mockReply();

            await getStoreProducts(mockRequest(), rep);

            expect(rep.send).toHaveBeenCalledWith({
                products: [{ id: 'p1', title: 'Product 1' }],
                total: 1,
            });
        });
    });

    describe('linkPage', () => {
        it('should reject missing pageId', async () => {
            const req = mockRequest({ body: {} });
            const rep = mockReply();

            await linkPage(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should return 403 when page does not belong to user', async () => {
            mockGetStoreByUserId.mockResolvedValue({ id: 'store-1' });
            mockLinkStoreToPage.mockRejectedValueOnce(new Error('Page not found or does not belong to user'));
            const req = mockRequest({ body: { pageId: 'page-1' } });
            const rep = mockReply();

            await linkPage(req, rep);

            expect(rep.status).toHaveBeenCalledWith(403);
        });

        it('should link page successfully', async () => {
            mockGetStoreByUserId.mockResolvedValue({ id: 'store-1' });
            mockLinkStoreToPage.mockResolvedValueOnce(undefined);
            const req = mockRequest({ body: { pageId: 'page-1' } });
            const rep = mockReply();

            await linkPage(req, rep);

            expect(mockLinkStoreToPage).toHaveBeenCalledWith('store-1', 'page-1', 'user-123');
            expect(rep.send).toHaveBeenCalledWith({ ok: true });
        });
    });
});
