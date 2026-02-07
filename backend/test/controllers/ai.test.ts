import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/ai', () => ({
    aiService: {
        generateReply: vi.fn(),
        enqueueReply: vi.fn(),
        getCacheStats: vi.fn(),
        clearCache: vi.fn(),
        getJobStatus: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canUseAiReplies: vi.fn(),
    },
}));

// Import controller AFTER mocks
import { aiController } from '../../src/controllers/ai';
import { aiService } from '../../src/services/ai';
import { subscriptionsService } from '../../src/services/subscriptions';

describe('AiController', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        };
    });

    // ─── generate() ──────────────────────────────────────────────

    describe('generate', () => {
        it('should return AI reply for a valid comment', async () => {
            mockRequest.body = { comment: 'Great product!', language: 'en' };
            const mockResult = { reply: 'Thank you!', language: 'en', cached: false };
            vi.mocked(aiService.generateReply).mockResolvedValue(mockResult);

            await aiController.generate(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(aiService.generateReply).toHaveBeenCalledWith({
                comment: 'Great product!',
                language: 'en',
                context: undefined,
            });
            expect(mockReply.send).toHaveBeenCalledWith(mockResult);
        });

        it('should return 400 when comment is missing', async () => {
            mockRequest.body = { comment: '' };

            await aiController.generate(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Comment is required' });
        });

        it('should return 400 when comment is only whitespace', async () => {
            mockRequest.body = { comment: '   ' };

            await aiController.generate(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should return 500 when service throws', async () => {
            mockRequest.body = { comment: 'Hello' };
            vi.mocked(aiService.generateReply).mockRejectedValue(new Error('AI worker down'));

            await aiController.generate(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to generate AI reply' });
            expect(mockRequest.log!.error).toHaveBeenCalled();
        });
    });

    // ─── generateAsync() ─────────────────────────────────────────

    describe('generateAsync', () => {
        it('should enqueue job for valid comment', async () => {
            mockRequest.body = { comment: 'Nice post!' };
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 100, used: 5 });
            vi.mocked(aiService.enqueueReply).mockResolvedValue({ jobId: 'job-1', status: 'queued' });

            await aiController.generateAsync(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(subscriptionsService.canUseAiReplies).toHaveBeenCalledWith('user-123');
            expect(aiService.enqueueReply).toHaveBeenCalledWith({ comment: 'Nice post!' });
            expect(mockReply.send).toHaveBeenCalledWith({ jobId: 'job-1', status: 'queued' });
        });

        it('should return 400 when comment is missing', async () => {
            mockRequest.body = { comment: '' };

            await aiController.generateAsync(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Comment is required' });
        });

        it('should return 403 when subscription limit exceeded', async () => {
            mockRequest.body = { comment: 'Hello' };
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({
                allowed: false,
                reason: 'Monthly AI reply limit reached',
                limit: 50,
                used: 50,
            });

            await aiController.generateAsync(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Monthly AI reply limit reached',
                    limit: 50,
                    used: 50,
                }),
            );
        });

        it('should return 500 when enqueue fails', async () => {
            mockRequest.body = { comment: 'Test' };
            vi.mocked(subscriptionsService.canUseAiReplies).mockResolvedValue({ allowed: true, limit: 100, used: 0 });
            vi.mocked(aiService.enqueueReply).mockRejectedValue(new Error('Queue down'));

            await aiController.generateAsync(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to enqueue AI reply' });
        });
    });

    // ─── getCacheStats() ─────────────────────────────────────────

    describe('getCacheStats', () => {
        it('should return cache statistics', async () => {
            const stats = { totalEntries: 42, totalHits: 128 };
            vi.mocked(aiService.getCacheStats).mockResolvedValue(stats);

            await aiController.getCacheStats(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(aiService.getCacheStats).toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith(stats);
        });

        it('should return 500 when fetching stats fails', async () => {
            vi.mocked(aiService.getCacheStats).mockRejectedValue(new Error('DB error'));

            await aiController.getCacheStats(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to get cache stats' });
        });
    });

    // ─── clearCache() ────────────────────────────────────────────

    describe('clearCache', () => {
        it('should clear cache and return success message', async () => {
            vi.mocked(aiService.clearCache).mockResolvedValue(undefined);

            await aiController.clearCache(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(aiService.clearCache).toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith({ message: 'Cache cleared successfully' });
        });

        it('should return 500 when clearing cache fails', async () => {
            vi.mocked(aiService.clearCache).mockRejectedValue(new Error('Permission denied'));

            await aiController.clearCache(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to clear cache' });
        });
    });

    // ─── getJobStatus() ──────────────────────────────────────────

    describe('getJobStatus', () => {
        it('should return job status for existing job', async () => {
            mockRequest.params = { jobId: 'job-42' };
            const jobStatus = { jobId: 'job-42', status: 'completed' as const, result: { reply: 'Thanks!' } };
            vi.mocked(aiService.getJobStatus).mockResolvedValue(jobStatus);

            await aiController.getJobStatus(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(aiService.getJobStatus).toHaveBeenCalledWith('job-42');
            expect(mockReply.send).toHaveBeenCalledWith(jobStatus);
        });

        it('should return 404 for non-existent job', async () => {
            mockRequest.params = { jobId: 'no-such-job' };
            vi.mocked(aiService.getJobStatus).mockResolvedValue({ jobId: 'no-such-job', status: 'not_found' });

            await aiController.getJobStatus(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Job not found', jobId: 'no-such-job' });
        });

        it('should return 500 when status lookup fails', async () => {
            mockRequest.params = { jobId: 'job-err' };
            vi.mocked(aiService.getJobStatus).mockRejectedValue(new Error('Redis offline'));

            await aiController.getJobStatus(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to get job status' });
        });
    });
});
