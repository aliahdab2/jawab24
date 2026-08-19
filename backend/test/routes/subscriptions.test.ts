import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import subscriptionsRoutes from '../../src/routes/subscriptions';

// Mock the subscriptions service
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        getUserSubscription: vi.fn(),
        getUsageSummary: vi.fn(),
        canUseAiReplies: vi.fn(),
        // /limits/ai answers for the WORKSPACE's billing subject, not the
        // caller — a team member with a leftover trial row of their own would
        // otherwise be told their AI is blocked while the workspace is healthy.
        canUseAiRepliesForWorkspace: vi.fn(),
        resolveWorkspaceSubscription: vi.fn().mockResolvedValue(null),
        canAddPage: vi.fn(),
        changePlan: vi.fn(),
        cancelSubscription: vi.fn(),
        pauseSubscription: vi.fn(),
        resumeSubscription: vi.fn(),
    },
}));

vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: vi.fn(),
    },
    ACCESS_TOKEN_EXPIRY: 900,
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: unknown, _reply: unknown, done?: () => void) => done?.()),
}));

vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn((req: { user?: unknown; workspaceId?: string }, _reply: unknown, done?: () => void) => {
        req.user = { userId: 'user-abc', isAdmin: false };
        req.workspaceId = 'ws-abc';
        done?.();
    }),
    WorkspaceRequest: {},
    requireRole: () => async () => {},
}));

vi.mock('../../src/config', () => ({
    config: {
        demo: { enabled: false, userFacebookId: 'fb_demo' },
        phoneAuthEnabled: false,
        vonage: { apiKey: '', apiSecret: '', senderId: '' },
    },
}));

describe('Subscriptions Routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(subscriptionsRoutes, { prefix: '/api/subscription' });
        await app.ready();
        vi.clearAllMocks();
    });

    // ── GET / ──────────────────────────────────────────────────────────────────

    describe('GET /api/subscription', () => {
        it('should return 200 with subscription data on success', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue({
                id: 'sub_123',
                userId: 'user-abc',
                planId: 'plan_business',
                status: 'active',
                plan: {
                    id: 'plan_business',
                    name: 'Business',
                    slug: 'business',
                    price: 2500,
                    maxPages: 3,
                    maxAiRepliesPerMonth: 1500,
                },
            } as never);

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.id).toBe('sub_123');
            expect(body.data.status).toBe('active');
            expect(body.data.plan.name).toBe('Business');
        });

        it('should return 404 when subscription is null', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(null as never);

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('No subscription found');
        });

        it('should return 500 when service throws', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUserSubscription).mockRejectedValue(new Error('db error'));

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(500);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('Failed to fetch subscription');
        });
    });

    // ── GET /usage ─────────────────────────────────────────────────────────────

    describe('GET /api/subscription/usage', () => {
        it('should return 200 with usage summary on success', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUsageSummary).mockResolvedValue({
                aiReplies: { used: 500, limit: 1500, remaining: 1000, percentUsed: 33.33 },
                pages: { used: 2, limit: 3, remaining: 1 },
            } as never);

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/usage',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.aiReplies.used).toBe(500);
            expect(body.data.pages.used).toBe(2);
        });

        it('should return 404 when usage is null', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUsageSummary).mockResolvedValue(null as never);

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/usage',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('No usage data found');
        });

        it('should return 500 when service throws', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.getUsageSummary).mockRejectedValue(new Error('db error'));

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/usage',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(500);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('Failed to fetch usage');
        });
    });

    // ── GET /limits/ai ─────────────────────────────────────────────────────────

    describe('GET /api/subscription/limits/ai', () => {
        it('should return 200 with AI limit data on success', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.canUseAiRepliesForWorkspace).mockResolvedValue({
                allowed: true,
                limit: 1500,
                used: 500,
                remaining: 1000,
            } as never);

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/ai',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.allowed).toBe(true);
            expect(body.data.remaining).toBe(1000);
        });

        it('should return {allowed:true} for demo user when demo mode is enabled', async () => {
            const configMod = await import('../../src/config');
            const authMod = await import('../../src/services/auth');

            // Enable demo mode for this test
            (configMod.config as { demo: { enabled: boolean; userFacebookId: string } }).demo.enabled = true;
            vi.mocked(authMod.authService.getUserById).mockResolvedValue({
                id: 'user-abc',
                facebookId: 'fb_demo',
            } as never);

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/ai',
                headers: { authorization: 'Bearer test_token' },
            });

            // Restore demo mode
            (configMod.config as { demo: { enabled: boolean; userFacebookId: string } }).demo.enabled = false;

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.allowed).toBe(true);
        });

        it('should return 500 when service throws', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.canUseAiRepliesForWorkspace).mockRejectedValue(new Error('limit check failed'));

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/ai',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(500);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('Failed to check limits');
        });
    });

    // ── GET /limits/pages ──────────────────────────────────────────────────────

    describe('GET /api/subscription/limits/pages', () => {
        it('should return 200 on success', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.canAddPage).mockResolvedValue({
                allowed: true,
                limit: 3,
                used: 2,
                remaining: 1,
            } as never);

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/pages',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.allowed).toBe(true);
            expect(body.data.limit).toBe(3);
            expect(body.data.used).toBe(2);
        });

        it('should return 500 when service throws', async () => {
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.canAddPage).mockRejectedValue(new Error('error'));

            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/pages',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(500);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
        });
    });

    // POST /subscription/change-plan, /cancel, /pause, /resume were removed —
    // those routes were DB-only and silently desynced from Stripe. Mutations
    // now go through /payment/change-plan and /payment/cancel-subscription.
});

describe('Subscription Edge Cases', () => {
    it('should handle limit reached scenario', () => {
        const limitCheck = {
            allowed: false,
            reason: 'Monthly AI reply limit reached',
            limit: 60,
            used: 60,
            remaining: 0,
        };

        expect(limitCheck.allowed).toBe(false);
        expect(limitCheck.reason).toContain('limit reached');
    });

    it('should handle trial expiration scenario', () => {
        const trialEnd = new Date('2024-01-01');
        const now = new Date('2024-01-15');
        const isExpired = trialEnd < now;
        expect(isExpired).toBe(true);
    });

    it('should handle unlimited features correctly', () => {
        const usage = {
            templates: {
                used: 100,
                limit: null, // unlimited
                remaining: null,
            },
        };
        expect(usage.templates.limit).toBeNull();
        expect(usage.templates.remaining).toBeNull();
    });
});
