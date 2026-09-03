import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

vi.mock('../../src/db', () => ({
    db: { update: vi.fn(), select: vi.fn() },
}));
vi.mock('../../src/db/schema', () => ({
    users: {}, ecommerceStores: {}, subscriptions: {},
}));
vi.mock('drizzle-orm', () => ({
    eq: vi.fn((f, v) => ({ f, v })),
    and: vi.fn((...args) => ({ args })),
    sql: vi.fn(),
}));
vi.mock('../../src/config', () => ({
    config: { phoneAuthEnabled: false },
}));
vi.mock('../../src/services/otp', () => ({
    otpService: { verifyOtp: vi.fn(), generateCode: vi.fn(), storeOtp: vi.fn(), sendOtp: vi.fn() },
    OtpRateLimitError: class OtpRateLimitError extends Error {
        constructor() { super('rate limit'); this.name = 'OtpRateLimitError'; }
    },
}));
vi.mock('../../src/services/cookies', () => ({ cookiesService: { setAuthCookies: vi.fn() } }));
// The controller's replay trigger pulls in services/activation → lib/redis; stub it like the rest.
vi.mock('../../src/services/activation', () => ({ replayPendingActivationEventsToGa4: vi.fn() }));
vi.mock('../../src/services/refreshToken', () => ({ refreshTokenService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/integrations', () => ({ integrationRegistry: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLog: { log: vi.fn() } }));

vi.mock('../../src/services/auth', () => ({
    authService: {
        linkFacebookToUser: vi.fn().mockResolvedValue(undefined),
        // Exhaustive factory: the new collision guard calls this on every link, so a
        // missing export would surface as a 500 on every path, not a mock error.
        getUserByFacebookId: vi.fn().mockResolvedValue(null),
        getUserById: vi.fn().mockResolvedValue({
            id: 'user-1', facebookId: 'fb-123', name: 'Test', email: null,
            phone: '+966500000000', phoneVerified: true, picture: null,
            facebookAccessToken: null, facebookTokenExpiresAt: null,
            hasInstagramPermission: false, isAdmin: false, createdAt: new Date(), updatedAt: new Date(),
        }),
        generateToken: vi.fn().mockReturnValue('new-jwt'),
        createAuthResponse: vi.fn().mockReturnValue({ token: 'new-jwt', user: { id: 'user-1' } }),
    },
    ACCESS_TOKEN_EXPIRY: 900,
    EMBEDDED_BREAKOUT_TOKEN_EXPIRY: 60 * 60 * 1000,
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getAccessToken: vi.fn().mockResolvedValue('short-lived'),
        getLongLivedToken: vi.fn().mockResolvedValue({ token: 'long-lived', expiresAt: new Date('2026-12-31') }),
        getUserProfile: vi.fn().mockResolvedValue({ id: 'fb-123', picture: 'https://pic.example.com' }),
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: { syncFromFacebook: vi.fn().mockResolvedValue(undefined) },
}));

// Login/link paths resolve the caller's partner status for the nav entry.
// Stubbed here so this suite keeps its narrow db mock; the restricted-caller
// test below asserts the controller never even asks on a scoped session.
vi.mock('../../src/services/partnerAccess', () => ({
    isPartnerUser: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-1' }]),
        resolveDefaultWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
    },
}));

import { AuthController } from '../../src/controllers/auth';
// Pulled from the module under mock so the assertion and the controller read one
// declaration — a literal copied into the test would drift if the expiry changed.
import { authService, ACCESS_TOKEN_EXPIRY, EMBEDDED_BREAKOUT_TOKEN_EXPIRY } from '../../src/services/auth';
import { facebookService } from '../../src/services/facebook';
import { pagesService } from '../../src/services/pages';
import { workspaceService } from '../../src/services/workspace';
import { isPartnerUser } from '../../src/services/partnerAccess';

describe('AuthController - linkFacebook', () => {
    let authController: AuthController;
    let mockReply: Partial<FastifyReply>;

    const makeRequest = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
        ({
            user: { userId: 'user-1', isAdmin: false },
            body: { code: 'fb-code-abc', redirectUri: 'https://jawab24.com/ar/auth/callback' },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
            ...overrides,
        } as unknown as AuthenticatedRequest);

    beforeEach(() => {
        vi.clearAllMocks();
        authController = new AuthController();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            setCookie: vi.fn().mockReturnThis(),
        };
        // Restore defaults after clearAllMocks
        vi.mocked(facebookService.getAccessToken).mockResolvedValue('short-lived');
        vi.mocked(facebookService.getLongLivedToken).mockResolvedValue({ token: 'long-lived', expiresAt: new Date('2026-12-31') });
        vi.mocked(facebookService.getUserProfile).mockResolvedValue({ id: 'fb-123', picture: 'https://pic.example.com' });
        vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([{ id: 'ws-1' }] as any);
        vi.mocked(pagesService.syncFromFacebook).mockResolvedValue(undefined);
        vi.mocked(authService.linkFacebookToUser).mockResolvedValue(undefined);
        // Default: the Facebook identity is unowned, so the collision guard is a no-op
        // and the happy-path tests proceed. Collision cases override this per test.
        vi.mocked(authService.getUserByFacebookId).mockResolvedValue(null);
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-1', facebookId: 'fb-123', name: 'Test', email: null,
            phone: '+966500000000', phoneVerified: true, picture: null,
            facebookAccessToken: null, facebookTokenExpiresAt: null,
            hasInstagramPermission: false, isAdmin: false, createdAt: new Date(), updatedAt: new Date(),
        } as any);
        vi.mocked(authService.generateToken).mockReturnValue('new-jwt');
        vi.mocked(authService.createAuthResponse).mockReturnValue({ token: 'new-jwt', user: { id: 'user-1' } } as any);
    });

    it('returns 401 when user is not authenticated', async () => {
        const req = makeRequest({ user: undefined });

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(401);
        expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('returns 400 when code is missing', async () => {
        const req = makeRequest({ body: { redirectUri: 'https://example.com' } });

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith({ error: 'code is required' });
    });

    it('uses authService.linkFacebookToUser (not direct db.update)', async () => {
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(authService.linkFacebookToUser).toHaveBeenCalledWith(
            'user-1', 'fb-123', 'long-lived', new Date('2026-12-31'), 'https://pic.example.com'
        );
    });

    it('syncs pages after linking', async () => {
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
            'ws-1',
            'user-1',
            'long-lived',
            undefined,
            expect.objectContaining({ info: expect.any(Function) }),
        );
    });

    it('returns auth response on success', async () => {
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'new-jwt' })
        );
    });

    it('skips page sync when user has no workspace', async () => {
        vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValueOnce([]);
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(pagesService.syncFromFacebook).not.toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'new-jwt' })
        );
    });

    it('continues (non-fatal) when page sync fails', async () => {
        vi.mocked(pagesService.syncFromFacebook).mockRejectedValueOnce(new Error('sync failed'));
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'new-jwt' })
        );
    });

    it('falls back to short-lived token when long-lived exchange fails', async () => {
        vi.mocked(facebookService.getLongLivedToken).mockRejectedValueOnce(new Error('exchange failed'));
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(authService.linkFacebookToUser).toHaveBeenCalledWith(
            'user-1', 'fb-123', 'short-lived', undefined, 'https://pic.example.com'
        );
    });

    it('returns 500 when Facebook token exchange fails', async () => {
        vi.mocked(facebookService.getAccessToken).mockRejectedValueOnce(new Error('Facebook API error'));
        const req = makeRequest();

        await authController.linkFacebook(req, mockReply as FastifyReply);

        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'server_error' })
        );
    });

    it('mints an UNSCOPED token for an ordinary session', async () => {
        await authController.linkFacebook(makeRequest(), mockReply as FastifyReply);

        expect(authService.generateToken).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-1' }),
            ACCESS_TOKEN_EXPIRY,
        );
    });

    /**
     * Prod, Zid dev-store walkthrough 2026-08-31: a merchant whose Facebook identity
     * already belonged to a DIFFERENT Jawab24 user (direct-FB signup vs a Zid embedded
     * auto-provisioned account) connected a page. `users.facebook_id` is UNIQUE, so the
     * link write threw a 23505 that surfaced as a generic 500 — the page sync never ran,
     * 0 pages connected, and nothing signalled the cause. The guard detects it first.
     */
    describe('Facebook-identity collision', () => {
        it('returns 409 FACEBOOK_ALREADY_LINKED and does NOT write the link or sync pages when the identity belongs to another user', async () => {
            vi.mocked(authService.getUserByFacebookId).mockResolvedValue({ id: 'other-user-2' });

            await authController.linkFacebook(makeRequest(), mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(409);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'FACEBOOK_ALREADY_LINKED' }));
            // Once a collision is detected, neither the link write nor the sync may run.
            expect(authService.linkFacebookToUser).not.toHaveBeenCalled();
            expect(pagesService.syncFromFacebook).not.toHaveBeenCalled();
        });

        it('proceeds to link when the identity is unowned (lookup returns null)', async () => {
            vi.mocked(authService.getUserByFacebookId).mockResolvedValue(null);

            await authController.linkFacebook(makeRequest(), mockReply as FastifyReply);

            expect(mockReply.status).not.toHaveBeenCalledWith(409);
            expect(authService.linkFacebookToUser).toHaveBeenCalled();
        });

        it('proceeds to link when the identity already belongs to the SAME user (idempotent reconnect)', async () => {
            vi.mocked(authService.getUserByFacebookId).mockResolvedValue({ id: 'user-1' });

            await authController.linkFacebook(makeRequest(), mockReply as FastifyReply);

            expect(mockReply.status).not.toHaveBeenCalledWith(409);
            expect(authService.linkFacebookToUser).toHaveBeenCalled();
        });
    });

    /**
     * This endpoint is where the embedded break-out ENDS UP: the frame opens a
     * top-level tab (facebook.com refuses framing) carrying a scoped handoff, and
     * the merchant then connects a page — which lands here. Re-minting unscoped
     * would hand the iframe credential a full admin-capable session one screen
     * after the handoff carefully preserved the scope, defeating D-066/D-067.
     */
    describe('restricted (embedded) caller', () => {
        const scopedRequest = () => makeRequest({
            user: { userId: 'user-1', isAdmin: false, embeddedPlatform: 'zid', scopedWorkspaceId: 'ws-9' },
        } as Partial<AuthenticatedRequest>);

        beforeEach(() => {
            // The owner also holds workspaces the store install never proved.
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue(
                [{ id: 'ws-1' }, { id: 'ws-9' }] as any,
            );
        });

        it('re-mints a token that is STILL scoped — connecting a page is not an escalation', async () => {
            await authController.linkFacebook(scopedRequest(), mockReply as FastifyReply);

            expect(authService.generateToken).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'user-1' }),
                EMBEDDED_BREAKOUT_TOKEN_EXPIRY,
                { embeddedPlatform: 'zid', workspaceId: 'ws-9' },
            );
        });

        it('syncs pages into the PINNED workspace, not workspaces[0]', async () => {
            await authController.linkFacebook(scopedRequest(), mockReply as FastifyReply);

            // workspaces[0] is 'ws-1' — a workspace this session cannot read back,
            // so the merchant would connect a page and still see none.
            expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
                'ws-9', 'user-1', 'long-lived', undefined, expect.anything(),
            );
        });

        it('skips the sync when the pinned workspace is not one the user belongs to', async () => {
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([{ id: 'ws-1' }] as any);

            await authController.linkFacebook(scopedRequest(), mockReply as FastifyReply);

            // This route runs on `authenticate` alone — no resolveWorkspace — so
            // the pinned id must still be resolved through the membership list
            // rather than trusted straight into a write.
            expect(pagesService.syncFromFacebook).not.toHaveBeenCalled();
        });

        it('pins the workspace from the SCOPE and never consults the resolver', async () => {
            await authController.linkFacebook(scopedRequest(), mockReply as FastifyReply);

            expect(workspaceService.resolveDefaultWorkspaceId).not.toHaveBeenCalled();
            expect(authService.createAuthResponse).toHaveBeenCalledWith(
                expect.anything(), 'new-jwt', 'long-lived', undefined,
                // Only the pinned workspace — shipping the full list renders a
                // switcher whose every other entry 403s.
                [{ id: 'ws-9' }],
                'ws-9',
                // A RESTRICTED session proves a store, not a person: the Partner
                // entry must be force-cleared here exactly as isAdmin is, and
                // the lookup skipped entirely rather than merely ignored.
                { isPartner: false },
            );
            expect(isPartnerUser).not.toHaveBeenCalled();
        });
    });
});
