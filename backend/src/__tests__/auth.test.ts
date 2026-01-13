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
    }
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

describe('AuthController - Native Login', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRequest: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReply: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRequest = {
            body: { accessToken: 'valid-fb-token' },
            log: { error: vi.fn() }
        };

        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
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
            settings: { dashboardLanguage: 'en' }
        });
        vi.mocked(pagesService.syncFromFacebook).mockResolvedValue([]);

        // Execute
        await authController.nativeLogin(mockRequest, mockReply);

        // Assert
        expect(facebookService.verifyAccessToken).toHaveBeenCalledWith('valid-fb-token');
        expect(facebookService.getLongLivedToken).toHaveBeenCalledWith('valid-fb-token');
        expect(facebookService.getUserProfile).toHaveBeenCalledWith('long-lived-token');
        expect(authService.findOrCreateUser).toHaveBeenCalledWith(
            'fb-user-id', 'Test User', 'test@example.com', 'long-lived-token', expiresAt, 'https://example.com/photo.jpg'
        );
        expect(pagesService.syncFromFacebook).toHaveBeenCalledWith('user-id', 'long-lived-token');
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
