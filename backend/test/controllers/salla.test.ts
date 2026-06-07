import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocked salla service functions ---
const mockBuildAuthUrl = vi.fn().mockReturnValue('https://accounts.salla.sa/oauth2/auth?...');
const mockExchangeCodeForToken = vi.fn().mockResolvedValue({
    accessToken: 'salla_access_token',
    refreshToken: 'salla_refresh_token',
    expiresIn: 1209600,
});
const mockVerifyWebhookHmac = vi.fn();
const mockRegisterWebhooks = vi.fn().mockResolvedValue(undefined);
const mockFetchStoreInfo = vi.fn().mockResolvedValue({
    storeName: 'My Salla Store',
    storeEmail: 'store@salla.com',
    storeCurrency: 'SAR',
    storeDomain: 'my-salla-store.salla.sa',
    merchantId: '12345',
});
const mockFullSync = vi.fn().mockResolvedValue({ synced: 10 });
const mockIsProductEvent = vi.fn((event: string) => event.startsWith('product.'));

vi.mock('../../src/services/salla', () => ({
    buildAuthUrl: (...args: any[]) => mockBuildAuthUrl(...args),
    exchangeCodeForToken: (...args: any[]) => mockExchangeCodeForToken(...args),
    verifyWebhookHmac: (...args: any[]) => mockVerifyWebhookHmac(...args),
    registerWebhooks: (...args: any[]) => mockRegisterWebhooks(...args),
    fetchStoreInfo: (...args: any[]) => mockFetchStoreInfo(...args),
    fullSync: (...args: any[]) => mockFullSync(...args),
    isProductEvent: (...args: any[]) => mockIsProductEvent(...args),
    // Faithful to the real impl so the order-notification dispatch branch is reachable in tests.
    isOrderEvent: (event: string) => event.startsWith('order.') || event === 'abandoned.cart',
}));

vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { schedule: vi.fn().mockResolvedValue(undefined) },
}));

// --- Mocked shared ecommerce service ---
const mockGetStoreByDomain = vi.fn();
const mockGetStoreByWorkspace = vi.fn();
const mockGetStoreByWorkspaceAny = vi.fn();
const mockCreateStore = vi.fn().mockResolvedValue({ id: 'store-1', storeDomain: 'my-salla-store.salla.sa' });
const mockDisconnectStore = vi.fn().mockResolvedValue(undefined);
const mockDeactivateStore = vi.fn().mockResolvedValue(undefined);
const mockLinkStoreToPage = vi.fn().mockResolvedValue(undefined);
const mockGetProducts = vi.fn().mockResolvedValue([]);
const mockMapToEcommerceStore = vi.fn((store) => ({ id: store.id, storeDomain: store.storeDomain }));
const mockCreatePendingInstall = vi.fn().mockResolvedValue('pending-salla-123');

vi.mock('../../src/services/ecommerce', () => ({
    getStoreByDomain: (...args: any[]) => mockGetStoreByDomain(...args),
    getStoreByWorkspace: (...args: any[]) => mockGetStoreByWorkspace(...args),
    getStoreByWorkspaceAny: (...args: any[]) => mockGetStoreByWorkspaceAny(...args),
    createStore: (...args: any[]) => mockCreateStore(...args),
    disconnectStore: (...args: any[]) => mockDisconnectStore(...args),
    deactivateStore: (...args: any[]) => mockDeactivateStore(...args),
    linkStoreToPage: (...args: any[]) => mockLinkStoreToPage(...args),
    getProducts: (...args: any[]) => mockGetProducts(...args),
    mapToEcommerceStore: (...args: any[]) => mockMapToEcommerceStore(...args),
    createPendingInstall: (...args: any[]) => mockCreatePendingInstall(...args),
    // Pass-through wrapper — calls registerFn so existing mockRegisterWebhooks
    // assertions still apply. Real helper also persists status + enqueues
    // retries; tested separately in webhookHardening tests.
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

const mockDispatchOrderNotification = vi.fn();
vi.mock('../../src/services/orderNotificationScheduler', () => ({
    dispatchOrderNotification: (...args: any[]) => mockDispatchOrderNotification(...args),
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        salla: {
            clientId: 'test_salla_client',
            clientSecret: 'test_salla_secret',
            hostName: 'jawab24.com',
            webhookSecret: 'test_salla_webhook_secret',
            scopes: 'offline_access products.read_write settings.read',
        },
    },
}));

vi.mock('../../src/services/cookies', () => ({
    PENDING_SALLA_COOKIE_OPTIONS: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        signed: true,
        maxAge: 1800,
    },
    SALLA_NONCE_COOKIE_OPTIONS: {
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
} from '../../src/controllers/salla';

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

describe('Salla Controller', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- authRedirect ---

    describe('authRedirect', () => {
        it('should set signed nonce cookie and redirect to Salla OAuth', async () => {
            const req = mockRequest();
            const rep = mockReply();

            await authRedirect(req, rep);

            expect(rep.setCookie).toHaveBeenCalledWith(
                'sallaNonce',
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

        it('should not require a shop domain (unlike Shopify)', async () => {
            const req = mockRequest({ query: {} }); // no shop param
            const rep = mockReply();

            await authRedirect(req, rep);

            // Should still redirect — Salla authenticates the merchant directly
            expect(rep.redirect).toHaveBeenCalled();
        });
    });

    // --- authCallback ---

    describe('authCallback', () => {
        it('should reject when nonce does not match state', async () => {
            const req = mockRequest({
                query: { code: 'code123', state: 'nonce_from_url' },
                cookies: { sallaNonce: 'signed_cookie_value' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'different_nonce' }),
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
            expect(rep.send).toHaveBeenCalledWith({ error: 'Invalid OAuth callback: state mismatch' });
        });

        it('should treat a missing nonce cookie as a platform-initiated (Salla-first) install and proceed', async () => {
            // Salla App Store / Partners "Install App" redirects straight to the callback
            // with its own state and NO prior nonce from us. The CSRF state check must not
            // reject this — the server-to-server code exchange is the trust anchor.
            const req = mockRequest({
                query: { code: 'code123', state: 'salla_state_abc' },
                cookies: {},
            });
            const rep = mockReply();

            await authCallback(req, rep);

            // Proceeds past the state check into the OAuth code exchange...
            expect(mockExchangeCodeForToken).toHaveBeenCalledWith('code123');
            // ...and (not logged in) lands in the pending-install / claim path — not a 400.
            expect(mockCreatePendingInstall).toHaveBeenCalled();
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?salla_pending=true');
            expect(rep.status).not.toHaveBeenCalledWith(400);
        });

        it('should reject when signed cookie is invalid', async () => {
            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { sallaNonce: 'tampered_cookie' },
                unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('should reject when code is missing', async () => {
            const req = mockRequest({
                query: { state: 'nonce123' },
                cookies: { sallaNonce: 'signed_cookie' },
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
                cookies: { sallaNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockExchangeCodeForToken).toHaveBeenCalledWith('code123');
            expect(mockFetchStoreInfo).toHaveBeenCalledWith('salla_access_token');
            expect(mockGetUserWorkspaces).toHaveBeenCalledWith('user-123');
            expect(mockCreateStore).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'user-123',
                platform: 'salla',
                storeDomain: 'my-salla-store.salla.sa',
                accessToken: 'salla_access_token',
                refreshToken: 'salla_refresh_token',
                workspaceId: 'test_workspace_id',
            }));
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/salla/onboarding');
        });

        it('should store tokenExpiresAt when creating store', async () => {
            const unsignCookie = vi.fn()
                .mockImplementation((cookie: string) => {
                    if (cookie === 'signed_nonce') return { valid: true, value: 'nonce123' };
                    if (cookie === 'signed_jwt') return { valid: true, value: 'jwt_token' };
                    return { valid: false, value: null };
                });

            mockVerifyToken.mockReturnValue({ userId: 'user-123' });

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { sallaNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockCreateStore).toHaveBeenCalledWith(expect.objectContaining({
                tokenExpiresAt: expect.any(Date),
            }));
            // expiresIn(1209600s)→ms must be ~14 days out, not ~20 min (dropped *1000).
            const storeArg = mockCreateStore.mock.calls[0][0];
            const msUntilExpiry = storeArg.tokenExpiresAt.getTime() - Date.now();
            expect(msUntilExpiry).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
            expect(msUntilExpiry).toBeLessThan(15 * 24 * 60 * 60 * 1000);
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
                cookies: { sallaNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockCreatePendingInstall).toHaveBeenCalledWith('salla', expect.objectContaining({
                storeDomain: 'my-salla-store.salla.sa',
                accessToken: 'salla_access_token',
                refreshToken: 'salla_refresh_token',
                tokenExpiresAt: expect.any(Date),
                nonce: 'nonce123',
            }));
            // Guard the expiresIn(seconds)→ms conversion: 1209600s must land ~14 days
            // out. Catches a dropped *1000 (≈20 min) or unit/sign regression that would
            // re-break refresh on app-store (logged-out) installs — the bug this PR fixes.
            const pendingArg = mockCreatePendingInstall.mock.calls[0][1];
            const msUntilExpiry = pendingArg.tokenExpiresAt.getTime() - Date.now();
            expect(msUntilExpiry).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
            expect(msUntilExpiry).toBeLessThan(15 * 24 * 60 * 60 * 1000);
            expect(rep.setCookie).toHaveBeenCalledWith(
                'pendingSallaId',
                'pending-salla-123',
                expect.objectContaining({ signed: true, sameSite: 'lax' })
            );
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?salla_pending=true');
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
                cookies: { sallaNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?salla_error=already_connected');
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
        });

        it('should redirect with error on token exchange failure', async () => {
            mockExchangeCodeForToken.mockRejectedValueOnce(new Error('Token exchange failed'));
            const unsignCookie = vi.fn()
                .mockReturnValue({ valid: true, value: 'nonce123' });

            const req = mockRequest({
                query: { code: 'badcode', state: 'nonce123' },
                cookies: { sallaNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?salla_error=auth_failed');
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
                cookies: { sallaNonce: 'signed_nonce' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(rep.clearCookie).toHaveBeenCalledWith('sallaNonce', { path: '/' });
        });

        it('should detect logged-in user via Bearer header', async () => {
            const unsignCookie = vi.fn()
                .mockReturnValue({ valid: true, value: 'nonce123' });

            mockVerifyToken.mockReturnValue({ userId: 'user-456' });

            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { sallaNonce: 'signed_nonce' },
                headers: { authorization: 'Bearer jwt_token_from_header' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockVerifyToken).toHaveBeenCalledWith('jwt_token_from_header');
            expect(mockGetUserWorkspaces).toHaveBeenCalledWith('user-456');
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/salla/onboarding');
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
                cookies: { sallaNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'salla');
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
                cookies: { sallaNonce: 'signed_nonce', token: 'signed_jwt' },
                unsignCookie,
            });
            const rep = mockReply();

            await authCallback(req, rep);

            await new Promise(r => setTimeout(r, 10));

            expect(mockRegisterWebhooks).toHaveBeenCalledWith('salla_access_token');
        });
    });

    // --- Webhook (single endpoint, dispatches by event type) ---

    describe('webhookHandler', () => {
        it('should reject missing rawBody', async () => {
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body: { event: 'product.created', merchant: 12345 },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should reject invalid HMAC', async () => {
            mockVerifyWebhookHmac.mockReturnValue(false);
            const body = { event: 'product.created', merchant: 12345 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'invalid' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('should enqueue sync on product.created event', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = { event: 'product.created', merchant: 12345 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'salla');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should enqueue sync on product.price.updated event', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = { event: 'product.price.updated', merchant: 12345 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'salla');
        });

        it('should deactivate store on app.uninstalled event', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'app.uninstalled', merchant: 12345 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDeactivateStore).toHaveBeenCalledWith('salla', '12345');
            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should return 200 even when store not found for product event', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue(null);
            const body = { event: 'product.deleted', merchant: 99999 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should return 200 when merchant is missing', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'product.created' };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(mockDeactivateStore).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should use X-Salla-Signature header (not Shopify header)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'product.created', merchant: 12345 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'hex_hmac_value' },
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

        it('should ignore unknown events gracefully', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'order.created', merchant: 12345 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(mockDeactivateStore).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        // --- Phase 4.2 regression: REAL Salla payload shapes captured from a live dev
        // store (2026-06-07). order.created/updated are flat with split mobile+mobile_code;
        // order.status.updated nests the order under data.order with the slug at
        // data.customized.slug. See SALLA_LAUNCH_VALIDATION.md §S4. ---
        it('should dispatch order_confirmed on order.created with reference_id + composed phone', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {
                event: 'order.created', merchant: 2108580704,
                data: {
                    id: 815530083, reference_id: 264810440,
                    status: { slug: 'payment_pending' },
                    customer: { first_name: 'abc', mobile: 555555555, mobile_code: '+971' },
                    amounts: { sub_total: { amount: 268, currency: 'SAR' } }, currency: 'SAR',
                },
            };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            await webhookHandler(req, mockReply());

            expect(mockDispatchOrderNotification).toHaveBeenCalledTimes(1);
            expect(mockDispatchOrderNotification.mock.calls[0][0]).toMatchObject({
                platform: 'salla', storeId: 'store-1', type: 'order_confirmed',
                customerPhone: '+971555555555', customerName: 'abc', orderNumber: '264810440', orderId: '815530083',
            });
        });

        it('should dispatch order_delivered on order.status.updated (order nested under data.order, slug at data.customized.slug)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {
                event: 'order.status.updated', merchant: 2108580704,
                data: {
                    id: 3104087823890992600,           // activity id — NOT the order id
                    status: 'تم التوصيل',               // localized string, not an object
                    customized: { slug: 'delivered', name: 'تم التوصيل' },
                    order: { id: 964176593, reference_id: 264808310, customer: { name: 'abc def', mobile: '+971555555555' } },
                },
            };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            await webhookHandler(req, mockReply());

            expect(mockDispatchOrderNotification).toHaveBeenCalledTimes(1);
            expect(mockDispatchOrderNotification.mock.calls[0][0]).toMatchObject({
                platform: 'salla', storeId: 'store-1', type: 'order_delivered',
                customerPhone: '+971555555555', customerName: 'abc def', orderId: '964176593', orderNumber: '264808310',
            });
        });

        it('should dispatch order_shipped on order.status.updated with slug "shipped"', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {
                event: 'order.status.updated', merchant: 2108580704,
                data: {
                    status: 'تم الشحن', customized: { slug: 'shipped' },
                    order: { id: 964176593, reference_id: 264808310, customer: { name: 'abc def', mobile: '+971555555555' } },
                },
            };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            await webhookHandler(req, mockReply());

            expect(mockDispatchOrderNotification.mock.calls[0][0]).toMatchObject({ type: 'order_shipped', orderNumber: '264808310' });
        });

        it('should NOT dispatch on order.updated (avoids double-send with order.status.updated)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {
                event: 'order.updated', merchant: 2108580704,
                data: { id: 964176593, reference_id: 264808310, status: { slug: 'delivered' }, customer: { first_name: 'abc', mobile: 555555555, mobile_code: '+971' } },
            };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();
            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should NOT dispatch for the phantom "order.completed" event', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = { event: 'order.completed', merchant: 12345, data: { id: 1, customer: { mobile: '+966555' } } };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();
            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).not.toHaveBeenCalled();
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

            expect(mockGetStoreByWorkspaceAny).toHaveBeenCalledWith('salla', 'test_workspace_id');
            expect(rep.status).not.toHaveBeenCalled();
            expect(rep.send).toHaveBeenCalledWith(null);
        });

        it('should return store data', async () => {
            mockGetStoreByWorkspaceAny.mockResolvedValue({ id: 'store-1', storeDomain: 'my-salla-store.salla.sa' });
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
                'sallaNonce',
                expect.any(String),
                expect.objectContaining({ signed: true })
            );
            expect(rep.send).toHaveBeenCalledWith({ authUrl: expect.any(String) });
        });

        it('should not require a shop domain in request body', async () => {
            const req = mockRequest({ body: {} }); // no shopDomain
            const rep = mockReply();

            await connectStore(req, rep);

            // Should still return auth URL — Salla doesn't need shop domain
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
            expect(rep.send).toHaveBeenCalledWith({ synced: 10 });
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
