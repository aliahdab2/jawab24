import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import aiRoutes from '../../src/routes/ai';
import { aiService } from '../../src/services/ai';
import { subscriptionsService } from '../../src/services/subscriptions';

// Mock services
vi.mock('../../src/services/ai');
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn(),
    },
}));
vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: vi.fn().mockResolvedValue(null),
    },
}));
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
        // Default: cap allows. Tests that assert the gate override this per-test.
        vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 100, used: 5 });
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

    describe('GET /ai/jobs/:jobId', () => {
        it('should return job status when job exists and is queued', async () => {
            vi.mocked(aiService.getJobStatus).mockResolvedValue({
                jobId: 'test-job-123',
                status: 'queued'
            });

            const response = await app.inject({
                method: 'GET',
                url: '/ai/jobs/test-job-123'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({
                jobId: 'test-job-123',
                status: 'queued'
            });
            expect(aiService.getJobStatus).toHaveBeenCalledWith('test-job-123');
        });

        it('should return completed status with result', async () => {
            vi.mocked(aiService.getJobStatus).mockResolvedValue({
                jobId: 'test-job-456',
                status: 'completed',
                result: { reply: 'Thank you for your comment!' }
            });

            const response = await app.inject({
                method: 'GET',
                url: '/ai/jobs/test-job-456'
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload.status).toBe('completed');
            expect(payload.result.reply).toBe('Thank you for your comment!');
        });

        it('should return failed status with error', async () => {
            vi.mocked(aiService.getJobStatus).mockResolvedValue({
                jobId: 'test-job-789',
                status: 'failed',
                error: 'AI service unavailable'
            });

            const response = await app.inject({
                method: 'GET',
                url: '/ai/jobs/test-job-789'
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload.status).toBe('failed');
            expect(payload.error).toBe('AI service unavailable');
        });

        it('should return 404 when job is not found', async () => {
            vi.mocked(aiService.getJobStatus).mockResolvedValue({
                jobId: 'nonexistent-job',
                status: 'not_found'
            });

            const response = await app.inject({
                method: 'GET',
                url: '/ai/jobs/nonexistent-job'
            });

            expect(response.statusCode).toBe(404);
            expect(JSON.parse(response.payload)).toEqual({
                error: 'Job not found',
                jobId: 'nonexistent-job'
            });
        });
    });
});

