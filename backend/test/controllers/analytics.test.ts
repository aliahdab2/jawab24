import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

vi.mock('../../src/services/analytics', () => ({
    analyticsService: {
        getOverview: vi.fn(),
        getAiUsage: vi.fn(),
    },
}));

import { AnalyticsController } from '../../src/controllers/analytics';
import { analyticsService } from '../../src/services/analytics';

describe('AnalyticsController', () => {
    let controller: AnalyticsController;
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    const mockOverview = {
        period: { from: '2026-01-08', to: '2026-02-07', days: 30 },
        totals: { comments: 50, messages: 20, replied: 60, unreplied: 10, replyRate: '85.7', flagged: 3 },
        byMethod: { ai: 45, template: 15 },
        byIntent: { QUESTION: 30, GREETING: 20 },
        byLanguage: { en: 40, ar: 30 },
        byPlatform: { facebook: 40, instagram: 30 },
        flags: { angry_customer: 2, low_confidence: 1 },
        responseTime: { avgSeconds: 4.2, p50Seconds: 2.1, p95Seconds: 12.5 },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new AnalyticsController();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            workspaceId: 'test_workspace_id',
            workspaceRole: 'owner',
            query: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        } as any;
    });

    describe('getOverview', () => {
        it('should call service with default days=30 when no query param', async () => {
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 30, undefined);
            expect(mockReply.send).toHaveBeenCalledWith(mockOverview);
        });

        it('should pass days query parameter to service', async () => {
            mockRequest.query = { days: '7' };
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 7, undefined);
        });

        it('should clamp days to minimum 1', async () => {
            mockRequest.query = { days: '-5' };
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 1, undefined);
        });

        it('should clamp days to maximum 365', async () => {
            mockRequest.query = { days: '999' };
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 365, undefined);
        });

        it('should default to 30 when days is not a number', async () => {
            mockRequest.query = { days: 'abc' };
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 30, undefined);
        });

        it('should pass pageId to service', async () => {
            mockRequest.query = { pageId: 'page-uuid-123' };
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 30, 'page-uuid-123');
        });

        it('should pass both days and pageId to service', async () => {
            mockRequest.query = { days: '7', pageId: 'page-uuid-123' };
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 7, 'page-uuid-123');
        });

        it('should return 500 when service throws', async () => {
            vi.mocked(analyticsService.getOverview).mockRejectedValue(new Error('DB connection lost'));

            await controller.getOverview(mockRequest as any, mockReply as any);

            expect(mockRequest.log!.error).toHaveBeenCalled();
            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to fetch analytics' });
        });
    });

    describe('getAiUsage', () => {
        const mockReport = {
            period: { from: '2026-01-21', to: '2026-02-20', days: 30 },
            totals: { calls: 150, llmCalls: 120, cacheHits: 30, tokensIn: 75000, tokensOut: 30000, costUsd: 0.02925 },
            byModel: { 'gpt-4o-mini': { calls: 150, llmCalls: 120, cacheHits: 30, tokensIn: 75000, tokensOut: 30000, costUsd: 0.02925 } },
            byDay: [{ date: '2026-02-15', calls: 100, tokensIn: 50000, tokensOut: 20000, costUsd: 0.019500 }],
        };

        it('should return 401 when user is not authenticated', async () => {
            mockRequest.user = undefined;

            await controller.getAiUsage(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(401);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });

        it('should call service with default days=30 when no query param', async () => {
            vi.mocked(analyticsService.getAiUsage).mockResolvedValue(mockReport as any);

            await controller.getAiUsage(mockRequest as any, mockReply as any);

            expect(analyticsService.getAiUsage).toHaveBeenCalledWith('user-123', 30);
            expect(mockReply.send).toHaveBeenCalledWith(mockReport);
        });

        it('should pass days query parameter to service', async () => {
            mockRequest.query = { days: '7' };
            vi.mocked(analyticsService.getAiUsage).mockResolvedValue(mockReport as any);

            await controller.getAiUsage(mockRequest as any, mockReply as any);

            expect(analyticsService.getAiUsage).toHaveBeenCalledWith('user-123', 7);
        });

        it('should clamp days to minimum 1', async () => {
            mockRequest.query = { days: '-5' };
            vi.mocked(analyticsService.getAiUsage).mockResolvedValue(mockReport as any);

            await controller.getAiUsage(mockRequest as any, mockReply as any);

            expect(analyticsService.getAiUsage).toHaveBeenCalledWith('user-123', 1);
        });

        it('should clamp days to maximum 365', async () => {
            mockRequest.query = { days: '999' };
            vi.mocked(analyticsService.getAiUsage).mockResolvedValue(mockReport as any);

            await controller.getAiUsage(mockRequest as any, mockReply as any);

            expect(analyticsService.getAiUsage).toHaveBeenCalledWith('user-123', 365);
        });

        it('should return 500 when service throws', async () => {
            vi.mocked(analyticsService.getAiUsage).mockRejectedValue(new Error('DB error'));

            await controller.getAiUsage(mockRequest as any, mockReply as any);

            expect(mockRequest.log!.error).toHaveBeenCalled();
            expect(mockReply.status).toHaveBeenCalledWith(500);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Failed to fetch AI usage' });
        });
    });
});
