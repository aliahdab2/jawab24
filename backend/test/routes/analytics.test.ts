import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import analyticsRoutes from '../../src/routes/analytics';
import { analyticsService } from '../../src/services/analytics';

vi.mock('../../src/services/analytics');
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    },
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'test_workspace_id';
        req.workspaceRole = 'owner';
    },
    requireRole: () => async () => {},
}));

const mockOverview = {
    period: { from: '2026-01-08', to: '2026-02-07', days: 30 },
    totals: { comments: 50, messages: 20, replied: 60, unreplied: 10, replyRate: '85.7', flagged: 3 },
    byMethod: { ai: 45, template: 15 },
    byIntent: { QUESTION: 30 },
    byLanguage: { en: 40 },
    byPlatform: { facebook: 40, instagram: 30 },
    flags: { angry_customer: 2 },
    responseTime: { avgSeconds: 4.2, p50Seconds: 2.1, p95Seconds: 12.5 },
};

describe('Analytics Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(analyticsRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /overview', () => {
        it('should return analytics overview', async () => {
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            const response = await app.inject({
                method: 'GET',
                url: '/overview',
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(mockOverview);
            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 30, undefined);
        });

        it('should pass days query param', async () => {
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            const response = await app.inject({
                method: 'GET',
                url: '/overview?days=7',
            });

            expect(response.statusCode).toBe(200);
            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 7, undefined);
        });

        it('should pass pageId query param', async () => {
            vi.mocked(analyticsService.getOverview).mockResolvedValue(mockOverview as any);

            const response = await app.inject({
                method: 'GET',
                url: '/overview?pageId=page-uuid-123',
            });

            expect(response.statusCode).toBe(200);
            expect(analyticsService.getOverview).toHaveBeenCalledWith('test_workspace_id', 30, 'page-uuid-123');
        });

        it('should return 500 when service fails', async () => {
            vi.mocked(analyticsService.getOverview).mockRejectedValue(new Error('DB error'));

            const response = await app.inject({
                method: 'GET',
                url: '/overview',
            });

            expect(response.statusCode).toBe(500);
            expect(JSON.parse(response.payload)).toEqual({ error: 'Failed to fetch analytics' });
        });
    });
});
