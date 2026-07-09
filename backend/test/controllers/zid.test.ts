import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocked zid service functions ---
const mockBuildAuthUrl = vi.fn().mockReturnValue('https://oauth.zid.sa/connect/authorize?...');
const mockExchangeCodeForToken = vi.fn().mockResolvedValue({
    accessToken: 'zid_access_token',
    refreshToken: 'zid_refresh_token',
    expiresIn: 31536000,
});
const mockVerifyWebhookHmac = vi.fn();
const mockRegisterWebhooks = vi.fn().mockResolvedValue(undefined);
const mockFetchStoreInfo = vi.fn().mockResolvedValue({
    storeName: 'My Zid Store',
    storeEmail: 'store@zid.sa',
    storeCurrency: 'SAR',
    storeDomain: 'my-zid-store.zid.store',
    merchantId: '67890',
});
const mockFullSync = vi.fn().mockResolvedValue({ synced: 15 });
const mockIsProductEvent = vi.fn((event: string) => event.startsWith('product.'));

vi.mock('../../src/services/zid', () => ({
    buildAuthUrl: (...args: any[]) => mockBuildAuthUrl(...args),
    exchangeCodeForToken: (...args: any[]) => mockExchangeCodeForToken(...args),
    verifyWebhookHmac: (...args: any[]) => mockVerifyWebhookHmac(...args),
    registerWebhooks: (...args: any[]) => mockRegisterWebhooks(...args),
    fetchStoreInfo: (...args: any[]) => mockFetchStoreInfo(...args),
    fullSync: (...args: any[]) => mockFullSync(...args),
    isProductEvent: (...args: any[]) => mockIsProductEvent(...args),
    isOrderEvent: vi.fn(() => false),
}));

vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { schedule: vi.fn().mockResolvedValue(undefined) },
}));

// --- Mocked shared ecommerce service ---
const mockGetStoreByDomain = vi.fn();
const mockGetStoreByMerchantId = vi.fn();
const mockGetStoreByWorkspace = vi.fn();
const mockGetStoreByWorkspaceAny = vi.fn();
const mockCreateStore = vi.fn().mockResolvedValue({ id: 'store-1', storeDomain: 'my-zid-store.zid.store' });
const mockDisconnectStore = vi.fn().mockResolvedValue(undefined);
const mockDeactivateStore = vi.fn().mockResolvedValue(undefined);
const mockLinkStoreToPage = vi.fn().mockResolvedValue(undefined);
const mockGetProducts = vi.fn().mockResolvedValue([]);
const mockMapToEcommerceStore = vi.fn((store) => ({ id: store.id, storeDomain: store.storeDomain }));
const mockCreatePendingInstall = vi.fn().mockResolvedValue('pending-zid-123');

vi.mock('../../src/services/ecommerce', () => ({
    getStoreByDomain: (...args: any[]) => mockGetStoreByDomain(...args),
    getStoreByMerchantId: (...args: any[]) => mockGetStoreByMerchantId(...args),
    // Pass-through to the real domain-first → merchantId-fallback logic so the
    // existing "resolves by domain / falls back to merchantId" assertions still hold.
    resolveStoreByDomainOrMerchant: async (platform: any, id: any) =>
        (await mockGetStoreByDomain(platform, id)) || (await mockGetStoreByMerchantId(platform, id)),
    getStoreByWorkspace: (...args: any[]) => mockGetStoreByWorkspace(...args),
    getStoreByWorkspaceAny: (...args: any[]) => mockGetStoreByWorkspaceAny(...args),
    createStore: (...args: any[]) => mockCreateStore(...args),
    disconnectStore: (...args: any[]) => mockDisconnectStore(...args),
    deactivateStore: (...args: any[]) => mockDeactivateStore(...args),
    linkStoreToPage: (...args: any[]) => mockLinkStoreToPage(...args),
    getProducts: (...args: any[]) => mockGetProducts(...args),
    mapToEcommerceStore: (...args: any[]) => mockMapToEcommerceStore(...args),
    createPendingInstall: (...args: any[]) => mockCreatePendingInstall(...args),
    registerWebhooksWithPersist: (_storeId: string, _platform: string, fn: () => Promise<unknown>) => fn(),
}));

const mockVerifyToken = vi.fn();
vi.mock('../../src/services/auth', () => ({
    authService: {
        verifyToken: (...args: any[]) => mockVerifyToken(...args),
    },
}));

const mockGetUserWorkspaces = vi.fn().mockResolvedValue([{ id: 'test_workspace_id' }]);
vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: (...args: any[]) => mockGetUserWorkspaces(...args),
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        zid: {
            clientId: 'test_zid_client',
            clientSecret: 'test_zid_secret',
            webhookSecret: 'test_zid_webhook_secret',
            scopes: 'store.info orders.read products.read',
        },
    },
}));

vi.mock('../../src/services/cookies', () => ({
    PENDING_ZID_COOKIE_OPTIONS: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        signed: true,
        maxAge: 1800,
    },
    ZID_NONCE_COOKIE_OPTIONS: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        signed: true,
        maxAge: 600,
    },
}));

const mockEnqueueSyncJob = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/lib/ecommerceSyncQueue', () => ({
    enqueueSyncJob: (...args: any[]) => mockEnqueueSyncJob(...args),
}));

import {
    authRedirect,
    authCallback,
    webhookHandler,
    getStore,
    connectStore,
    disconnectStoreHandler,
    syncStore,
    getStoreProducts,
    linkPage,
} from '../../src/controllers/zid';

function mockRequest(overrides: Partial<any> = {}): any {
    return {
        query: {},
        body: {},
        headers: {},
        cookies: {},
        user: { userId: 'user-123' },
        workspaceId: 'test_workspace_id',
        workspaceRole: 'owner',
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
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        redirect: vi.fn().mockReturnThis(),
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
    };
}

describe('Zid Controller', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- authRedirect ---

    describe('authRedirect', () => {
        it('should set signed nonce cookie and redirect to Zid OAuth', async () => {
            const req = mockRequest();
            const rep = mockReply();

            await authRedirect(req, rep);

            expect(rep.setCookie).toHaveBeenCalledWith(
                'zidNonce',
                expect.any(String),
                expect.objectContaining({
                    httpOnly: true,
                    signed: true,
                    sameSite: 'lax',
                })
            );
            expect(mockBuildAuthUrl).toHaveBeenCalledWith(expect.any(String));
            expect(rep.redirect).toHaveBeenCalled();
        });

        it('should generate unique nonce per request', async () => {
            const rep1 = mockReply();
            const rep2 = mockReply();

            await authRedirect(mockRequest(), rep1);
            await authRedirect(mockRequest(), rep2);

            const nonce1 = rep1.setCookie.mock.calls[0][1];
            const nonce2 = rep2.setCookie.mock.calls[0][1];
            expect(nonce1).not.toBe(nonce2);
        });

        it('should not require a shop domain (Zid authenticates merchant directly)', async () => {
            const req = mockRequest({ query: {} });
            const rep = mockReply();

            await authRedirect(req, rep);

            expect(rep.redirect).toHaveBeenCalled();
        });
    });

    // --- authCallback ---

    describe('authCallback', () => {
        it('should reject when nonce does not match state', async () => {
            const req = mockRequest({
                query: { code: 'code123', state: 'nonce_from_url' },
                cookies: { zidNonce: 'signed_cookie_value' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'different_nonce' }),
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
            expect(rep.send).toHaveBeenCalledWith({ error: 'Invalid OAuth callback: state mismatch' });
        });

        it('should treat a missing nonce cookie as a platform-initiated (Zid App Market) install and proceed', async () => {
            // Zid App Market / platform-initiated installs redirect straight to the callback
            // with their own state and NO prior nonce from us. The CSRF state check must not
            // reject this — the server-to-server code exchange is the trust anchor.
            const req = mockRequest({
                query: { code: 'code123', state: 'zid_state_abc' },
                cookies: {},
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockExchangeCodeForToken).toHaveBeenCalledWith('code123');
            expect(mockCreatePendingInstall).toHaveBeenCalled();
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?zid_pending=true');
            expect(rep.status).not.toHaveBeenCalledWith(400);
        });

        it('should reject when signed cookie is invalid', async () => {
            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'tampered_cookie' },
                unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should reject when code is missing', async () => {
            const req = mockRequest({
                query: { state: 'nonce123' },
                cookies: { zidNonce: 'signed_cookie' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'nonce123' }),
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
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockExchangeCodeForToken).toHaveBeenCalledWith('code123');
            expect(mockFetchStoreInfo).toHaveBeenCalledWith('zid_access_token');
            expect(mockGetUserWorkspaces).toHaveBeenCalledWith('user-123');
            expect(mockCreateStore).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'user-123',
                platform: 'zid',
                storeDomain: 'my-zid-store.zid.store',
                accessToken: 'zid_access_token',
                refreshToken: 'zid_refresh_token',
                tokenExpiresAt: expect.any(Date),
                workspaceId: 'test_workspace_id',
            }));
            // expiresIn(31536000s)→ms must be ~365 days out (guards a dropped *1000).
            const storeArg = mockCreateStore.mock.calls[0][0];
            const msUntilExpiry = storeArg.tokenExpiresAt.getTime() - Date.now();
            expect(msUntilExpiry).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
            expect(msUntilExpiry).toBeLessThan(370 * 24 * 60 * 60 * 1000);
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/zid/onboarding');
        });

        it('should store merchantId in platformData when creating store', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    if (cookie === 'signed_jwt') return { valid: true, value: 'jwt_token' };
                    return { valid: false, value: null };
                });

            mockVerifyToken.mockReturnValue({ userId: 'user-123' });

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockCreateStore).toHaveBeenCalledWith(expect.objectContaining({
                platformData: { merchantId: '67890' },
            }));
        });

        it('should create pending install when user is NOT logged in', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    return { valid: false, value: null };
                });

            mockGetStoreByDomain.mockResolvedValue(null);

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockCreatePendingInstall).toHaveBeenCalledWith('zid', expect.objectContaining({
                storeDomain: 'my-zid-store.zid.store',
                accessToken: 'zid_access_token',
                refreshToken: 'zid_refresh_token',
                tokenExpiresAt: expect.any(Date),
                nonce: 'nonce123',
            }));
            // Guard the expiresIn(seconds)→ms conversion: 31536000s must land ~365 days
            // out. Catches a dropped *1000 or unit/sign regression that would re-break
            // refresh on app-store (logged-out) installs — the bug this PR fixes.
            const pendingArg = mockCreatePendingInstall.mock.calls[0][1];
            const msUntilExpiry = pendingArg.tokenExpiresAt.getTime() - Date.now();
            expect(msUntilExpiry).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
            expect(msUntilExpiry).toBeLessThan(370 * 24 * 60 * 60 * 1000);
            expect(rep.setCookie).toHaveBeenCalledWith(
                'pendingZidId',
                'pending-zid-123',
                expect.objectContaining({ signed: true, sameSite: 'lax' })
            );
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?zid_pending=true');
        });

        it('should redirect with error when store is already connected (not logged in)', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    return { valid: false, value: null };
                });

            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1', isActive: true });

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?zid_error=already_connected');
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
        });

        it('should redirect with error on token exchange failure', async () => {
            mockExchangeCodeForToken.mockRejectedValueOnce(new Error('Token exchange failed'));
            const unsignCookie = vi.fn()
                .mockReturnValue({ valid: true, value: 'nonce123' });

            const req = mockRequest({
                query: { code: 'badcode', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?zid_error=auth_failed');
        });

        it('should clear nonce cookie after successful validation', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    return { valid: false, value: null };
                });

            mockGetStoreByDomain.mockResolvedValue(null);

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.clearCookie).toHaveBeenCalledWith('zidNonce', { path: '/' });
        });

        it('should detect logged-in user via Bearer header', async () => {
            const unsignCookie = vi.fn()
                .mockReturnValue({ valid: true, value: 'nonce123' });

            mockVerifyToken.mockReturnValue({ userId: 'user-456' });

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce' },
                headers: { authorization: 'Bearer jwt_token_from_header' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockVerifyToken).toHaveBeenCalledWith('jwt_token_from_header');
            expect(mockGetUserWorkspaces).toHaveBeenCalledWith('user-456');
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/zid/onboarding');
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
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'zid');
        });

        it('should register webhooks non-blocking after creating store', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    if (cookie === 'signed_jwt') return { valid: true, value: 'jwt_token' };
                    return { valid: false, value: null };
                });

            mockVerifyToken.mockReturnValue({ userId: 'user-123' });

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            await new Promise(r => setTimeout(r, 10));

            expect(mockRegisterWebhooks).toHaveBeenCalledWith('zid_access_token');
        });
    });

    // --- Webhook ---

    describe('webhookHandler', () => {
        it('should reject missing rawBody', async () => {
            const req = mockRequest({
                headers: { 'x-zid-signature': 'valid_hmac' },
                body: { event: 'product.created', store_id: '67890' },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should reject invalid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(false);
            const body = { event: 'product.created', store_id: '67890' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'invalid' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should use X-Zid-Signature header for HMAC verification', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'product.created', store_id: '67890' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'hex_hmac_value' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockVerifyWebhookHmac).toHaveBeenCalledWith(
                JSON.stringify(body),
                'hex_hmac_value'
            );
        });

        it('should return 200 when store_id is missing', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'product.created' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should deactivate store on app.uninstalled via domain lookup', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1', storeDomain: 'my-zid-store.zid.store' });
            const body = { event: 'app.uninstalled', store_id: 'my-zid-store.zid.store' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDeactivateStore).toHaveBeenCalledWith('zid', 'my-zid-store.zid.store');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should deactivate store on app.uninstalled via merchantId fallback', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue(null);
            mockGetStoreByMerchantId.mockResolvedValue({ id: 'store-1', storeDomain: 'my-zid-store.zid.store' });
            const body = { event: 'app.uninstalled', store_id: '67890' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockGetStoreByMerchantId).toHaveBeenCalledWith('zid', '67890');
            expect(mockDeactivateStore).toHaveBeenCalledWith('zid', 'my-zid-store.zid.store');
        });

        it('should enqueue sync on product.created event', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = { event: 'product.created', store_id: 'my-zid-store.zid.store' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            await new Promise(r => setTimeout(r, 10));

            // product_update, not full_sync — store info doesn't change on a product edit.
            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'zid', 'product_update');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should return 200 even when store not found for product event', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue(null);
            mockGetStoreByMerchantId.mockResolvedValue(null);
            const body = { event: 'product.deleted', store_id: '99999' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should ignore unknown events gracefully', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'order.created', store_id: '67890' };
            const req = mockRequest({
                headers: { 'x-zid-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(mockDeactivateStore).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });
    });

    // --- Protected API ---

    describe('getStore', () => {

        it('returns 200 with null when no store connected (not 404 — onboarding state, not missing resource)', async () => {
            mockGetStoreByWorkspaceAny.mockResolvedValue(null);
            const req = mockRequest();
            const rep = mockReply();

            await getStore(req, rep);

            expect(mockGetStoreByWorkspaceAny).toHaveBeenCalledWith('zid', 'test_workspace_id');
            expect(rep.status).not.toHaveBeenCalled();
            expect(rep.send).toHaveBeenCalledWith(null);
        });

        it('should return store data', async () => {
            mockGetStoreByWorkspaceAny.mockResolvedValue({ id: 'store-1', storeDomain: 'my-zid-store.zid.store' });
            const req = mockRequest();
            const rep = mockReply();

            await getStore(req, rep);

            expect(mockMapToEcommerceStore).toHaveBeenCalled();
            expect(rep.send).toHaveBeenCalled();
        });
    });

    describe('connectStore', () => {
        it('should set nonce cookie and return auth URL', async () => {
            const req = mockRequest();
            const rep = mockReply();

            await connectStore(req, rep);

            expect(rep.setCookie).toHaveBeenCalledWith(
                'zidNonce',
                expect.any(String),
                expect.objectContaining({ signed: true })
            );
            expect(rep.send).toHaveBeenCalledWith({ authUrl: expect.any(String) });
        });
    });

    describe('disconnectStoreHandler', () => {

        it('should return 404 when no store', async () => {
            mockGetStoreByWorkspace.mockResolvedValue(null);
            const rep = mockReply();

            await disconnectStoreHandler(mockRequest(), rep);

            expect(rep.status).toHaveBeenCalledWith(404);
        });

        it('should disconnect store', async () => {
            mockGetStoreByWorkspace.mockResolvedValue({ id: 'store-1' });
            const rep = mockReply();

            await disconnectStoreHandler(mockRequest(), rep);

            expect(mockDisconnectStore).toHaveBeenCalledWith('store-1');
            expect(rep.send).toHaveBeenCalledWith({ ok: true });
        });
    });

    describe('syncStore', () => {
        it('should return 404 when no store', async () => {
            mockGetStoreByWorkspace.mockResolvedValue(null);
            const rep = mockReply();

            await syncStore(mockRequest(), rep);

            expect(rep.status).toHaveBeenCalledWith(404);
        });

        it('should sync and return result', async () => {
            mockGetStoreByWorkspace.mockResolvedValue({ id: 'store-1' });
            const rep = mockReply();

            await syncStore(mockRequest(), rep);

            expect(mockFullSync).toHaveBeenCalledWith('store-1');
            expect(rep.send).toHaveBeenCalledWith({ synced: 15 });
        });
    });

    describe('getStoreProducts', () => {
        it('should return 404 when no store', async () => {
            mockGetStoreByWorkspace.mockResolvedValue(null);
            const rep = mockReply();

            await getStoreProducts(mockRequest(), rep);

            expect(rep.status).toHaveBeenCalledWith(404);
        });

        it('should return products', async () => {
            mockGetStoreByWorkspace.mockResolvedValue({ id: 'store-1' });
            mockGetProducts.mockResolvedValue([{ id: 'p1', title: 'Zid Product 1' }]);
            const rep = mockReply();

            await getStoreProducts(mockRequest(), rep);

            expect(rep.send).toHaveBeenCalledWith({
                products: [{ id: 'p1', title: 'Zid Product 1' }],
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

        it('should return 404 when no store', async () => {
            mockGetStoreByWorkspace.mockResolvedValue(null);
            const req = mockRequest({ body: { pageId: 'page-1' } });
            const rep = mockReply();

            await linkPage(req, rep);

            expect(rep.status).toHaveBeenCalledWith(404);
        });

        it('should return 403 when page does not belong to workspace', async () => {
            mockGetStoreByWorkspace.mockResolvedValue({ id: 'store-1' });
            mockLinkStoreToPage.mockRejectedValueOnce(new Error('Page not found or does not belong to workspace'));
            const req = mockRequest({ body: { pageId: 'page-1' } });
            const rep = mockReply();

            await linkPage(req, rep);

            expect(rep.status).toHaveBeenCalledWith(403);
        });

        it('should link page successfully', async () => {
            mockGetStoreByWorkspace.mockResolvedValue({ id: 'store-1' });
            mockLinkStoreToPage.mockResolvedValueOnce(undefined);
            const req = mockRequest({ body: { pageId: 'page-1' } });
            const rep = mockReply();

            await linkPage(req, rep);

            expect(mockLinkStoreToPage).toHaveBeenCalledWith('store-1', 'page-1', 'test_workspace_id');
            expect(rep.send).toHaveBeenCalledWith({ ok: true });
        });
    });
});
