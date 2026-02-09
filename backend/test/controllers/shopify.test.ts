import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

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
}));

vi.mock('@jawab24/shared', () => ({
    SHOPIFY_SYNC_QUEUE_NAME: 'shopify-sync-queue',
}));

// Mock BullMQ
const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
const mockQueueClose = vi.fn().mockResolvedValue(undefined);
vi.mock('bullmq', () => ({
    Queue: vi.fn().mockImplementation(() => ({
        add: mockQueueAdd,
        close: mockQueueClose,
    })),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {},
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
        userId: 'user-123',
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

        it('should redirect to Shopify OAuth URL for valid shop', async () => {
            const req = mockRequest({ query: { shop: 'test-store.myshopify.com' } });
            const rep = mockReply();

            await authRedirect(req, rep);

            expect(rep.setCookie).toHaveBeenCalledWith('shopify_state', expect.any(String), expect.objectContaining({
                httpOnly: true,
                secure: true,
            }));
            expect(rep.redirect).toHaveBeenCalled();
        });
    });

    // --- authCallback ---

    describe('authCallback', () => {
        it('should reject when state does not match', async () => {
            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'state1' },
                cookies: { shopify_state: 'state2' },
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should reject when user is not authenticated', async () => {
            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'state1' },
                cookies: { shopify_state: 'state1' },
                userId: undefined,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should create store and redirect on success', async () => {
            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'code123', state: 'state1' },
                cookies: { shopify_state: 'state1' },
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockExchangeCodeForToken).toHaveBeenCalledWith('test.myshopify.com', 'code123');
            expect(mockCreateStore).toHaveBeenCalledWith('user-123', 'test.myshopify.com', 'shpat_test_token');
            expect(mockRegisterWebhooks).toHaveBeenCalledWith('test.myshopify.com', 'shpat_test_token');
            expect(rep.redirect).toHaveBeenCalledWith(expect.stringContaining('shopify=connected'));
        });

        it('should redirect with error on exception', async () => {
            mockExchangeCodeForToken.mockRejectedValueOnce(new Error('Token exchange failed'));
            const req = mockRequest({
                query: { shop: 'test.myshopify.com', code: 'badcode', state: 'state1' },
                cookies: { shopify_state: 'state1' },
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.redirect).toHaveBeenCalledWith(expect.stringContaining('shopify=error'));
        });
    });

    // --- webhookUninstall ---

    describe('webhookUninstall', () => {
        it('should reject invalid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(false);
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'invalid' },
                body: { myshopify_domain: 'test.myshopify.com' },
            });
            const rep = mockReply();

            await webhookUninstall(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should deactivate store on valid uninstall webhook', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const req = mockRequest({
                headers: { 'x-shopify-hmac-sha256': 'valid_hmac' },
                body: { myshopify_domain: 'test.myshopify.com' },
            });
            const rep = mockReply();

            await webhookUninstall(req, rep);

            expect(mockDeactivateStore).toHaveBeenCalledWith('test.myshopify.com');
            expect(rep.status).toHaveBeenCalledWith(200);
        });
    });

    // --- webhookProductsUpdate ---

    describe('webhookProductsUpdate', () => {
        it('should enqueue product sync on valid webhook', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const req = mockRequest({
                headers: {
                    'x-shopify-hmac-sha256': 'valid_hmac',
                    'x-shopify-shop-domain': 'test.myshopify.com',
                },
                body: {},
            });
            const rep = mockReply();

            await webhookProductsUpdate(req, rep);

            expect(mockQueueAdd).toHaveBeenCalledWith('product_update', expect.objectContaining({
                shopifyStoreId: 'store-1',
            }));
            expect(rep.status).toHaveBeenCalledWith(200);
        });
    });

    // --- GDPR ---

    describe('GDPR endpoints', () => {
        it('gdprCustomerDataRequest returns 200', async () => {
            const rep = mockReply();
            await gdprCustomerDataRequest(mockRequest(), rep);
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('gdprCustomerRedact returns 200', async () => {
            const rep = mockReply();
            await gdprCustomerRedact(mockRequest(), rep);
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('gdprShopRedact deactivates store', async () => {
            const req = mockRequest({ body: { shop_domain: 'test.myshopify.com' } });
            const rep = mockReply();
            await gdprShopRedact(req, rep);
            expect(mockDeactivateStore).toHaveBeenCalledWith('test.myshopify.com');
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
