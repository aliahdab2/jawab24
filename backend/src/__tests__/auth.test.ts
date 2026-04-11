import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authController } from '../controllers/auth';
import { facebookService } from '../services/facebook';
import { authService } from '../services/auth';
import { pagesService } from '../services/pages';
import { settingsService } from '../services/settings';

// Mock dependencies
vi.mock('../services/facebook', () => ({
    facebookService: {
        verifyAccessToken: vi.fn(),
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
    }
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
        getUserWorkspaces: vi.fn().mockResolvedValue([{ id: 'test_workspace_id' }]),
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
            isValid: true, userId: 'fb-user', expiresAt: 123456, scopes: ['pages_show_list', 'email'] 
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
        });
        vi.mocked(pagesService.syncFromFacebook).mockResolvedValue({ syncedPages: [], skippedCount: 0, takenCount: 0, revokedCount: 0 });

        // Execute
        await authController.nativeLogin(mockRequest, mockReply);

        // Assert
        expect(facebookService.verifyAccessToken).toHaveBeenCalledWith('valid-fb-token');
        expect(facebookService.getLongLivedToken).toHaveBeenCalledWith('valid-fb-token');
        expect(facebookService.getUserProfile).toHaveBeenCalledWith('long-lived-token');
        expect(authService.findOrCreateUser).toHaveBeenCalledWith(
            'fb-user-id', 'Test User', 'test@example.com', 'long-lived-token', expiresAt, 'https://example.com/photo.jpg'
        );
        expect(pagesService.syncFromFacebook).toHaveBeenCalledWith('test_workspace_id', 'user-id', 'long-lived-token');
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
