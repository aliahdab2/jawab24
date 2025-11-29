import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import authRoutes from '../../src/routes/auth';
import { authService } from '../../src/services/auth';
import { facebookService } from '../../src/services/facebook';

// Mock services
vi.mock('../../src/services/auth');
vi.mock('../../src/services/facebook');

describe('Auth Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(authRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    it('should handle Facebook login successfully', async () => {
        const mockCode = 'test_auth_code';
        const mockAccessToken = 'test_access_token';
        const mockProfile = { id: '123', name: 'Test User', email: 'test@example.com' };
        const mockUser = { ...mockProfile, facebookId: '123', id: 'user_uuid', createdAt: new Date(), updatedAt: new Date() };
        const mockToken = 'jwt_token';

        // Setup mocks
        vi.mocked(facebookService.getAccessToken).mockResolvedValue(mockAccessToken);
        vi.mocked(facebookService.getUserProfile).mockResolvedValue(mockProfile);
        vi.mocked(authService.findOrCreateUser).mockResolvedValue(mockUser);
        vi.mocked(authService.generateToken).mockResolvedValue(mockToken);
        vi.mocked(authService.createAuthResponse).mockReturnValue({
            token: mockToken,
            user: { id: mockUser.id, name: mockUser.name, facebookId: mockUser.facebookId }
        });

        const response = await app.inject({
            method: 'POST',
            url: '/auth/facebook',
            payload: { code: mockCode }
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload)).toEqual({
            token: mockToken,
            user: {
                id: mockUser.id,
                name: mockUser.name,
                facebookId: mockUser.facebookId
            }
        });

        expect(facebookService.getAccessToken).toHaveBeenCalledWith(mockCode);
        expect(authService.findOrCreateUser).toHaveBeenCalledWith(mockProfile.id, mockProfile.name, mockProfile.email);
    });

    it('should return 400 if code is missing', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/auth/facebook',
            payload: {}
        });

        expect(response.statusCode).toBe(400);
    });

    it('should handle authentication failures', async () => {
        vi.mocked(facebookService.getAccessToken).mockRejectedValue(new Error('Facebook Error'));

        const response = await app.inject({
            method: 'POST',
            url: '/auth/facebook',
            payload: { code: 'invalid_code' }
        });

        expect(response.statusCode).toBe(401);
    });
});

