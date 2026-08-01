import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocked zid service functions ---
// The pure predicates (isProductEvent/isOrderEvent/normalizeZidPhone/mapZidOrderStatus)
// stay REAL via importOriginal — tests must exercise production predicates, not copies.
// Only the effectful exports are mocked.
const mockBuildAuthUrl = vi.fn().mockReturnValue('https://oauth.zid.sa/oauth/authorize?...');
const mockExchangeCodeForToken = vi.fn();
const mockVerifyWebhookBasicAuth = vi.fn();
const mockRegisterWebhooks = vi.fn().mockResolvedValue({ registered: [], failed: [], lastAttempt: '' });
const mockFetchStoreInfo = vi.fn();
const mockFullSync = vi.fn().mockResolvedValue({ synced: 15 });

vi.mock('../../src/services/zid', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/zid')>();
    return {
        ...actual,
        buildAuthUrl: (...args: unknown[]) => mockBuildAuthUrl(...args),
        exchangeCodeForToken: (...args: unknown[]) => mockExchangeCodeForToken(...args),
        verifyWebhookBasicAuth: (...args: unknown[]) => mockVerifyWebhookBasicAuth(...args),
        registerWebhooks: (...args: unknown[]) => mockRegisterWebhooks(...args),
        fetchStoreInfo: (...args: unknown[]) => mockFetchStoreInfo(...args),
        fullSync: (...args: unknown[]) => mockFullSync(...args),
    };
});

// Real services/zid transitively imports the shared token refresher — stub its
// heavy deps so importOriginal works without a DB/Redis.
vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/lib/redis', () => ({ redis: { set: vi.fn(), del: vi.fn() } }));

// --- Mocked shared ecommerce service ---
const mockGetStoreById = vi.fn();
const mockResolveStoreByDomainOrMerchant = vi.fn();
const mockGetStoreByDomain = vi.fn();
const mockGetStoreByWorkspace = vi.fn();
const mockGetStoreByWorkspaceAny = vi.fn();
const mockCreateStore = vi.fn().mockResolvedValue({ id: 'store-1', storeDomain: 'my-zid-store.zid.store' });
const mockDisconnectStore = vi.fn().mockResolvedValue(undefined);
const mockDeactivateStore = vi.fn().mockResolvedValue(undefined);
const mockLinkStoreToPage = vi.fn().mockResolvedValue(undefined);
const mockGetProducts = vi.fn().mockResolvedValue([]);
const mockMapToEcommerceStore = vi.fn((store) => ({ id: store.id, storeDomain: store.storeDomain }));
const mockCreatePendingInstall = vi.fn().mockResolvedValue('pending-zid-123');
const mockRegisterWebhooksWithPersist = vi.fn(
    (_storeId: string, _platform: string, fn: () => Promise<unknown>) => fn(),
);

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    resolveStoreByDomainOrMerchant: (...args: unknown[]) => mockResolveStoreByDomainOrMerchant(...args),
    getStoreByDomain: (...args: unknown[]) => mockGetStoreByDomain(...args),
    getStoreByWorkspace: (...args: unknown[]) => mockGetStoreByWorkspace(...args),
    getStoreByWorkspaceAny: (...args: unknown[]) => mockGetStoreByWorkspaceAny(...args),
    createStore: (...args: unknown[]) => mockCreateStore(...args),
    disconnectStore: (...args: unknown[]) => mockDisconnectStore(...args),
    deactivateStore: (...args: unknown[]) => mockDeactivateStore(...args),
    linkStoreToPage: (...args: unknown[]) => mockLinkStoreToPage(...args),
    unlinkStoreFromPage: vi.fn(),
    getProducts: (...args: unknown[]) => mockGetProducts(...args),
    mapToEcommerceStore: (...args: unknown[]) => mockMapToEcommerceStore(...args),
    createPendingInstall: (...args: unknown[]) => mockCreatePendingInstall(...args),
    registerWebhooksWithPersist: (...args: unknown[]) => mockRegisterWebhooksWithPersist(...args as [string, string, () => Promise<unknown>]),
    // Imported by the REAL services/zid module (kept real via importOriginal).
    updateStoreTokens: vi.fn(),
    markStoreNeedsReauth: vi.fn(),
    replaceProductsAndRebuildSummary: vi.fn(),
    applySyncedStoreInfo: vi.fn(),
    PRODUCT_SAFETY_CAP: 5000,
}));

const mockVerifyToken = vi.fn();
vi.mock('../../src/services/auth', () => ({
    authService: {
        verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
    },
}));

const mockGetUserWorkspaces = vi.fn().mockResolvedValue([{ id: 'test_workspace_id' }]);
vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: (...args: unknown[]) => mockGetUserWorkspaces(...args),
    },
}));

// Real event factories, mocked dispatch — assertions inspect the REAL OrderEvent shape.
const mockDispatchOrderNotification = vi.fn();
vi.mock('../../src/services/orderNotificationScheduler', async (importActual) => ({
    ...(await importActual<typeof import('../../src/services/orderNotificationScheduler')>()),
    dispatchOrderNotification: (...args: unknown[]) => mockDispatchOrderNotification(...args),
}));

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        zid: {
            clientId: 'test_zid_client',
            clientSecret: 'test_zid_secret',
            appId: 'zid-app-777',
            hostName: 'jawab24.com',
            webhookSecret: 'test_zid_webhook_secret',
            scopes: 'offline_access products.read orders.read webhooks.manage',
        },
        // Read by the shared token refresher's selector (imported via services/zid).
        salla: { skipPullRefreshForEasyMode: false },
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
    enqueueSyncJob: (...args: unknown[]) => mockEnqueueSyncJob(...args),
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

const VALID_TOKENS = {
    accessToken: 'zid_access_token',
    refreshToken: 'zid_refresh_token',
    authorizationToken: 'zid_auth_token',
    expiresIn: 31536000,
};

const STORE_INFO = {
    storeName: 'My Zid Store',
    storeEmail: 'store@zid.sa',
    storeCurrency: 'SAR',
    storeDomain: 'my-zid-store.zid.store',
    merchantId: '67890',
};

// Request/reply doubles (tests are not type-checked — tsconfig includes src/
// only). The handlers only touch the fields staged here.
function mockRequest(overrides: Record<string, unknown> = {}) {
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

/** A webhook delivery request: Basic-auth header + event/store routing in query/body. */
function webhookRequest(overrides: Record<string, unknown> = {}) {
    return mockRequest({
        headers: { authorization: 'Basic and-the-mock-decides' },
        ...overrides,
    });
}

function mockReply() {
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
        mockExchangeCodeForToken.mockResolvedValue({ ...VALID_TOKENS });
        mockFetchStoreInfo.mockResolvedValue({ ...STORE_INFO });
        mockCreateStore.mockResolvedValue({ id: 'store-1', storeDomain: 'my-zid-store.zid.store' });
        mockCreatePendingInstall.mockResolvedValue('pending-zid-123');
        mockVerifyWebhookBasicAuth.mockReturnValue(true);
        mockGetStoreById.mockResolvedValue(null);
        mockResolveStoreByDomainOrMerchant.mockResolvedValue(null);
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

        it('should create store with BOTH Zid credentials when user is logged in (JWT cookie)', async () => {
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
            // The adapter converts the token response into the dual-header credential pair.
            expect(mockFetchStoreInfo).toHaveBeenCalledWith({
                managerToken: 'zid_access_token',
                authorizationToken: 'zid_auth_token',
            });
            expect(mockGetUserWorkspaces).toHaveBeenCalledWith('user-123');
            expect(mockCreateStore).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'user-123',
                platform: 'zid',
                storeDomain: 'my-zid-store.zid.store',
                accessToken: 'zid_access_token',
                refreshToken: 'zid_refresh_token',
                authorizationToken: 'zid_auth_token',
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

        it('should register webhooks with the credential pair AND the new store id', async () => {
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

            // Registration goes through the persist-on-throw wrapper...
            expect(mockRegisterWebhooksWithPersist).toHaveBeenCalledWith('store-1', 'zid', expect.any(Function));
            // ...and the adapter passes creds + storeId (embedded in each target_url).
            expect(mockRegisterWebhooks).toHaveBeenCalledWith(
                { managerToken: 'zid_access_token', authorizationToken: 'zid_auth_token' },
                'store-1',
            );
        });

        it('should fail the callback (auth_failed redirect) when the token response lacks the Authorization credential', async () => {
            // credsFromTokens throws — a token response without the second credential
            // must never produce a store that would 401 on every API call.
            mockExchangeCodeForToken.mockResolvedValueOnce({
                accessToken: 'zid_access_token',
                refreshToken: 'zid_refresh_token',
                expiresIn: 31536000,
            });
            const req = mockRequest({
                query: { code: 'code123', state: 'nonce123' },
                cookies: { zidNonce: 'signed_nonce' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'nonce123' }),
            });
            const rep = mockReply();

            await authCallback(req, rep);

            expect(mockCreateStore).not.toHaveBeenCalled();
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
            expect(rep.redirect).toHaveBeenCalledWith('https://jawab24.com/login?zid_error=auth_failed');
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

        it('should create pending install carrying the Authorization token when user is NOT logged in', async () => {
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
                authorizationToken: 'zid_auth_token',
                tokenExpiresAt: expect.any(Date),
                nonce: 'nonce123',
            }));
            // Guard the expiresIn(seconds)→ms conversion: 31536000s must land ~365 days out.
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
    });

    // --- Webhook: Basic-auth verification (Zid sends NO HMAC signature) ---

    describe('webhookHandler — Basic auth', () => {
        it('accepts a delivery when the Basic credentials verify, passing the raw header', async () => {
            const req = webhookRequest({
                headers: { authorization: 'Basic dGVzdDp0ZXN0' },
                body: { event: 'customer.create' },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockVerifyWebhookBasicAuth).toHaveBeenCalledWith('Basic dGVzdDp0ZXN0');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('rejects with 401 when the Authorization header is missing', async () => {
            mockVerifyWebhookBasicAuth.mockReturnValue(false);
            const req = mockRequest({ headers: {}, body: { event: 'product.create' } });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockVerifyWebhookBasicAuth).toHaveBeenCalledWith(undefined);
            expect(rep.status).toHaveBeenCalledWith(401);
            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
        });

        it('rejects with 401 when the credentials are wrong', async () => {
            mockVerifyWebhookBasicAuth.mockReturnValue(false);
            const req = webhookRequest({ body: { event: 'product.create', store_id: '67890' } });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(rep.status).toHaveBeenCalledWith(401);
            expect(rep.send).toHaveBeenCalledWith({ error: 'Invalid webhook credentials' });
            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(mockDeactivateStore).not.toHaveBeenCalled();
        });
    });

    // --- Webhook: store + event routing from the target_url query string ---

    describe('webhookHandler — query-string routing', () => {
        it('resolves the store via ?sid= (getStoreById) when it is an active Zid store', async () => {
            mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'zid', isActive: true });
            const req = webhookRequest({
                query: { e: 'product.create', sid: 'store-1' },
                body: {},
            });
            const rep = mockReply();

            await webhookHandler(req, rep);
            await new Promise(r => setTimeout(r, 10));

            expect(mockGetStoreById).toHaveBeenCalledWith('store-1');
            expect(mockResolveStoreByDomainOrMerchant).not.toHaveBeenCalled();
            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'zid', 'product_update');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('prefers the ?e= event over a body event', async () => {
            mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'zid', isActive: true });
            const req = webhookRequest({
                query: { e: 'product.update', sid: 'store-1' },
                body: { event: 'order.create' },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);
            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'zid', 'product_update');
            expect(mockDispatchOrderNotification).not.toHaveBeenCalled();
        });

        it('ignores a sid pointing at a non-Zid store and falls back to the body store id', async () => {
            mockGetStoreById.mockResolvedValue({ id: 'salla-store', platform: 'salla', isActive: true });
            mockResolveStoreByDomainOrMerchant.mockResolvedValue({ id: 'store-2', platform: 'zid', isActive: true });
            const req = webhookRequest({
                query: { e: 'product.create', sid: 'salla-store' },
                body: { store_id: 98765 },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);
            await new Promise(r => setTimeout(r, 10));

            expect(mockResolveStoreByDomainOrMerchant).toHaveBeenCalledWith('zid', '98765');
            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-2', 'zid', 'product_update');
        });

        it('ignores a sid pointing at an inactive store', async () => {
            mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'zid', isActive: false });
            const req = webhookRequest({
                query: { e: 'product.create', sid: 'store-1' },
                body: {},
            });
            const rep = mockReply();

            await webhookHandler(req, rep);
            await new Promise(r => setTimeout(r, 10));

            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it.each([
            ['store_id', { store_id: 'my-zid-store.zid.store' }],
            ['store_uuid', { store_uuid: 'uuid-123' }],
            ['data.store_id', { data: { store_id: 67890 } }],
        ])('falls back to body %s via resolveStoreByDomainOrMerchant', async (_label, bodyFields) => {
            mockResolveStoreByDomainOrMerchant.mockResolvedValue({ id: 'store-3', platform: 'zid', isActive: true });
            const req = webhookRequest({
                body: { event: 'product.update', ...bodyFields },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);
            await new Promise(r => setTimeout(r, 10));

            expect(mockResolveStoreByDomainOrMerchant).toHaveBeenCalledWith('zid', expect.any(String));
            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-3', 'zid', 'product_update');
        });

        it('returns 200 without action when no store can be resolved', async () => {
            const req = webhookRequest({ body: { event: 'product.create' } });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });
    });

    // --- Webhook: app lifecycle + product events ---

    describe('webhookHandler — uninstall and product events', () => {
        it('deactivates the store on app.market.application.uninstall', async () => {
            mockResolveStoreByDomainOrMerchant.mockResolvedValue({
                id: 'store-1', platform: 'zid', isActive: true, storeDomain: 'my-zid-store.zid.store',
            });
            const req = webhookRequest({
                body: { event: 'app.market.application.uninstall', store_id: '67890' },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDeactivateStore).toHaveBeenCalledWith('zid', 'my-zid-store.zid.store');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('returns 200 on uninstall even when the store is unknown', async () => {
            const req = webhookRequest({
                body: { event: 'app.market.application.uninstall', store_id: 'nope' },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDeactivateStore).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it.each(['product.create', 'product.update', 'product.publish', 'product.delete'])(
            'enqueues a product_update sync for %s',
            async (event) => {
                mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'zid', isActive: true });
                const req = webhookRequest({ query: { e: event, sid: 'store-1' } });
                const rep = mockReply();

                await webhookHandler(req, rep);
                await new Promise(r => setTimeout(r, 10));

                // product_update, not full_sync — store info doesn't change on a product edit.
                expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'zid', 'product_update');
                expect(rep.status).toHaveBeenCalledWith(200);
            },
        );

        it('ignores a genuinely unknown event slug gracefully', async () => {
            mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'zid', isActive: true });
            const req = webhookRequest({
                query: { sid: 'store-1' },
                body: { event: 'customer.create' },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(mockDeactivateStore).not.toHaveBeenCalled();
            expect(mockDispatchOrderNotification).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });
    });

    // --- Webhook: order events → buildZidOrderEvent → dispatchOrderNotification ---

    describe('webhookHandler — order events [provisional — pending Zid live captures]', () => {
        beforeEach(() => {
            mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'zid', isActive: true });
        });

        const orderPayload = (overrides: Record<string, unknown> = {}) => ({
            id: 9001,
            code: 'ORD-100',
            customer: { name: 'Ahmed Ali', mobile: '966591555966' },
            ...overrides,
        });

        it('dispatches order_confirmed on order.create, normalizing the phone (966… → +966…)', async () => {
            const req = webhookRequest({
                query: { e: 'order.create', sid: 'store-1' },
                body: { data: orderPayload() },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    platform: 'zid',
                    storeId: 'store-1',
                    type: 'order_confirmed',
                    customerPhone: '+966591555966',
                    customerName: 'Ahmed Ali',
                    orderId: '9001',
                    orderNumber: 'ORD-100',
                }),
                req.log,
            );
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('does NOT dispatch when the order has no customer mobile', async () => {
            const req = webhookRequest({
                query: { e: 'order.create', sid: 'store-1' },
                body: { data: orderPayload({ customer: { name: 'Ahmed Ali' } }) },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('dispatches order_shipped with tracking on order.status.update → indelivery', async () => {
            const req = webhookRequest({
                query: { e: 'order.status.update', sid: 'store-1' },
                body: {
                    data: orderPayload({
                        order_status: { code: 'inDelivery' }, // camelCase per webhook conditions doc
                        tracking_number: 'TRK-1',
                    }),
                },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'order_shipped',
                    customerPhone: '+966591555966',
                    orderNumber: 'ORD-100',
                    trackingNumber: 'TRK-1',
                }),
                req.log,
            );
        });

        it('reads a nested shipping.tracking_number when the flat field is absent', async () => {
            const req = webhookRequest({
                query: { e: 'order.status.update', sid: 'store-1' },
                body: {
                    data: orderPayload({
                        order_status: { code: 'indelivery' },
                        shipping: { tracking_number: 'TRK-NESTED' },
                    }),
                },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'order_shipped', trackingNumber: 'TRK-NESTED' }),
                req.log,
            );
        });

        it('dispatches order_delivered on order.status.update → delivered (flat status string)', async () => {
            const req = webhookRequest({
                query: { e: 'order.status.update', sid: 'store-1' },
                body: { data: orderPayload({ status: 'delivered' }) },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'order_delivered', orderNumber: 'ORD-100' }),
                req.log,
            );
        });

        it.each(['new', 'preparing', 'ready', 'canceled'])(
            'sends nothing for order.status.update → %s',
            async (statusCode) => {
                const req = webhookRequest({
                    query: { e: 'order.status.update', sid: 'store-1' },
                    body: { data: orderPayload({ order_status: { code: statusCode } }) },
                });
                const rep = mockReply();

                await webhookHandler(req, rep);

                expect(mockDispatchOrderNotification).not.toHaveBeenCalled();
                expect(rep.status).toHaveBeenCalledWith(200);
            },
        );

        it('reads the order from body.order when there is no data envelope', async () => {
            const req = webhookRequest({
                query: { e: 'order.create', sid: 'store-1' },
                body: { order: orderPayload() },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'order_confirmed', orderNumber: 'ORD-100' }),
                req.log,
            );
        });

        it('reads the order from the body root as a last resort', async () => {
            const req = webhookRequest({
                query: { e: 'order.create', sid: 'store-1' },
                body: orderPayload(),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'order_confirmed', customerPhone: '+966591555966' }),
                req.log,
            );
        });

        it('falls back to the order id as orderNumber when there is no code', async () => {
            const req = webhookRequest({
                query: { e: 'order.create', sid: 'store-1' },
                body: { data: orderPayload({ code: undefined }) },
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).toHaveBeenCalledWith(
                expect.objectContaining({ orderId: '9001', orderNumber: '9001' }),
                req.log,
            );
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
