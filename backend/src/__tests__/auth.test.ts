import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authController } from '../controllers/auth';
import { facebookService } from '../services/facebook';
import { authService } from '../services/auth';
import { pagesService } from '../services/pages';
import { settingsService } from '../services/settings';
import { auditLog } from '../services/auditLog';
import { isPartnerUser } from '../services/partnerAccess';

// Mock dependencies
vi.mock('../services/facebook', () => ({
    facebookService: {
        verifyAccessToken: vi.fn(),
        getAccessToken: vi.fn(),
        getLongLivedToken: vi.fn(),
        getUserProfile: vi.fn(),
    }
}));

vi.mock('../services/auth', () => ({
    authService: {
        findOrCreateUser: vi.fn(),
        generateToken: vi.fn(),
        createAuthResponse: vi.fn(),
        getUserById: vi.fn(),
        deleteUser: vi.fn(),
    }
}));

vi.mock('../services/auditLog', () => ({
    auditLog: vi.fn().mockResolvedValue(undefined),
}));

// Mock db for refreshPicture (update chain)
// vi.hoisted() is required because vi.mock() factories are hoisted to top of file
const { mockDbUpdate } = vi.hoisted(() => {
    const mockDbUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
    });
    return { mockDbUpdate };
});
vi.mock('../db', () => ({
    db: { update: mockDbUpdate },
}));

vi.mock('../services/pages', () => ({
    pagesService: {
        syncFromFacebook: vi.fn(),
    }
}));

// Every login path resolves the caller's partner status for the nav entry.
// Mocked at the module, not the db: the login controllers own WHETHER it is
// asked, and partnerAccess.test.ts owns what the answer is built from.
vi.mock('../services/partnerAccess', () => ({
    isPartnerUser: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/settings', () => ({
    settingsService: {
        getSettings: vi.fn(),
    }
}));

vi.mock('../services/refreshToken', () => ({
    refreshTokenService: {
        createRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
    }
}));

vi.mock('../services/cookies', () => ({
    cookiesService: {
        setAuthCookies: vi.fn(),
        setRefreshTokenCookie: vi.fn(),
        clearAuthCookies: vi.fn(),
    }
}));

vi.mock('../integrations', () => ({
    integrationRegistry: {
        getEnabled: vi.fn().mockReturnValue([]),
    }
}));

vi.mock('../services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: vi.fn().mockResolvedValue([{ id: 'test_workspace_id', role: 'owner' }]),
        resolveDefaultWorkspaceId: vi.fn().mockResolvedValue('test_workspace_id'),
    }
}));

describe('AuthController - Native Login', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRequest: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReply: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRequest = {
            body: { accessToken: 'valid-fb-token' },
            log: { error: vi.fn(), info: vi.fn() }
        };

        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            setCookie: vi.fn(),
            clearCookie: vi.fn(),
        };
    });

    it('should successfully login with valid native token', async () => {
        // Setup Mocks
        const expiresAt = new Date();
        vi.mocked(facebookService.verifyAccessToken).mockResolvedValue({
            isValid: true, userId: 'fb-user', expiresAt: 123456, scopes: ['pages_show_list', 'email'], granularScopes: []
        });
        vi.mocked(facebookService.getLongLivedToken).mockResolvedValue({ 
            token: 'long-lived-token', expiresAt 
        });
        vi.mocked(facebookService.getUserProfile).mockResolvedValue({ 
            id: 'fb-user-id', name: 'Test User', email: 'test@example.com', picture: 'https://example.com/photo.jpg'
        });
        vi.mocked(authService.findOrCreateUser).mockResolvedValue({ 
            id: 'user-id', facebookId: 'fb-user-id', name: 'Test User' 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as unknown as any); // Force cast for mock
        vi.mocked(authService.generateToken).mockReturnValue('session-jwt');
        vi.mocked(settingsService.getSettings).mockResolvedValue({ 
            dashboardLanguage: 'en' 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as unknown as any); // Force cast for mock
        vi.mocked(authService.createAuthResponse).mockReturnValue({
            token: 'session-jwt',
            fbAccessToken: 'long-lived-token',
            user: { id: 'user-id', facebookId: 'fb-user-id', name: 'Test User' },
            settings: { dashboardLanguage: 'en' },
            workspaces: [],
            defaultWorkspaceId: null,
        });
        vi.mocked(pagesService.syncFromFacebook).mockResolvedValue({ syncedPages: [], skippedCount: 0, skippedPages: [], skipReason: 'page_limit', pageLimit: null, takenCount: 0, takenPages: [], trialBlockedCount: 0, trialBlockedPages: [], revokedCount: 0, alreadyMemberOf: [] });

        // Execute
        await authController.nativeLogin(mockRequest, mockReply);

        // Assert
        expect(facebookService.verifyAccessToken).toHaveBeenCalledWith('valid-fb-token');
        expect(facebookService.getLongLivedToken).toHaveBeenCalledWith('valid-fb-token');
        expect(facebookService.getUserProfile).toHaveBeenCalledWith('long-lived-token');
        expect(authService.findOrCreateUser).toHaveBeenCalledWith(
            'fb-user-id', 'Test User', 'test@example.com', 'long-lived-token', expiresAt, 'https://example.com/photo.jpg'
        );
        expect(pagesService.syncFromFacebook).toHaveBeenCalledWith(
            'test_workspace_id',
            'user-id',
            'long-lived-token',
            undefined,
            expect.objectContaining({ info: expect.any(Function), warn: expect.any(Function), error: expect.any(Function), debug: expect.any(Function) }),
        );
        // Partner status must ride the login response: a standing session is
        // the only thing the nav entry reads, and this path (native FB login)
        // never revisits /auth/me on a device that stays signed in.
        expect(isPartnerUser).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-id' }),
        );
        expect(authService.createAuthResponse).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), expect.anything(), expect.anything(),
            expect.anything(), expect.anything(),
            { isPartner: false },
        );
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
            token: 'session-jwt'
        }));
    });

    it('should return 401 if token verification fails', async () => {
        vi.mocked(facebookService.verifyAccessToken).mockRejectedValue(new Error('Invalid token'));

        await authController.nativeLogin(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(401);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
            error: 'Authentication failed'
        }));
    });

    it('should return 400 if accessToken is missing', async () => {
        mockRequest.body.accessToken = undefined;

        await authController.nativeLogin(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
            error: 'Access token is required'
        }));
    });
});

describe('AuthController - refreshPicture', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRequest: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReply: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRequest = {
            user: { userId: 'user-123' },
            log: { error: vi.fn() },
        };

        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
        };
    });

    it('should return 401 if user is not authenticated', async () => {
        mockRequest.user = undefined;

        await authController.refreshPicture(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(401);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
    });

    it('should return 404 if user not found in DB', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue(null);

        await authController.refreshPicture(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(404);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'User not found' }));
    });

    it('should return 422 if user has no Facebook token', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-123', facebookId: 'fb-123', name: 'Test', facebookAccessToken: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await authController.refreshPicture(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(422);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'No Facebook token available' }));
        expect(facebookService.getUserProfile).not.toHaveBeenCalled();
    });

    it('should return 422 if Facebook returns no picture', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-123', facebookId: 'fb-123', name: 'Test', facebookAccessToken: 'fb-token',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        vi.mocked(facebookService.getUserProfile).mockResolvedValue({
            id: 'fb-123', name: 'Test', picture: undefined,
        });

        await authController.refreshPicture(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(422);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'No picture returned from Facebook' }));
    });

    it('should save fresh picture URL to DB and return it', async () => {
        const freshUrl = 'https://scontent.fbcdn.net/new-photo.jpg';
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-123', facebookId: 'fb-123', name: 'Test', facebookAccessToken: 'fb-token',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        vi.mocked(facebookService.getUserProfile).mockResolvedValue({
            id: 'fb-123', name: 'Test', picture: freshUrl,
        });

        await authController.refreshPicture(mockRequest, mockReply);

        expect(facebookService.getUserProfile).toHaveBeenCalledWith('fb-token');
        expect(mockDbUpdate).toHaveBeenCalled();
        expect(mockReply.send).toHaveBeenCalledWith({ picture: freshUrl });
    });

    it('should return 500 if Facebook API call throws', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-123', facebookId: 'fb-123', name: 'Test', facebookAccessToken: 'fb-token',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        vi.mocked(facebookService.getUserProfile).mockRejectedValue(new Error('FB API error'));

        await authController.refreshPicture(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(500);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Internal Server Error' }));
    });
});

describe('AuthController - linkFacebook demo guard', () => {
    // Prod incident 2026-07-18: a merchant ran the link flow from inside a demo
    // session; linkFacebookToUser overwrote the SHARED demo user row with their
    // real identity, orphaning every demo page and 500ing demo login for everyone.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRequest: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReply: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequest = {
            user: { userId: 'user-1' },
            body: { code: 'fb-oauth-code', redirectUri: 'https://jawab24.com/ar/auth/callback' },
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        };
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    it('refuses to link Facebook to a demo account (DEMO_LINK_FORBIDDEN), before any FB call', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-1', facebookId: 'demo_user_jawab24', name: 'Demo',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await authController.linkFacebook(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(403);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'DEMO_LINK_FORBIDDEN' }));
        expect(facebookService.getAccessToken).not.toHaveBeenCalled();
    });

    it('refuses to link a phone to a demo account (DEMO_LINK_FORBIDDEN), before OTP verification', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-1', facebookId: 'demo_user_jawab24', name: 'Demo',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        mockRequest.body = { phone: '+218912345678', code: '123456' };

        await authController.linkPhone(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(403);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'DEMO_LINK_FORBIDDEN' }));
    });

    it('proceeds past the guard for a real (non-demo) user', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-1', facebookId: '1234567890', name: 'Real User',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        // Fail at the FB exchange with a user-side error so the flow stops in the
        // 400 branch — proves the guard let a real user through.
        vi.mocked(facebookService.getAccessToken).mockRejectedValue(new Error('Facebook API error: bad code'));

        await authController.linkFacebook(mockRequest, mockReply);

        expect(facebookService.getAccessToken).toHaveBeenCalledWith('fb-oauth-code', 'https://jawab24.com/ar/auth/callback');
        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(mockReply.send).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'DEMO_LINK_FORBIDDEN' }));
    });
});

describe('AuthController - deleteAccount demo guard', () => {
    // The 2026-07-18 hijack fix guarded the two LINK paths and stopped there, so a
    // demo session could still DELETE the shared demo user outright — cascading the
    // demo_page_* fixtures and breaking demo login for everyone. Found 2026-08-14
    // while answering Apple's Guideline 2.1 request, which asks us to demonstrate
    // the account-deletion flow and so puts a reviewer on exactly that screen.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRequest: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReply: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequest = {
            user: { userId: 'user-1' },
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        };
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    it('refuses to delete the shared demo account, before any destructive call', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-1', facebookId: 'demo_user_jawab24', name: 'Demo',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await authController.deleteAccount(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(403);
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'DEMO_DELETE_FORBIDDEN' }));
        expect(authService.deleteUser).not.toHaveBeenCalled();
        expect(auditLog).not.toHaveBeenCalled();
    });

    it('deletes a real (non-demo) account', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue({
            id: 'user-1', facebookId: '1234567890', name: 'Real User',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        vi.mocked(authService.deleteUser).mockResolvedValue(undefined);

        await authController.deleteAccount(mockRequest, mockReply);

        expect(authService.deleteUser).toHaveBeenCalledWith('user-1');
        expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(mockReply.send).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'DEMO_DELETE_FORBIDDEN' }));
    });

    it('rejects an unauthenticated caller without looking the user up', async () => {
        mockRequest.user = undefined;

        await authController.deleteAccount(mockRequest, mockReply);

        expect(mockReply.status).toHaveBeenCalledWith(401);
        expect(authService.getUserById).not.toHaveBeenCalled();
        expect(authService.deleteUser).not.toHaveBeenCalled();
    });
});
