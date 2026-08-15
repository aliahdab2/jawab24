import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import plansRoutes from '../../src/routes/plans';

// Test UUIDs for consistent testing
const TEST_PLAN_FREE_ID = '11111111-1111-1111-1111-111111111111';
const TEST_PLAN_BUSINESS_ID = '22222222-2222-2222-2222-222222222222';
const TEST_PLAN_INACTIVE_ID = '33333333-3333-3333-3333-333333333333';
const TEST_PLAN_NEW_ID = '44444444-4444-4444-4444-444444444444';
const NON_EXISTENT_UUID = '99999999-9999-9999-9999-999999999999';

// Mock the plans service
vi.mock('../../src/services/plans', () => ({
    plansService: {
        getActivePlans: vi.fn().mockResolvedValue([
            {
                id: '11111111-1111-1111-1111-111111111111',
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
                prioritySupport: false,
                trialDays: 30,
                isActive: true,
                isDefault: true,
                sortOrder: 0,
            },
            {
                id: '22222222-2222-2222-2222-222222222222',
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
                prioritySupport: false,
                trialDays: 0,
                isActive: true,
                isDefault: false,
                sortOrder: 2,
            },
        ]),
        getAllPlans: vi.fn().mockResolvedValue([
            { id: '11111111-1111-1111-1111-111111111111', name: 'Free', isActive: true },
            { id: '33333333-3333-3333-3333-333333333333', name: 'Old Plan', isActive: false },
        ]),
        getPlanById: vi.fn().mockImplementation((id) => {
            if (id === '11111111-1111-1111-1111-111111111111') {
                return Promise.resolve({
                    id: '11111111-1111-1111-1111-111111111111',
                    name: 'Free Trial',
                    slug: 'free',
                    price: 0,
                });
            }
            return Promise.resolve(null);
        }),
        createPlan: vi.fn().mockResolvedValue({
            id: '44444444-4444-4444-4444-444444444444',
            name: 'New Plan',
            slug: 'new-plan',
            price: 1000,
        }),
        updatePlan: vi.fn().mockImplementation((id, data) => {
            if (id === '11111111-1111-1111-1111-111111111111') {
                return Promise.resolve({ id: '11111111-1111-1111-1111-111111111111', ...data });
            }
            return Promise.resolve(null);
        }),
        deletePlan: vi.fn().mockImplementation((id) => {
            return Promise.resolve(id === '11111111-1111-1111-1111-111111111111');
        }),
        setDefaultPlan: vi.fn().mockImplementation((id) => {
            return Promise.resolve(id === '11111111-1111-1111-1111-111111111111');
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

// Mock admin middleware - allow all authenticated users to be admins in tests
vi.mock('../../src/middleware/admin', () => ({
    requireAdmin: vi.fn(async (request, reply) => {
        // In tests, we allow all authenticated users to pass admin check
        if (!request.user) {
            return reply.status(401).send({
                error: true,
                message: 'Authentication required',
                code: 'AUTH_REQUIRED',
            });
        }
        // Pass through - user is admin in tests
    }),
    isUserAdmin: vi.fn().mockResolvedValue(true),
}));

// Mock revalidation so admin write paths don't make real network calls.
vi.mock('../../src/services/revalidation', () => ({
    revalidatePublicPages: vi.fn().mockResolvedValue(undefined),
    revalidatePlanPages: vi.fn().mockResolvedValue(undefined),
    PLAN_DEPENDENT_PATHS: ['/pricing', '/en/pricing'],
}));

import { revalidatePlanPages } from '../../src/services/revalidation';

describe('Plans Routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.mocked(revalidatePlanPages).mockClear();
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
                url: `/api/plans/${TEST_PLAN_FREE_ID}`,
            });

            expect(response.statusCode).toBe(200);
            
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.id).toBe(TEST_PLAN_FREE_ID);
            expect(body.data.name).toBe('Free Trial');
        });

        it('should return 404 for non-existent plan', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/plans/${NON_EXISTENT_UUID}`,
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

            it('triggers ISR revalidation of pricing pages on create', async () => {
                await app.inject({
                    method: 'POST',
                    url: '/api/plans/admin',
                    headers: {
                        authorization: 'Bearer test_token',
                        'content-type': 'application/json',
                    },
                    payload: { name: 'New Plan', slug: 'new-plan', price: 1000 },
                });
                expect(revalidatePlanPages).toHaveBeenCalled();
            });
        });

        describe('PUT /api/plans/admin/:planId', () => {
            it('should update an existing plan', async () => {
                const response = await app.inject({
                    method: 'PUT',
                    url: `/api/plans/admin/${TEST_PLAN_FREE_ID}`,
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
                    url: `/api/plans/admin/${NON_EXISTENT_UUID}`,
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

            it('triggers ISR revalidation on successful update', async () => {
                await app.inject({
                    method: 'PUT',
                    url: `/api/plans/admin/${TEST_PLAN_FREE_ID}`,
                    headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                    payload: { price: 500 },
                });
                expect(revalidatePlanPages).toHaveBeenCalled();
            });

            it('does not revalidate when the plan is not found', async () => {
                await app.inject({
                    method: 'PUT',
                    url: `/api/plans/admin/${NON_EXISTENT_UUID}`,
                    headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                    payload: { price: 500 },
                });
                expect(revalidatePlanPages).not.toHaveBeenCalled();
            });
        });

        describe('DELETE /api/plans/admin/:planId', () => {
            it('should soft delete a plan', async () => {
                const response = await app.inject({
                    method: 'DELETE',
                    url: `/api/plans/admin/${TEST_PLAN_FREE_ID}`,
                    headers: {
                        authorization: 'Bearer test_token',
                    },
                });

                expect(response.statusCode).toBe(200);
                
                const body = JSON.parse(response.payload);
                expect(body.success).toBe(true);
                expect(body.message).toBe('Plan deleted successfully');
            });

            it('triggers ISR revalidation on successful delete', async () => {
                await app.inject({
                    method: 'DELETE',
                    url: `/api/plans/admin/${TEST_PLAN_FREE_ID}`,
                    headers: { authorization: 'Bearer test_token' },
                });
                expect(revalidatePlanPages).toHaveBeenCalled();
            });
        });

        describe('POST /api/plans/admin/:planId/set-default', () => {
            it('should set plan as default', async () => {
                const response = await app.inject({
                    method: 'POST',
                    url: `/api/plans/admin/${TEST_PLAN_FREE_ID}/set-default`,
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

