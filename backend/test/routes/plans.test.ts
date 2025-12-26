import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import plansRoutes from '../../src/routes/plans';

// Mock the plans service
vi.mock('../../src/services/plans', () => ({
    plansService: {
        getActivePlans: vi.fn().mockResolvedValue([
            {
                id: 'plan_free',
                name: 'Free Trial',
                slug: 'free',
                description: 'Try Jawab24 free for 30 days',
                price: 0,
                currency: 'USD',
                interval: 'month',
                maxPages: 1,
                maxAiRepliesPerMonth: 60,
                maxTemplates: 3,
                maxRules: 2,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                showBranding: true,
                prioritySupport: false,
                trialDays: 30,
                isActive: true,
                isDefault: true,
                sortOrder: 0,
            },
            {
                id: 'plan_business',
                name: 'Business',
                slug: 'business',
                description: 'For growing businesses',
                price: 2500,
                currency: 'USD',
                interval: 'month',
                maxPages: 3,
                maxAiRepliesPerMonth: 1500,
                maxTemplates: null,
                maxRules: null,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                showBranding: false,
                prioritySupport: false,
                trialDays: 0,
                isActive: true,
                isDefault: false,
                sortOrder: 2,
            },
        ]),
        getAllPlans: vi.fn().mockResolvedValue([
            { id: 'plan_free', name: 'Free', isActive: true },
            { id: 'plan_inactive', name: 'Old Plan', isActive: false },
        ]),
        getPlanById: vi.fn().mockImplementation((id) => {
            if (id === 'plan_free') {
                return Promise.resolve({
                    id: 'plan_free',
                    name: 'Free Trial',
                    slug: 'free',
                    price: 0,
                });
            }
            return Promise.resolve(null);
        }),
        createPlan: vi.fn().mockResolvedValue({
            id: 'new_plan_123',
            name: 'New Plan',
            slug: 'new-plan',
            price: 1000,
        }),
        updatePlan: vi.fn().mockImplementation((id, data) => {
            if (id === 'plan_free') {
                return Promise.resolve({ id: 'plan_free', ...data });
            }
            return Promise.resolve(null);
        }),
        deletePlan: vi.fn().mockImplementation((id) => {
            return Promise.resolve(id === 'plan_free');
        }),
        setDefaultPlan: vi.fn().mockImplementation((id) => {
            return Promise.resolve(id === 'plan_free');
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

describe('Plans Routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(plansRoutes, { prefix: '/api/plans' });
        await app.ready();
    });

    describe('GET /api/plans', () => {
        it('should return all active plans', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/plans',
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toBeInstanceOf(Array);
            expect(body.data.length).toBe(2);
            expect(body.data[0].name).toBe('Free Trial');
        });
    });

    describe('GET /api/plans/:planId', () => {
        it('should return plan by ID', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/plans/plan_free',
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.id).toBe('plan_free');
            expect(body.data.name).toBe('Free Trial');
        });

        it('should return 404 for non-existent plan', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/plans/non_existent',
            });

            expect(response.statusCode).toBe(404);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('Plan not found');
        });
    });

    describe('Admin Routes', () => {
        describe('GET /api/plans/admin/all', () => {
            it('should return all plans including inactive (authenticated)', async () => {
                const response = await app.inject({
                    method: 'GET',
                    url: '/api/plans/admin/all',
                    headers: {
                        authorization: 'Bearer test_token',
                    },
                });

                expect(response.statusCode).toBe(200);
                
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);
                expect(body.data.length).toBe(2);
            });
        });

        describe('POST /api/plans/admin', () => {
            it('should create a new plan (authenticated)', async () => {
                const response = await app.inject({
                    method: 'POST',
                    url: '/api/plans/admin',
                    headers: {
                        authorization: 'Bearer test_token',
                        'content-type': 'application/json',
                    },
                    payload: {
                        name: 'New Plan',
                        slug: 'new-plan',
                        price: 1000,
                    },
                });

                expect(response.statusCode).toBe(201);
                
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);
                expect(body.data.name).toBe('New Plan');
            });
        });

        describe('PUT /api/plans/admin/:planId', () => {
            it('should update an existing plan', async () => {
                const response = await app.inject({
                    method: 'PUT',
                    url: '/api/plans/admin/plan_free',
                    headers: {
                        authorization: 'Bearer test_token',
                        'content-type': 'application/json',
                    },
                    payload: {
                        price: 500,
                    },
                });

                expect(response.statusCode).toBe(200);
                
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);
            });

            it('should return 404 for non-existent plan', async () => {
                const response = await app.inject({
                    method: 'PUT',
                    url: '/api/plans/admin/non_existent',
                    headers: {
                        authorization: 'Bearer test_token',
                        'content-type': 'application/json',
                    },
                    payload: {
                        price: 500,
                    },
                });

                expect(response.statusCode).toBe(404);
            });
        });

        describe('DELETE /api/plans/admin/:planId', () => {
            it('should soft delete a plan', async () => {
                const response = await app.inject({
                    method: 'DELETE',
                    url: '/api/plans/admin/plan_free',
                    headers: {
                        authorization: 'Bearer test_token',
                    },
                });

                expect(response.statusCode).toBe(200);
                
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);
                expect(body.message).toBe('Plan deleted successfully');
            });
        });

        describe('POST /api/plans/admin/:planId/set-default', () => {
            it('should set plan as default', async () => {
                const response = await app.inject({
                    method: 'POST',
                    url: '/api/plans/admin/plan_free/set-default',
                    headers: {
                        authorization: 'Bearer test_token',
                    },
                });

                expect(response.statusCode).toBe(200);
                
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);
                expect(body.message).toBe('Default plan updated');
            });
        });
    });
});

