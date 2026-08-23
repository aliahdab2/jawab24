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
    // Faithful to the real composeSallaPhone — normalizeSallaPhone delegates to it.
    composeSallaPhone: (mobile?: string | number | null, mobileCode?: string | null): string | undefined => {
        if (mobile === undefined || mobile === null || mobile === '') return undefined;
        const m = String(mobile).trim();
        if (m === '') return undefined;
        if (m.startsWith('+')) return m;
        const code = mobileCode ? String(mobileCode).trim() : '';
        return code ? `${code}${m}` : m;
    },
}));

vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { schedule: vi.fn().mockResolvedValue(undefined) },
}));

// --- Mocked shared ecommerce service ---
const mockGetStoreByDomain = vi.fn();
const mockGetStoreByMerchantId = vi.fn();
const mockGetStoreByWorkspace = vi.fn();
const mockGetStoreByWorkspaceAny = vi.fn();
const mockCreateStore = vi.fn().mockResolvedValue({ id: 'store-1', storeDomain: 'my-salla-store.salla.sa' });
const mockDisconnectStore = vi.fn().mockResolvedValue(undefined);
const mockDeactivateStore = vi.fn().mockResolvedValue(undefined);
const mockLinkStoreToPage = vi.fn().mockResolvedValue(undefined);
const mockGetProducts = vi.fn().mockResolvedValue([]);
const mockMapToEcommerceStore = vi.fn((store) => ({ id: store.id, storeDomain: store.storeDomain }));
const mockCreatePendingInstall = vi.fn().mockResolvedValue('pending-salla-123');
const mockUpdateStoreTokens = vi.fn().mockResolvedValue(undefined);
const mockClaimPendingInstall = vi.fn();
const mockClaimPendingInstallByMerchantId = vi.fn();
const mockListPendingInstalls = vi.fn().mockResolvedValue([]);
const mockSaveWebhookStatus = vi.fn().mockResolvedValue(undefined);
const mockReconnectStore = vi.fn().mockResolvedValue({ relinkedPageIds: [] });

// Real-shaped error classes so the controller's instanceof mapping is exercised.
// vi.hoisted: the mock factory evaluates these at import-interception time, which runs
// before any top-level class statement in this file would.
const { MockClaimOwnershipError, MockClaimVerificationUnavailableError } = vi.hoisted(() => {
    class MockClaimOwnershipError extends Error {
        constructor() { super('Claim rejected: logged-in user does not own this store'); this.name = 'ClaimOwnershipError'; }
    }
    class MockClaimVerificationUnavailableError extends Error {
        cause?: unknown;
        constructor(cause?: unknown) { super('Claim ownership verification unavailable'); this.name = 'ClaimVerificationUnavailableError'; this.cause = cause; }
    }
    return { MockClaimOwnershipError, MockClaimVerificationUnavailableError };
});

vi.mock('../../src/services/ecommerce', () => ({
    ClaimOwnershipError: MockClaimOwnershipError,
    ClaimVerificationUnavailableError: MockClaimVerificationUnavailableError,
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
    updateStoreTokens: (...args: any[]) => mockUpdateStoreTokens(...args),
    reconnectStore: (...args: any[]) => mockReconnectStore(...args),
    claimPendingInstall: (...args: any[]) => mockClaimPendingInstall(...args),
    claimPendingInstallByMerchantId: (...args: any[]) => mockClaimPendingInstallByMerchantId(...args),
    listPendingInstalls: (...args: any[]) => mockListPendingInstalls(...args),
    saveWebhookStatus: (...args: any[]) => mockSaveWebhookStatus(...args),
    EASY_MODE_PENDING_TTL_MS: 7 * 24 * 60 * 60 * 1000,
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

// User email lookup for the claim ownership binding (db.select({email}).from(users)...limit(1)).
const mockUserRows = vi.fn().mockResolvedValue([{ email: 'owner@store.com' }]);
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: (...args: any[]) => mockUserRows(...args) }),
            }),
        })),
    },
}));

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: any[]) => mockCaptureError(...args),
}));

const mockGetUserWorkspaces = vi.fn().mockResolvedValue([{ id: 'test_workspace_id' }]);
vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: (...args: any[]) => mockGetUserWorkspaces(...args),
    },
}));

const mockDispatchOrderNotification = vi.fn();
vi.mock('../../src/services/orderNotificationScheduler', async (importActual) => ({
    ...(await importActual<typeof import('../../src/services/orderNotificationScheduler')>()),
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
            easyModeClaimEnabled: true,
            appStoreUrl: '',
            // This suite models a Custom-Mode dev app, which is the only shape where the
            // OAuth connect flow is real. Production runs Easy Mode with this OFF.
            oauthConnectEnabled: true,
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
    isConnectAvailable,
    webhookHandler,
    getStore,
    connectStore,
    disconnectStoreHandler,
    syncStore,
    getStoreProducts,
    linkPage,
    listPendingHandler,
    claimStoreHandler,
} from '../../src/controllers/salla';
import { config } from '../../src/config';

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

        it('sends the merchant back to /integrations instead of a dead Salla page when connect is unavailable', async () => {
            // GET /salla/auth is PUBLIC and the UI's "reconnect" action points at it, so
            // guarding only POST /store/connect would leave a live path to the authorize
            // URL that Easy Mode 404s.
            config.salla.oauthConnectEnabled = false;
            try {
                const rep = mockReply();
                await authRedirect(mockRequest(), rep);
                expect(rep.redirect).toHaveBeenCalledWith(
                    'https://jawab24.com/integrations?salla_error=connect_unavailable',
                );
                expect(mockBuildAuthUrl).not.toHaveBeenCalled();
                expect(rep.setCookie).not.toHaveBeenCalled(); // no nonce for a flow we refuse
            } finally {
                config.salla.oauthConnectEnabled = true;
            }
        });

        it('still redirects to Salla once the listing URL is set, without the dev opt-in', async () => {
            config.salla.oauthConnectEnabled = false;
            config.salla.appStoreUrl = 'https://apps.salla.sa/ar/app/665811310';
            try {
                const rep = mockReply();
                await authRedirect(mockRequest(), rep);
                expect(mockBuildAuthUrl).toHaveBeenCalled();
            } finally {
                config.salla.oauthConnectEnabled = true;
                config.salla.appStoreUrl = '';
            }
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

            // product_update, not full_sync — store info doesn't change on a product edit.
            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'salla', 'product_update');
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

            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-1', 'salla', 'product_update');
        });

        it('should deactivate store on app.uninstalled event (by resolved storeDomain, not merchant id)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1', storeDomain: 'my-salla-store.salla.sa' });
            const body = { event: 'app.uninstalled', merchant: 12345 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            // Must deactivate by the RESOLVED store's domain — not String(merchant),
            // which never matches the storeDomain column (S1 regression).
            expect(mockDeactivateStore).toHaveBeenCalledWith('salla', 'my-salla-store.salla.sa');
            expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        // --- S1 regression: Salla webhooks send the numeric `merchant` id, persisted in
        // platformData.merchantId — NOT the storeDomain. So getStoreByDomain(merchant)
        // misses and the merchantId fallback must catch it. Without the fallback EVERY
        // Salla webhook no-ops in prod (incl. app.uninstalled → tokens never revoked).
        // Mirrors the Zid controller's resolveStore() + its regression test. ---
        it('should resolve the store via the merchantId fallback when domain lookup misses (product event)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue(null);                  // numeric merchant ≠ storeDomain
            mockGetStoreByMerchantId.mockResolvedValue({ id: 'store-9', storeDomain: 'real-store.salla.sa' });
            const body = { event: 'product.created', merchant: 2108580704 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);
            await new Promise(r => setTimeout(r, 10));

            expect(mockGetStoreByMerchantId).toHaveBeenCalledWith('salla', '2108580704');
            expect(mockEnqueueSyncJob).toHaveBeenCalledWith('store-9', 'salla', 'product_update');
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should deactivate via the merchantId fallback on app.uninstalled when domain lookup misses', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue(null);
            mockGetStoreByMerchantId.mockResolvedValue({ id: 'store-9', storeDomain: 'real-store.salla.sa' });
            const body = { event: 'app.uninstalled', merchant: 2108580704 };
            const req = mockRequest({
                headers: { 'x-salla-signature': 'valid_hmac' },
                body,
                rawBody: Buffer.from(JSON.stringify(body)),
            });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockGetStoreByMerchantId).toHaveBeenCalledWith('salla', '2108580704');
            expect(mockDeactivateStore).toHaveBeenCalledWith('salla', 'real-store.salla.sa');
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

            // The status-update payload has no tracking → held via minDelayMs so a following
            // order.shipment.created can upgrade it with the tracking number.
            expect(mockDispatchOrderNotification.mock.calls[0][0]).toMatchObject({
                type: 'order_shipped', orderId: '964176593', orderNumber: '264808310', minDelayMs: 5 * 60 * 1000,
            });
            expect(mockDispatchOrderNotification.mock.calls[0][0].trackingNumber).toBeUndefined();
        });

        // --- order.shipment.created: `data` IS the shipment (ship_to.phone + top-level
        // tracking_number), NOT an order. Regression for the null-return bug where the
        // handler read data.customer / data.shipments[0] and dropped every shipment event. ---
        it('should dispatch order_shipped WITH tracking on order.shipment.created (shipment-shaped payload)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {
                event: 'order.shipment.created', merchant: 2108580704,
                data: {
                    id: 560695738, type: 'shipment',
                    order_id: 964176593, order_reference_id: 264808310,
                    tracking_number: '4324233', courier_name: 'Aramex',
                    ship_to: { name: 'abc def', phone: '966501806978' },
                },
            };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            await webhookHandler(req, mockReply());

            expect(mockDispatchOrderNotification).toHaveBeenCalledTimes(1);
            expect(mockDispatchOrderNotification.mock.calls[0][0]).toMatchObject({
                platform: 'salla', storeId: 'store-1', type: 'order_shipped',
                customerPhone: '966501806978', customerName: 'abc def',
                orderId: '964176593', orderNumber: '264808310',
                trackingNumber: '4324233', upgradePendingOnDuplicate: true,
            });
        });

        it('should NOT dispatch on order.shipment.created when ship_to.phone is missing', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {
                event: 'order.shipment.created', merchant: 2108580704,
                data: { id: 1, order_id: 964176593, order_reference_id: 264808310, tracking_number: '4324233', ship_to: { name: 'abc' } },
            };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();
            await webhookHandler(req, rep);

            expect(mockDispatchOrderNotification).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('should treat a "0" tracking_number as absent on order.shipment.created', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByDomain.mockResolvedValue({ id: 'store-1' });
            const body = {
                event: 'order.shipment.created', merchant: 2108580704,
                data: { id: 1, order_id: 964176593, order_reference_id: 264808310, tracking_number: '0', ship_to: { name: 'abc', phone: '966501806978' } },
            };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            await webhookHandler(req, mockReply());

            expect(mockDispatchOrderNotification.mock.calls[0][0].trackingNumber).toBeUndefined();
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

    // --- Easy Mode: app.store.authorize (token receipt) ---

    describe('webhookHandler — app.store.authorize (Easy Mode)', () => {
        const authorizeBody = (overrides: Record<string, unknown> = {}) => ({
            event: 'app.store.authorize',
            merchant: 671738424,
            data: {
                access_token: 'easy_access_token',
                refresh_token: 'easy_refresh_token',
                expires: 1893456000, // unix SECONDS
                scope: 'offline_access products.read_write',
                token_type: 'bearer',
                ...overrides,
            },
        });

        it('fresh install → stages a merchant-id-keyed pending install (no store yet)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByMerchantId.mockResolvedValue(null); // no store yet
            const body = authorizeBody();
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockFetchStoreInfo).toHaveBeenCalledWith('easy_access_token');
            expect(mockCreatePendingInstall).toHaveBeenCalledWith('salla', expect.objectContaining({
                merchantId: '671738424',
                storeDomain: 'my-salla-store.salla.sa',
                storeName: 'My Salla Store',
                accessToken: 'easy_access_token',
                refreshToken: 'easy_refresh_token',
                ttlMs: 7 * 24 * 60 * 60 * 1000,
            }));
            // expires (unix seconds) → Date
            expect(mockCreatePendingInstall.mock.calls[0][1].tokenExpiresAt).toEqual(new Date(1893456000 * 1000));
            expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('re-fire for an existing ACTIVE store → refreshes tokens in place (no new pending install)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByMerchantId.mockResolvedValue({ id: 'store-existing', isActive: true });
            const body = authorizeBody({ access_token: 'rotated_access', refresh_token: 'rotated_refresh' });
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockUpdateStoreTokens).toHaveBeenCalledWith('store-existing', expect.objectContaining({
                accessToken: 'rotated_access',
                refreshToken: 'rotated_refresh',
            }));
            expect(mockReconnectStore).not.toHaveBeenCalled();
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
            expect(mockFetchStoreInfo).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('re-fire for a DISCONNECTED store → repairs it in place (Reauthorize App), no pending install', async () => {
            // The 2026-08-23 incident branch: the merchant disconnected (tokens
            // blanked, pages unlinked), then clicked "Reauthorize App". The
            // lookup must SEE the inactive store (includeInactive) and repair it
            // via reconnectStore — before the fix this fell through to a pending
            // install nobody would ever claim, so the reauthorize returned 200
            // and silently fixed nothing.
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByMerchantId.mockResolvedValue({ id: 'store-disconnected', isActive: false });
            const body = authorizeBody({ access_token: 'redelivered_access', refresh_token: 'redelivered_refresh' });
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();

            await webhookHandler(req, rep);

            // The lookup must opt in to inactive stores — without this flag the
            // disconnected store is invisible and the repair can never trigger.
            expect(mockGetStoreByMerchantId).toHaveBeenCalledWith('salla', '671738424', { includeInactive: true });
            expect(mockReconnectStore).toHaveBeenCalledWith(
                'store-disconnected',
                'salla',
                expect.objectContaining({
                    accessToken: 'redelivered_access',
                    refreshToken: 'redelivered_refresh',
                    tokenExpiresAt: new Date(1893456000 * 1000),
                }),
                expect.any(Function),
            );
            expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
            expect(mockFetchStoreInfo).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('a Salla-API failure during handling → captured + 200 (Salla retries; never 500s)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            mockGetStoreByMerchantId.mockResolvedValue(null);
            mockFetchStoreInfo.mockRejectedValueOnce(new Error('Salla API 503'));
            const body = authorizeBody();
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockCaptureError).toHaveBeenCalledTimes(1);
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('missing access_token → no-op 200 (never throws on a malformed payload)', async () => {
            mockVerifyWebhookHmac.mockReturnValue(true);
            const body = { event: 'app.store.authorize', merchant: 671738424, data: { expires: 1893456000 } };
            const req = mockRequest({ headers: { 'x-salla-signature': 'valid_hmac' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
            expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(200);
        });

        it('rejects an invalid HMAC before any token handling', async () => {
            mockVerifyWebhookHmac.mockReturnValue(false);
            const body = authorizeBody();
            const req = mockRequest({ headers: { 'x-salla-signature': 'bad' }, body, rawBody: Buffer.from(JSON.stringify(body)) });
            const rep = mockReply();

            await webhookHandler(req, rep);

            expect(mockGetStoreByMerchantId).not.toHaveBeenCalled();
            expect(mockCreatePendingInstall).not.toHaveBeenCalled();
            expect(rep.status).toHaveBeenCalledWith(401);
        });
    });

    // --- Easy Mode: post-install claim handlers ---

    describe('listPendingHandler', () => {
        const authedReq = (overrides: Record<string, unknown> = {}) => mockRequest({
            headers: { authorization: 'Bearer tok' }, ...overrides,
        });

        beforeEach(() => mockVerifyToken.mockReturnValue({ userId: 'user-123' }));

        it('requires merchantId — never returns an unscoped list of all merchants', async () => {
            const req = authedReq({ query: {} });
            const rep = mockReply();
            await listPendingHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(400);
            expect(mockListPendingInstalls).not.toHaveBeenCalled();
        });

        it('returns the scoped pending summary for a merchant', async () => {
            mockListPendingInstalls.mockResolvedValue([{ id: 'p1', storeDomain: 'd', storeName: 'Shop', merchantId: '671738424', createdAt: new Date() }]);
            const req = authedReq({ query: { merchantId: '671738424' } });
            const rep = mockReply();
            await listPendingHandler(req, rep);
            expect(mockListPendingInstalls).toHaveBeenCalledWith('salla', '671738424');
            expect(rep.send).toHaveBeenCalledWith({ pending: expect.any(Array) });
        });

        it('401 when unauthenticated', async () => {
            mockVerifyToken.mockReturnValue(null);
            const req = mockRequest({ headers: { authorization: 'Bearer tok' }, query: { merchantId: 'x' } });
            const rep = mockReply();
            await listPendingHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('404 (dormant) when the Easy-Mode claim flag is off', async () => {
            config.salla.easyModeClaimEnabled = false;
            try {
                const req = authedReq({ query: { merchantId: '671738424' } });
                const rep = mockReply();
                await listPendingHandler(req, rep);
                expect(rep.status).toHaveBeenCalledWith(404);
                expect(mockListPendingInstalls).not.toHaveBeenCalled();
            } finally {
                config.salla.easyModeClaimEnabled = true;
            }
        });
    });

    describe('claimStoreHandler', () => {
        const authedReq = (body: Record<string, unknown>) => mockRequest({
            headers: { authorization: 'Bearer tok' }, body,
        });

        beforeEach(() => mockVerifyToken.mockReturnValue({ userId: 'user-123' }));

        it('claims by merchantId and returns the onboarding payload', async () => {
            mockClaimPendingInstallByMerchantId.mockResolvedValue({ id: 'store-new' });
            const req = authedReq({ merchantId: '671738424' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(mockClaimPendingInstallByMerchantId).toHaveBeenCalledWith('671738424', 'user-123', 'salla', expect.any(Function), expect.any(Function), expect.any(Function));
            expect(rep.send).toHaveBeenCalledWith({ sallaOnboarding: true, ecommerceStoreId: 'store-new' });
        });

        it('claims by pendingId when provided', async () => {
            mockClaimPendingInstall.mockResolvedValue({ id: 'store-pid' });
            const req = authedReq({ pendingId: 'pending-1' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(mockClaimPendingInstall).toHaveBeenCalledWith('pending-1', 'user-123', 'salla', expect.any(Function), expect.any(Function), expect.any(Function));
            expect(rep.send).toHaveBeenCalledWith({ sallaOnboarding: true, ecommerceStoreId: 'store-pid' });
        });

        // --- Ownership binding (D-012 resolved 2026-07-18: owner-email match) ---

        /** Runs a claim and returns the ownership verifier the handler passed to the service. */
        const captureVerifier = async () => {
            mockClaimPendingInstallByMerchantId.mockResolvedValue({ id: 'store-new' });
            const req = authedReq({ merchantId: '671738424' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            return mockClaimPendingInstallByMerchantId.mock.calls[0][5] as (token: string) => Promise<boolean>;
        };

        it('ownership verifier: true when the store email matches the logged-in user email', async () => {
            mockUserRows.mockResolvedValueOnce([{ email: 'owner@store.com' }]);
            mockFetchStoreInfo.mockResolvedValueOnce({ storeEmail: 'owner@store.com', storeName: 'S', storeCurrency: 'SAR', storeDomain: 'd', merchantId: '671738424' });
            const verifier = await captureVerifier();
            await expect(verifier('pushed-token')).resolves.toBe(true);
            expect(mockFetchStoreInfo).toHaveBeenCalledWith('pushed-token');
        });

        it('ownership verifier: matches case/whitespace-insensitively (never a false 403 on formatting)', async () => {
            mockUserRows.mockResolvedValueOnce([{ email: 'Owner@Store.com ' }]);
            mockFetchStoreInfo.mockResolvedValueOnce({ storeEmail: ' owner@STORE.com', storeName: 'S', storeCurrency: 'SAR', storeDomain: 'd', merchantId: '671738424' });
            const verifier = await captureVerifier();
            await expect(verifier('pushed-token')).resolves.toBe(true);
        });

        it('ownership verifier: false when the store is registered to a different email', async () => {
            mockUserRows.mockResolvedValueOnce([{ email: 'someone-else@gmail.com' }]);
            mockFetchStoreInfo.mockResolvedValueOnce({ storeEmail: 'owner@store.com', storeName: 'S', storeCurrency: 'SAR', storeDomain: 'd', merchantId: '671738424' });
            const verifier = await captureVerifier();
            await expect(verifier('pushed-token')).resolves.toBe(false);
        });

        // --- D-093: demo/development stores skip the email match. A Salla demo store's
        // registered email is a synthetic `<slug>@email.partners` nobody can sign in with,
        // and an unpublished app can ONLY be installed on demo stores — so without this
        // the live rehearsal and Salla's reviewer can never connect a store.
        const storeInfoWith = (storeType: string | null | undefined) => ({
            storeEmail: 'jkgsyu3w6pzzfrzw@email.partners', storeName: 'متجر تجريبي', storeCurrency: 'SAR',
            storeDomain: 'https://demostore.salla.sa/dev-jkgsyu3w6pzzfrzw', merchantId: '2108580704', storeType,
        });

        it.each(['demo', 'development'])('ownership verifier: true for a %s store even when the email differs (D-093)', async (storeType) => {
            mockUserRows.mockResolvedValueOnce([{ email: 'reviewer@gmail.com' }]);
            mockFetchStoreInfo.mockResolvedValueOnce(storeInfoWith(storeType));
            const verifier = await captureVerifier();
            await expect(verifier('pushed-token')).resolves.toBe(true);
        });

        it.each([
            ['live', 'live'],
            ['missing', undefined],
            ['null', null],
            ['unknown', 'staging'],
        ])('ownership verifier: a %s store type keeps the full email proof (fails closed)', async (_label, storeType) => {
            mockUserRows.mockResolvedValueOnce([{ email: 'reviewer@gmail.com' }]);
            mockFetchStoreInfo.mockResolvedValueOnce(storeInfoWith(storeType));
            const verifier = await captureVerifier();
            await expect(verifier('pushed-token')).resolves.toBe(false);
        });

        it('ownership verifier: wraps a Salla API failure as verification-unavailable (not a mismatch)', async () => {
            mockFetchStoreInfo.mockRejectedValueOnce(new Error('salla 500'));
            const verifier = await captureVerifier();
            await expect(verifier('pushed-token')).rejects.toBeInstanceOf(MockClaimVerificationUnavailableError);
        });

        it('403 no_email BEFORE any claim when the account has no email (phone-OTP accounts)', async () => {
            mockUserRows.mockResolvedValueOnce([{ email: null }]);
            const req = authedReq({ merchantId: '671738424' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(403);
            expect(rep.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'no_email' }));
            expect(mockClaimPendingInstallByMerchantId).not.toHaveBeenCalled();
            expect(mockClaimPendingInstall).not.toHaveBeenCalled();
        });

        it('403 email_mismatch on ClaimOwnershipError — without echoing the store email', async () => {
            mockClaimPendingInstallByMerchantId.mockRejectedValue(new MockClaimOwnershipError());
            const req = authedReq({ merchantId: '671738424' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(403);
            const body = rep.send.mock.calls[0][0];
            expect(body.code).toBe('email_mismatch');
            expect(JSON.stringify(body)).not.toContain('@'); // never leak the registered email
        });

        it('502 store_info_unavailable on ClaimVerificationUnavailableError (retryable, Sentry-captured)', async () => {
            mockClaimPendingInstallByMerchantId.mockRejectedValue(new MockClaimVerificationUnavailableError(new Error('salla 500')));
            const req = authedReq({ merchantId: '671738424' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(502);
            expect(rep.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'store_info_unavailable' }));
            expect(mockCaptureError).toHaveBeenCalled();
        });

        it('400 when neither pendingId nor merchantId is supplied', async () => {
            const req = authedReq({});
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(400);
        });

        it('404 when nothing is claimable', async () => {
            mockClaimPendingInstallByMerchantId.mockResolvedValue(null);
            const req = authedReq({ merchantId: '999' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(404);
        });

        it('409 when the store is already owned by another account', async () => {
            mockClaimPendingInstallByMerchantId.mockRejectedValue(new Error('This salla store is already connected to another account'));
            const req = authedReq({ merchantId: '671738424' });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(409);
        });

        it('401 when unauthenticated', async () => {
            mockVerifyToken.mockReturnValue(null);
            const req = mockRequest({ headers: { authorization: 'Bearer tok' }, body: { merchantId: 'x' } });
            const rep = mockReply();
            await claimStoreHandler(req, rep);
            expect(rep.status).toHaveBeenCalledWith(401);
        });

        it('404 (dormant) when the Easy-Mode claim flag is off — never reaches the claim logic', async () => {
            config.salla.easyModeClaimEnabled = false;
            try {
                const req = authedReq({ merchantId: '671738424' });
                const rep = mockReply();
                await claimStoreHandler(req, rep);
                expect(rep.status).toHaveBeenCalledWith(404);
                expect(mockClaimPendingInstallByMerchantId).not.toHaveBeenCalled();
            } finally {
                config.salla.easyModeClaimEnabled = true;
            }
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

    describe('isConnectAvailable', () => {
        it('is false when the app is Easy Mode with no listing and no dev opt-in', () => {
            config.salla.oauthConnectEnabled = false;
            try {
                expect(isConnectAvailable()).toBe(false);
            } finally {
                config.salla.oauthConnectEnabled = true;
            }
        });

        it('is true once the listing URL is published', () => {
            config.salla.oauthConnectEnabled = false;
            config.salla.appStoreUrl = 'https://apps.salla.sa/ar/app/665811310';
            try {
                expect(isConnectAvailable()).toBe(true);
            } finally {
                config.salla.oauthConnectEnabled = true;
                config.salla.appStoreUrl = '';
            }
        });

        it('is true for a Custom-Mode dev app that opted in', () => {
            expect(isConnectAvailable()).toBe(true); // suite config has the opt-in on
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

        it('returns the App Store listing URL (not OAuth) when Easy Mode is live and the URL is set', async () => {
            // Easy-Mode apps have no registered redirect_uri — Salla 404s the OAuth
            // authorize endpoint (2026-07-18 dry-run), so the connect action must send
            // merchants to the public listing instead.
            config.salla.appStoreUrl = 'https://apps.salla.sa/ar/app/123456';
            try {
                const req = mockRequest();
                const rep = mockReply();
                await connectStore(req, rep);
                expect(rep.send).toHaveBeenCalledWith({ authUrl: 'https://apps.salla.sa/ar/app/123456', easyMode: true });
                expect(rep.setCookie).not.toHaveBeenCalled(); // no OAuth nonce for a listing redirect
            } finally {
                config.salla.appStoreUrl = '';
            }
        });

        it('refuses with 404 SALLA_CONNECT_UNAVAILABLE when OAuth connect is not enabled', async () => {
            // Production shape: the app is Easy Mode in the Partners portal, no listing exists
            // yet, so appStoreUrl is empty. The authorize URL is dead — answering with it would
            // strand the merchant on a Salla error page, so the endpoint must refuse instead.
            config.salla.oauthConnectEnabled = false;
            try {
                const req = mockRequest();
                const rep = mockReply();
                await connectStore(req, rep);
                expect(rep.status).toHaveBeenCalledWith(404);
                expect(rep.send).toHaveBeenCalledWith({
                    error: { code: 'SALLA_CONNECT_UNAVAILABLE', message: expect.any(String) },
                });
                expect(rep.setCookie).not.toHaveBeenCalled(); // no OAuth nonce minted
            } finally {
                config.salla.oauthConnectEnabled = true;
            }
        });

        it('still returns the listing URL when it is set, even with OAuth connect disabled', async () => {
            // Once published, appStoreUrl wins and the OAuth opt-in stays off for good.
            config.salla.oauthConnectEnabled = false;
            config.salla.appStoreUrl = 'https://apps.salla.sa/ar/app/665811310';
            try {
                const req = mockRequest();
                const rep = mockReply();
                await connectStore(req, rep);
                expect(rep.send).toHaveBeenCalledWith({
                    authUrl: 'https://apps.salla.sa/ar/app/665811310',
                    easyMode: true,
                });
                expect(rep.status).not.toHaveBeenCalledWith(404);
            } finally {
                config.salla.oauthConnectEnabled = true;
                config.salla.appStoreUrl = '';
            }
        });

        it('keeps the OAuth flow while the listing URL is unset (pre-approval / dev Custom Mode)', async () => {
            // easyModeClaimEnabled is true in this suite's config mock; URL unset → OAuth.
            const req = mockRequest();
            const rep = mockReply();
            await connectStore(req, rep);
            expect(rep.setCookie).toHaveBeenCalledWith('sallaNonce', expect.any(String), expect.objectContaining({ signed: true }));
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
