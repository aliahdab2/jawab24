import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import adminRoutes from '../../src/routes/admin';

// Test UUIDs
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_PLAN_ID = '22222222-2222-2222-2222-222222222222';
const NONEXISTENT_UUID = '99999999-9999-9999-9999-999999999999';

// Mock middleware
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async (req: any) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            const err: any = new Error('Unauthorized');
            err.statusCode = 401;
            throw err;
        }
        req.user = { userId: 'admin-user-id', role: 'admin' };
    }),
    requireAdmin: vi.fn(async (req: any) => {
        if (!req.user || req.user.role !== 'admin') {
            const err: any = new Error('Forbidden');
            err.statusCode = 403;
            throw err;
        }
    }),
    AuthenticatedRequest: {},
}));

// Chainable mock factory for db.select()
function createMockChain() {
    return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
    };
}

vi.mock('../../src/db', () => {
    const chain = () => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
    });
    return {
        db: {
            select: vi.fn().mockReturnValue(chain()),
            insert: vi.fn().mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            }),
            update: vi.fn().mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([]),
                    }),
                }),
            }),
        },
    };
});

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    ilike: vi.fn(),
    desc: vi.fn(),
    and: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    sql: Object.assign(vi.fn(), {
        // tagged-template usage in admin.ts uses sql`...`
        raw: vi.fn(),
    }),
    isNotNull: vi.fn(),
    isNull: vi.fn(),
    inArray: vi.fn(),
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email', name: 'name', facebookId: 'facebookId', createdAt: 'createdAt' },
    subscriptions: { id: 'id', userId: 'userId', status: 'status', planId: 'planId', currentPeriodStart: 'cps', currentPeriodEnd: 'cpe', paymentMethod: 'pm', trialEndsAt: 'te' },
    plans: { id: 'id', name: 'name', slug: 'slug', price: 'price', isActive: 'isActive', sortOrder: 'sortOrder', maxAiRepliesPerMonth: 'max_ai', maxPages: 'max_pages' },
    adminAuditLogs: { id: 'id', action: 'action', previousValue: 'pv', newValue: 'nv', paymentReference: 'pr', note: 'note', createdAt: 'createdAt', adminUserId: 'adminUserId', targetUserId: 'targetUserId' },
    pages: { id: 'id', userId: 'userId', name: 'name', workspaceId: 'workspaceId', knowledgeBase: 'kb', kbVersion: 'kbv', kbActiveVersion: 'kbav', kbUpdatedAt: 'kbua' },
    usage: { userId: 'userId', aiRepliesCount: 'airc', periodStart: 'ps', periodEnd: 'pe' },
    posts: { pageId: 'pageId', triggerReply: 'triggerReply' },
    instagramMedia: { pageId: 'pageId', triggerReply: 'triggerReply' },
    kbChunks: { pageId: 'pageId', kbVersion: 'kbVersion' },
    kbGaps: { id: 'id', pageId: 'pageId', queryText: 'qt', detectedIntent: 'di', occurrenceCount: 'oc', firstSeenAt: 'fsa', lastSeenAt: 'lsa', resolved: 'resolved' },
    workspaceMembers: { workspaceId: 'workspaceId', userId: 'userId', role: 'role' },
    leads: { id: 'id', pageId: 'pageId', status: 'status', createdAt: 'createdAt' },
}));

vi.mock('../../src/config', () => ({
    config: {
        ragMode: 'on',
        openai: { apiKey: 'test-key' },
        redis: { host: 'localhost', port: 6379, password: undefined },
        facebook: { graphApiVersion: 'v18.0' },
    },
}));

vi.mock('../../src/services/ai', () => ({
    aiService: { generateReply: vi.fn().mockResolvedValue({ reply: 'test reply', language: 'en', cached: false }) },
}));

vi.mock('../../src/services/kb/retrieval', () => ({
    RetrievalService: vi.fn().mockImplementation(() => ({
        retrieve: vi.fn().mockResolvedValue({ chunks: [], queryEmbedding: [] }),
    })),
}));

vi.mock('../../src/services/kb/embedding', () => ({
    OpenAIEmbeddingProvider: vi.fn(),
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        initializeUsagePeriod: vi.fn().mockResolvedValue(undefined),
        invalidateStatusCache: vi.fn().mockResolvedValue(undefined),
    },
    ACTIVE_STATUSES: new Set(['active', 'trialing']),
}));

vi.mock('../../src/services/kb/gap-detector', () => ({
    gapDetectorService: { recordGap: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/reply/generator', () => ({
    shouldSkipReply: vi.fn().mockReturnValue(false),
    shouldUseFallback: vi.fn().mockReturnValue(false),
    PRICE_FALLBACK: { ar: 'price fallback ar', en: 'price fallback en' },
    replyGenerator: {
        setLogger: vi.fn(),
        generateForPlayground: vi.fn().mockResolvedValue({
            reply: 'AI test reply',
            replyMethod: 'ai',
            ragMode: 'off',
            chunksRetrieved: 0,
            chunks: [],
            intent: 'QUESTION',
            confidence: 'high',
            flags: [],
            needsAttention: false,
            cached: false,
            detectedLanguage: 'en',
            tokensUsed: 100,
            model: 'gpt-4.1-mini',
            gapRecorded: false,
        }),
    },
}));

vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn().mockResolvedValue({
            commentReplyMode: 'public',
            dualReplyNudge: null,
        }),
    },
}));

vi.mock('../../src/utils/swagger', () => ({
    auth: [{ bearerAuth: [] }],
}));

describe('Admin Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.resetAllMocks();

        // Re-apply default mock implementations after reset
        const { authenticate, requireAdmin } = await import('../../src/middleware/auth');
        vi.mocked(authenticate).mockImplementation(async (req: any) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                const err: any = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }
            req.user = { userId: 'admin-user-id', role: 'admin' };
        });
        vi.mocked(requireAdmin).mockImplementation(async (req: any) => {
            if (!req.user || req.user.role !== 'admin') {
                const err: any = new Error('Forbidden');
                err.statusCode = 403;
                throw err;
            }
        });

        // Re-apply default db mock implementations after reset
        const { db } = await import('../../src/db');
        vi.mocked(db.select).mockReturnValue(createMockChain() as any);
        vi.mocked(db.insert).mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
            }),
        } as any);
        vi.mocked(db.update).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([]),
                }),
            }),
        } as any);

        app = fastify();
        app.register(adminRoutes, { prefix: '/admin' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    // ---------------------------------------------------------------
    // 1. Authentication: 401 without auth header
    // ---------------------------------------------------------------
    describe('Authentication', () => {
        it('GET /admin/users/all returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/users/all',
            });

            expect(response.statusCode).toBe(401);
        });

        it('GET /admin/users returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/users?email=test@example.com',
            });

            expect(response.statusCode).toBe(401);
        });

        it('GET /admin/plans returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/plans',
            });

            expect(response.statusCode).toBe(401);
        });

        it('GET /admin/audit-logs returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/audit-logs',
            });

            expect(response.statusCode).toBe(401);
        });

        it('POST /admin/users/:userId/upgrade returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: { 'content-type': 'application/json' },
                payload: { planId: TEST_PLAN_ID, periodMonths: 1, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(401);
        });

        it('GET /admin/users/:userId returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/admin/users/${TEST_USER_ID}`,
            });

            expect(response.statusCode).toBe(401);
        });
    });

    // ---------------------------------------------------------------
    // 2. Authorization: 403 for non-admin users
    // ---------------------------------------------------------------
    describe('Authorization', () => {
        beforeEach(async () => {
            const { authenticate } = await import('../../src/middleware/auth');
            vi.mocked(authenticate).mockImplementation(async (req: any) => {
                const authHeader = req.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    const err: any = new Error('Unauthorized');
                    err.statusCode = 401;
                    throw err;
                }
                // Set role to 'user' instead of 'admin'
                req.user = { userId: 'regular-user-id', role: 'user' };
            });
        });

        it('GET /admin/users/all returns 403 for non-admin user', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/users/all',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(403);
        });

        it('POST /admin/users/:userId/upgrade returns 403 for non-admin user', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: TEST_PLAN_ID, periodMonths: 1, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(403);
        });

        it('GET /admin/plans returns 403 for non-admin user', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/plans',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    // ---------------------------------------------------------------
    // 3. GET /admin/users?email=ab returns 400 (min 3 chars)
    // ---------------------------------------------------------------
    describe('GET /admin/users - search users by email', () => {
        it('returns 400 when email query is shorter than 3 characters', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/users?email=ab',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('Email query required (min 3 characters)');
        });

        it('returns 400 when email query is missing', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/users',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
        });

        // ---------------------------------------------------------------
        // 4. GET /admin/users?email=test@example.com returns results
        // ---------------------------------------------------------------
        it('returns matching users when email query is valid', async () => {
            const { db } = await import('../../src/db');

            // First select call: search users by email
            const userSearchChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    { id: TEST_USER_ID, email: 'test@example.com', name: 'Test User', facebookId: 'fb-1', createdAt: '2025-01-01' },
                ]),
            };

            // Second select call: get subscription for found user
            const subscriptionChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    { id: 'sub-1', status: 'active', planId: TEST_PLAN_ID, planName: 'Pro', planSlug: 'pro', currentPeriodStart: '2025-01-01', currentPeriodEnd: '2025-02-01', paymentMethod: 'manual' },
                ]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userSearchChain as any)
                .mockReturnValueOnce(subscriptionChain as any);

            const response = await app.inject({
                method: 'GET',
                url: '/admin/users?email=test@example.com',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(1);
            expect(body.data[0].email).toBe('test@example.com');
            expect(body.data[0].subscription).toBeDefined();
            expect(body.data[0].subscription.status).toBe('active');
            expect(body.count).toBe(1);
        });

        it('returns empty array when no users match', async () => {
            const { db } = await import('../../src/db');

            const emptyChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select).mockReturnValue(emptyChain as any);

            const response = await app.inject({
                method: 'GET',
                url: '/admin/users?email=nonexistent@test.com',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(0);
            expect(body.count).toBe(0);
        });
    });

    // ---------------------------------------------------------------
    // 5. POST /admin/users/:userId/upgrade - validation
    // ---------------------------------------------------------------
    describe('POST /admin/users/:userId/upgrade', () => {
        it('returns 400 when required fields are missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: {},
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('planId, periodMonths, and paymentMethod are required');
        });

        it('returns 400 when planId is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { periodMonths: 1, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('planId, periodMonths, and paymentMethod are required');
        });

        it('returns 400 when periodMonths is invalid', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: TEST_PLAN_ID, periodMonths: 5, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('periodMonths must be 1, 3, 6, or 12');
        });

        it('returns 404 when user does not exist', async () => {
            const { db } = await import('../../src/db');

            // User lookup returns empty
            const userChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select).mockReturnValue(userChain as any);

            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${NONEXISTENT_UUID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: TEST_PLAN_ID, periodMonths: 1, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('User not found');
        });

        it('returns 404 when plan does not exist', async () => {
            const { db } = await import('../../src/db');

            // First select: user found; second select: plan not found
            const userFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID, email: 'user@test.com' }]),
            };

            const planNotFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userFoundChain as any)
                .mockReturnValueOnce(planNotFoundChain as any);

            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: NONEXISTENT_UUID, periodMonths: 1, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('Plan not found');
        });

        it('creates a new subscription when user has no existing subscription', async () => {
            const { db } = await import('../../src/db');

            // First select: user found
            const userFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID, email: 'user@test.com' }]),
            };

            // Second select: plan found
            const planFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_PLAN_ID, name: 'Pro', slug: 'pro' }]),
            };

            // Third select: no existing subscription
            const noSubChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userFoundChain as any)
                .mockReturnValueOnce(planFoundChain as any)
                .mockReturnValueOnce(noSubChain as any);

            // Insert for new subscription - db.insert is called twice:
            // 1. Insert subscription, 2. Insert audit log
            const newSub = { id: 'sub-new', userId: TEST_USER_ID, planId: TEST_PLAN_ID, status: 'active' };
            const insertSubValues = vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([newSub]),
            });
            const insertAuditValues = vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
            });

            vi.mocked(db.insert)
                .mockReturnValueOnce({ values: insertSubValues } as any)
                .mockReturnValueOnce({ values: insertAuditValues } as any);

            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: TEST_PLAN_ID, periodMonths: 1, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.message).toContain('Pro');
            expect(body.message).toContain('1 month(s)');
            expect(body.data.plan.name).toBe('Pro');
        });

        // Regression guard: manual upgrade must reset the usage period so the
        // customer immediately gets their fresh quota. Without this call the
        // previous period's usage row keeps blocking replies after renewal.
        it('resets the usage period on successful manual upgrade', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            const userFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID, email: 'user@test.com' }]),
            };
            const planFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_PLAN_ID, name: 'Pro', slug: 'pro' }]),
            };
            const existingSubChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{
                    id: 'sub-existing',
                    userId: TEST_USER_ID,
                    planId: TEST_PLAN_ID,
                    status: 'past_due',
                    paymentMethod: 'manual',
                    currentPeriodEnd: new Date('2026-04-01'),
                }]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userFoundChain as any)
                .mockReturnValueOnce(planFoundChain as any)
                .mockReturnValueOnce(existingSubChain as any);

            const updatedSub = { id: 'sub-existing', userId: TEST_USER_ID, planId: TEST_PLAN_ID, status: 'active' };
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([updatedSub]),
                    }),
                }),
            } as any);

            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: TEST_PLAN_ID, periodMonths: 3, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(200);
            expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledTimes(1);

            const [calledUserId, calledStart, calledEnd] = vi.mocked(subscriptionsService.initializeUsagePeriod).mock.calls[0];
            expect(calledUserId).toBe(TEST_USER_ID);
            expect(calledStart).toBeInstanceOf(Date);
            expect(calledEnd).toBeInstanceOf(Date);
            // periodEnd must be roughly 3 months after periodStart
            const monthsDiff =
                (calledEnd.getFullYear() - calledStart.getFullYear()) * 12 +
                (calledEnd.getMonth() - calledStart.getMonth());
            expect(monthsDiff).toBe(3);
        });

        // P1.5 behavior: when the customer already has an active subscription,
        // the admin "upgrade" is a plan change within an ongoing billing period.
        // Industry best practice — and the rule the Stripe-side path already
        // follows — is to carry the quota forward and keep the existing renewal
        // date. The manual path used to always reset; this regression guard
        // pins the corrected behavior.
        it('PRESERVES quota and period when the customer has an ACTIVE subscription (plan change)', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            const existingPeriodStart = new Date('2026-05-13T22:41:00Z');
            const existingPeriodEnd = new Date('2026-06-13T22:41:00Z');

            const userFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID, email: 'user@test.com' }]),
            };
            const planFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_PLAN_ID, name: 'Pro', slug: 'pro' }]),
            };
            const existingActiveSubChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{
                    id: 'sub-existing',
                    userId: TEST_USER_ID,
                    planId: 'plan-starter',
                    status: 'active',
                    paymentMethod: 'stripe',
                    currentPeriodStart: existingPeriodStart,
                    currentPeriodEnd: existingPeriodEnd,
                }]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userFoundChain as any)
                .mockReturnValueOnce(planFoundChain as any)
                .mockReturnValueOnce(existingActiveSubChain as any);

            const updateSetSpy = vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 'sub-existing',
                        userId: TEST_USER_ID,
                        planId: TEST_PLAN_ID,
                        status: 'active',
                    }]),
                }),
            });
            vi.mocked(db.update).mockReturnValue({ set: updateSetSpy } as any);

            const auditInsertValues = vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
            });
            vi.mocked(db.insert).mockReturnValue({ values: auditInsertValues } as any);

            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: TEST_PLAN_ID, periodMonths: 1, paymentMethod: 'stripe' },
            });

            expect(response.statusCode).toBe(200);

            // CRITICAL: initializeUsagePeriod must NOT have been called on an
            // active-sub plan change. Resetting the counter mid-period would
            // give the customer more than they paid for.
            expect(subscriptionsService.initializeUsagePeriod).not.toHaveBeenCalled();

            // The subscription update must keep the existing period.
            const updateSetArg = updateSetSpy.mock.calls[0][0];
            expect(updateSetArg.currentPeriodStart).toEqual(existingPeriodStart);
            expect(updateSetArg.currentPeriodEnd).toEqual(existingPeriodEnd);
            expect(updateSetArg.planId).toBe(TEST_PLAN_ID);

            // Audit log must record this as a plan change, not a new subscription.
            const auditPayload = auditInsertValues.mock.calls[0][0];
            expect(auditPayload.action).toBe('manual_plan_change');
            expect(auditPayload.newValue.quotaCarriedOver).toBe(true);

            // Response must surface the flag so the admin UI can show it.
            const body = JSON.parse(response.payload);
            expect(body.data.quotaCarriedOver).toBe(true);
        });

        it('RESETS quota and starts a new period when there is no active subscription (new subscription)', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            const userFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID, email: 'user@test.com' }]),
            };
            const planFoundChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_PLAN_ID, name: 'Pro', slug: 'pro' }]),
            };
            const noExistingSubChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userFoundChain as any)
                .mockReturnValueOnce(planFoundChain as any)
                .mockReturnValueOnce(noExistingSubChain as any);

            const insertSubValues = vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 'sub-new',
                    userId: TEST_USER_ID,
                    planId: TEST_PLAN_ID,
                    status: 'active',
                }]),
            });
            const auditInsertValues = vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
            });
            vi.mocked(db.insert)
                .mockReturnValueOnce({ values: insertSubValues } as any)
                .mockReturnValueOnce({ values: auditInsertValues } as any);

            const response = await app.inject({
                method: 'POST',
                url: `/admin/users/${TEST_USER_ID}/upgrade`,
                headers: {
                    authorization: 'Bearer valid-token',
                    'content-type': 'application/json',
                },
                payload: { planId: TEST_PLAN_ID, periodMonths: 1, paymentMethod: 'manual' },
            });

            expect(response.statusCode).toBe(200);
            expect(subscriptionsService.initializeUsagePeriod).toHaveBeenCalledTimes(1);

            const auditPayload = auditInsertValues.mock.calls[0][0];
            expect(auditPayload.action).toBe('manual_new_subscription');
            expect(auditPayload.newValue.quotaCarriedOver).toBe(false);

            const body = JSON.parse(response.payload);
            expect(body.data.quotaCarriedOver).toBe(false);
        });
    });

    // ---------------------------------------------------------------
    // 6. GET /admin/plans - list all plans
    // ---------------------------------------------------------------
    describe('GET /admin/plans', () => {
        it('returns list of plans', async () => {
            const { db } = await import('../../src/db');

            const plansChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockResolvedValue([
                    { id: 'plan-1', name: 'Free', slug: 'free', price: 0, isActive: true },
                    { id: 'plan-2', name: 'Pro', slug: 'pro', price: 2500, isActive: true },
                    { id: 'plan-3', name: 'Business', slug: 'business', price: 5000, isActive: true },
                ]),
                limit: vi.fn().mockReturnThis(),
            };

            vi.mocked(db.select).mockReturnValue(plansChain as any);

            const response = await app.inject({
                method: 'GET',
                url: '/admin/plans',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(3);
            expect(body.data[0].name).toBe('Free');
            expect(body.data[1].name).toBe('Pro');
            expect(body.data[2].name).toBe('Business');
        });

        it('returns empty array when no plans exist', async () => {
            const { db } = await import('../../src/db');

            const emptyChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockResolvedValue([]),
                limit: vi.fn().mockReturnThis(),
            };

            vi.mocked(db.select).mockReturnValue(emptyChain as any);

            const response = await app.inject({
                method: 'GET',
                url: '/admin/plans',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(0);
        });
    });

    // ---------------------------------------------------------------
    // 7. GET /admin/users/all - list all users with pagination
    // ---------------------------------------------------------------
    describe('GET /admin/users/all', () => {
        it('returns paginated list of users', async () => {
            const { db } = await import('../../src/db');

            const usersChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    {
                        id: 'user-1', email: 'user1@test.com', name: 'User 1', facebookId: 'fb-1', createdAt: '2025-01-01',
                        subscriptionId: 'sub-1', subscriptionStatus: 'active', planId: 'plan-1',
                        planName: 'Pro', planSlug: 'pro', currentPeriodStart: '2025-01-01',
                        currentPeriodEnd: '2025-02-01', paymentMethod: 'manual',
                    },
                    {
                        id: 'user-2', email: 'user2@test.com', name: 'User 2', facebookId: 'fb-2', createdAt: '2025-01-02',
                        subscriptionId: null, subscriptionStatus: null, planId: null,
                        planName: null, planSlug: null, currentPeriodStart: null,
                        currentPeriodEnd: null, paymentMethod: null,
                    },
                ]),
            };

            vi.mocked(db.select).mockReturnValue(usersChain as any);

            const response = await app.inject({
                method: 'GET',
                url: '/admin/users/all?page=1&limit=20',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(2);
            expect(body.pagination).toBeDefined();
            expect(body.pagination.page).toBe(1);
            expect(body.pagination.limit).toBe(20);
            expect(body.pagination.total).toBe(2);

            // First user has subscription
            expect(body.data[0].subscription).not.toBeNull();
            expect(body.data[0].subscription.status).toBe('active');

            // Second user has no subscription
            expect(body.data[1].subscription).toBeNull();
        });
    });

    // ---------------------------------------------------------------
    // 8. GET /admin/users/:userId - get user details
    // ---------------------------------------------------------------
    describe('GET /admin/users/:userId', () => {
        it('returns user details with subscription, pages, and usage', async () => {
            const { db } = await import('../../src/db');

            // First select: user found
            const userChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    { id: TEST_USER_ID, email: 'user@test.com', name: 'Test User', facebookId: 'fb-1', createdAt: '2025-01-01' },
                ]),
            };

            // Second select: subscription with plan
            const subChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    {
                        id: 'sub-1', status: 'active', planId: TEST_PLAN_ID, planName: 'Pro', planSlug: 'pro',
                        currentPeriodStart: '2025-01-01', currentPeriodEnd: '2025-02-01',
                        paymentMethod: 'manual', trialEndsAt: null, maxAiRepliesPerMonth: 1000, maxPages: 5,
                    },
                ]),
            };

            // Third select: pages
            const pagesChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ id: 'page-1' }, { id: 'page-2' }]),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
            };

            // Fourth select: usage
            const usageChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    { aiRepliesCount: 42, periodStart: '2025-01-01', periodEnd: '2025-02-01' },
                ]),
            };

            // Fifth + sixth selects: post replies count (FB posts + IG media)
            const fbPostsChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 4 }]),
            };
            const igMediaChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 6 }]),
            };

            // Seventh + eighth: lead stats — workspace memberships + owned pages.
            // Empty owned-page set short-circuits the leads aggregation query.
            const workspaceMembersChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([]),
            };
            const ownedPagesChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userChain as any)
                .mockReturnValueOnce(subChain as any)
                .mockReturnValueOnce(pagesChain as any)
                .mockReturnValueOnce(usageChain as any)
                .mockReturnValueOnce(fbPostsChain as any)
                .mockReturnValueOnce(igMediaChain as any)
                .mockReturnValueOnce(workspaceMembersChain as any)
                .mockReturnValueOnce(ownedPagesChain as any);

            const response = await app.inject({
                method: 'GET',
                url: `/admin/users/${TEST_USER_ID}`,
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data.email).toBe('user@test.com');
            expect(body.data.subscription).not.toBeNull();
            expect(body.data.subscription.status).toBe('active');
            expect(body.data.pages).toHaveLength(2);
            expect(body.data.usage.aiRepliesCount).toBe(42);
            expect(body.data.usage.postRepliesCount).toBe(10);
            expect(body.data.usage.limit).toBe(1000);
        });

        it('returns 404 when user does not exist', async () => {
            const { db } = await import('../../src/db');

            const emptyChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select).mockReturnValue(emptyChain as any);

            const response = await app.inject({
                method: 'GET',
                url: `/admin/users/${NONEXISTENT_UUID}`,
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('User not found');
        });
    });

    // ---------------------------------------------------------------
    // 9. GET /admin/audit-logs - view audit logs
    // ---------------------------------------------------------------
    describe('GET /admin/audit-logs', () => {
        it('returns list of audit logs', async () => {
            const { db } = await import('../../src/db');

            const logsChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    {
                        id: 'log-1', action: 'manual_upgrade',
                        previousValue: null, newValue: { planId: TEST_PLAN_ID, status: 'active' },
                        paymentReference: 'REF-001', note: 'First upgrade',
                        createdAt: '2025-01-15', adminEmail: 'admin@test.com',
                    },
                ]),
            };

            vi.mocked(db.select).mockReturnValue(logsChain as any);

            const response = await app.inject({
                method: 'GET',
                url: '/admin/audit-logs',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(1);
            expect(body.data[0].action).toBe('manual_upgrade');
            expect(body.data[0].adminEmail).toBe('admin@test.com');
        });
    });

    // ---------------------------------------------------------------
    // 10. POST /admin/ai/playground - test AI reply generation
    // ---------------------------------------------------------------
    describe('POST /admin/ai/playground', () => {
        const authHeaders = {
            authorization: 'Bearer valid-token',
            'content-type': 'application/json',
        };

        const TEST_PAGE = {
            id: 'page-1',
            name: 'Test Page',
            userId: 'user-1',
            workspaceId: 'ws-1',
            knowledgeBase: 'Some KB text',
            kbActiveVersion: 3,
        };

        /** Set up mocks so the AI path runs (page found, no template match). */
        async function setupAiPath(pageOverrides?: Partial<typeof TEST_PAGE>) {
            const { db } = await import('../../src/db');
            const { replyGenerator } = await import('../../src/services/reply/generator');
            const { settingsService } = await import('../../src/services/settings');

            const page = { ...TEST_PAGE, ...pageOverrides };

            // First db.select: page lookup
            const pageChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([page]),
            };
            vi.mocked(db.select).mockReturnValueOnce(pageChain as any);

            vi.mocked(settingsService.getSettings).mockResolvedValue({
                commentReplyMode: 'public',
                dualReplyNudge: null,
            } as any);

            return { db, replyGenerator };
        }

        it('returns 400 when pageId or question is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: {},
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
            expect(body.error).toBe('pageId and question are required');
        });

        it('returns 404 for non-existent page', async () => {
            const { db } = await import('../../src/db');

            const emptyChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            vi.mocked(db.select).mockReturnValueOnce(emptyChain as any);

            const response = await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: { pageId: 'nonexistent', question: 'Hello', channel: 'comment' },
            });

            expect(response.statusCode).toBe(404);
        });

        it('passes postMessage to generateForPlayground when channel is comment', async () => {
            const { replyGenerator } = await setupAiPath();

            await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: { pageId: 'page-1', question: 'What is the price?', channel: 'comment', postMessage: 'New shoes on sale!' },
            });

            expect(replyGenerator.generateForPlayground).toHaveBeenCalledWith(
                expect.objectContaining({
                    postMessage: 'New shoes on sale!',
                }),
            );
        });

        it('omits postMessage from generateForPlayground when channel is dm', async () => {
            const { replyGenerator } = await setupAiPath();

            await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: { pageId: 'page-1', question: 'Hello', channel: 'dm', postMessage: 'Should be ignored' },
            });

            const callArg = vi.mocked(replyGenerator.generateForPlayground).mock.calls[0][0];
            expect(callArg).toBeDefined();
            expect(callArg.postMessage).toBeUndefined();
        });

        it('passes conversationHistory to generateForPlayground when channel is dm', async () => {
            const { replyGenerator } = await setupAiPath();
            const history = [
                { role: 'user' as const, content: 'Hi' },
                { role: 'assistant' as const, content: 'Hello!' },
            ];

            await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: { pageId: 'page-1', question: 'Follow up', channel: 'dm', conversationHistory: history },
            });

            expect(replyGenerator.generateForPlayground).toHaveBeenCalledWith(
                expect.objectContaining({
                    conversationHistory: history,
                }),
            );
        });

        it('omits conversationHistory from generateForPlayground when channel is comment', async () => {
            const { replyGenerator } = await setupAiPath();
            const history = [{ role: 'user' as const, content: 'Should be ignored' }];

            await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: { pageId: 'page-1', question: 'Hello', channel: 'comment', conversationHistory: history },
            });

            const callArg = vi.mocked(replyGenerator.generateForPlayground).mock.calls[0][0];
            expect(callArg).toBeDefined();
            expect(callArg.conversationHistory).toBeUndefined();
        });

        it('passes kbActiveVersion from page record to generateForPlayground', async () => {
            const { replyGenerator } = await setupAiPath({ kbActiveVersion: 7 });

            await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: { pageId: 'page-1', question: 'Hello', channel: 'comment' },
            });

            expect(replyGenerator.generateForPlayground).toHaveBeenCalledWith(
                expect.objectContaining({
                    kbActiveVersion: 7,
                }),
            );
        });
    });
});
