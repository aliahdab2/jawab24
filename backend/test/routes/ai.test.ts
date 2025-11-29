import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import aiRoutes from '../../src/routes/ai';
import { aiService } from '../../src/services/ai';

// Mock services
vi.mock('../../src/services/ai');
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));

describe('AI Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(aiRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('POST /ai/generate', () => {
        it('should generate AI reply successfully', async () => {
            const mockResponse = {
                reply: 'Thank you for your comment!',
                language: 'en',
                cached: false,
                model: 'gpt-4-mini'
            };

            vi.mocked(aiService.generateReply).mockResolvedValue(mockResponse);

            const response = await app.inject({
                method: 'POST',
                url: '/ai/generate',
                payload: { comment: 'Hello, I love your product!' }
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(mockResponse);
            expect(aiService.generateReply).toHaveBeenCalledWith({
                comment: 'Hello, I love your product!',
                language: undefined,
                context: undefined
            });
        });

        it('should return cached reply when available', async () => {
            const mockResponse = {
                reply: 'Cached response',
                language: 'en',
                cached: true
            };

            vi.mocked(aiService.generateReply).mockResolvedValue(mockResponse);

            const response = await app.inject({
                method: 'POST',
                url: '/ai/generate',
                payload: { comment: 'Hello!' }
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload).cached).toBe(true);
        });

        it('should return 400 if comment is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/ai/generate',
                payload: {}
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 if comment is empty', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/ai/generate',
                payload: { comment: '   ' }
            });

            expect(response.statusCode).toBe(400);
        });

        it('should pass language and context to service', async () => {
            const mockResponse = {
                reply: 'شكراً لك!',
                language: 'ar',
                cached: false
            };

            vi.mocked(aiService.generateReply).mockResolvedValue(mockResponse);

            const requestPayload = {
                comment: 'مرحبا',
                language: 'ar',
                context: {
                    postMessage: 'New product launch!',
                    pageName: 'My Store'
                }
            };

            const response = await app.inject({
                method: 'POST',
                url: '/ai/generate',
                payload: requestPayload
            });

            expect(response.statusCode).toBe(200);
            expect(aiService.generateReply).toHaveBeenCalledWith(requestPayload);
        });
    });

    describe('GET /ai/cache/stats', () => {
        it('should return cache statistics', async () => {
            const mockStats = { totalEntries: 100, totalHits: 500 };
            vi.mocked(aiService.getCacheStats).mockResolvedValue(mockStats);

            const response = await app.inject({
                method: 'GET',
                url: '/ai/cache/stats'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(mockStats);
        });
    });

    describe('DELETE /ai/cache', () => {
        it('should clear cache successfully', async () => {
            vi.mocked(aiService.clearCache).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'DELETE',
                url: '/ai/cache'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ message: 'Cache cleared successfully' });
            expect(aiService.clearCache).toHaveBeenCalled();
        });
    });
});

