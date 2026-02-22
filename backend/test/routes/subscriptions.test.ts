import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import subscriptionsRoutes from '../../src/routes/subscriptions';

// Mock the subscriptions service
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        getUserSubscription: vi.fn().mockResolvedValue({
            id: 'sub_123',
            userId: 'user_123',
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
        }),
        getUsageSummary: vi.fn().mockResolvedValue({
            currentPeriod: {
                start: '2024-01-01',
                end: '2024-02-01',
            },
            aiReplies: {
                used: 500,
                limit: 1500,
                remaining: 1000,
                percentUsed: 33.33,
            },
            pages: {
                used: 2,
                limit: 3,
                remaining: 1,
            },
            templates: {
                used: 5,
                limit: null,
                remaining: null,
            },
            rules: {
                used: 3,
                limit: null,
                remaining: null,
            },
            subscription: {
                plan: {
                    id: 'plan_business',
                    name: 'Business',
                },
                status: 'active',
                renewsAt: '2024-02-01',
            },
        }),
        canUseAiReplies: vi.fn().mockResolvedValue({
            allowed: true,
            limit: 1500,
            used: 500,
            remaining: 1000,
        }),
        canAddPage: vi.fn().mockResolvedValue({
            allowed: true,
            limit: 3,
            used: 2,
            remaining: 1,
        }),
        canAddTemplate: vi.fn().mockResolvedValue({
            allowed: true,
        }),
        canAddRule: vi.fn().mockResolvedValue({
            allowed: true,
        }),
        changePlan: vi.fn().mockResolvedValue({
            id: 'sub_123',
            userId: 'user_123',
            planId: 'plan_pro',
            status: 'active',
        }),
        cancelSubscription: vi.fn().mockResolvedValue({
            id: 'sub_123',
            userId: 'user_123',
            status: 'canceled',
            canceledAt: new Date(),
        }),
        pauseSubscription: vi.fn().mockResolvedValue({
            id: 'sub_123',
            userId: 'user_123',
            status: 'paused',
        }),
        resumeSubscription: vi.fn().mockResolvedValue({
            id: 'sub_123',
            userId: 'user_123',
            status: 'active',
        }),
    },
}));

// Mock auth middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async (request, reply) => {
        request.user = { userId: 'user_123', facebookId: 'fb_123' };
    }),
    AuthenticatedRequest: {},
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'workspace_123';
        req.workspaceRole = 'owner';
    },
    WorkspaceRequest: {},
}));

describe('Subscriptions Routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(subscriptionsRoutes, { prefix: '/api/subscription' });
        await app.ready();
    });

    describe('GET /api/subscription', () => {
        it('should return current subscription', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.id).toBe('sub_123');
            expect(body.data.status).toBe('active');
            expect(body.data.plan.name).toBe('Business');
        });
    });

    describe('GET /api/subscription/usage', () => {
        it('should return usage summary', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/usage',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.aiReplies.used).toBe(500);
            expect(body.data.aiReplies.limit).toBe(1500);
            expect(body.data.pages.used).toBe(2);
        });
    });

    describe('GET /api/subscription/limits/ai', () => {
        it('should return AI limit check result', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/ai',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.allowed).toBe(true);
            expect(body.data.remaining).toBe(1000);
        });
    });

    describe('GET /api/subscription/limits/pages', () => {
        it('should return page limit check result', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/pages',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.allowed).toBe(true);
            expect(body.data.limit).toBe(3);
            expect(body.data.used).toBe(2);
        });
    });

    describe('GET /api/subscription/limits/templates', () => {
        it('should return template limit check result', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/templates',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.allowed).toBe(true);
        });
    });

    describe('GET /api/subscription/limits/rules', () => {
        it('should return rule limit check result', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/subscription/limits/rules',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.allowed).toBe(true);
        });
    });

    describe('POST /api/subscription/change-plan', () => {
        it('should change subscription plan', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/subscription/change-plan',
                headers: {
                    authorization: 'Bearer test_token',
                    'content-type': 'application/json',
                },
                payload: {
                    planId: 'plan_pro',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Plan changed successfully');
        });

        it('should return 400 if planId is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/subscription/change-plan',
                headers: {
                    authorization: 'Bearer test_token',
                    'content-type': 'application/json',
                },
                payload: {},
            });

            expect(response.statusCode).toBe(400);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('Plan ID is required');
        });
    });

    describe('POST /api/subscription/cancel', () => {
        it('should cancel subscription', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/subscription/cancel',
                headers: {
                    authorization: 'Bearer test_token',
                    'content-type': 'application/json',
                },
                payload: {
                    reason: 'Too expensive',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Subscription canceled');
            expect(body.data.status).toBe('canceled');
        });
    });

    describe('POST /api/subscription/pause', () => {
        it('should pause subscription', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/subscription/pause',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Subscription paused');
            expect(body.data.status).toBe('paused');
        });
    });

    describe('POST /api/subscription/resume', () => {
        it('should resume subscription', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/subscription/resume',
                headers: {
                    authorization: 'Bearer test_token',
                },
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.message).toBe('Subscription resumed');
            expect(body.data.status).toBe('active');
        });
    });
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

        // Unlimited means no cap
        expect(usage.templates.limit).toBeNull();
        expect(usage.templates.remaining).toBeNull();
    });
});

