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
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockResolvedValue([]),
    };
}

vi.mock('../../src/db', () => {
    const chain = () => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue([]),
        limit: vi.fn().mockResolvedValue([]),
    });
    const dbMock: any = {
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
        // Transactions pass `db` itself as `tx` so existing select/insert mocks apply.
        transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(dbMock)),
    };
    return { db: dbMock };
});

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    ilike: vi.fn(),
    desc: vi.fn(),
    and: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    lt: vi.fn(),
    sql: Object.assign(vi.fn(), {
        // tagged-template usage in admin.ts uses sql`...`
        raw: vi.fn(),
        // sql.join(...) builds the workspace-id IN (...) fragment for lead stats
        join: vi.fn(),
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
    posts: { id: 'id', pageId: 'pageId', triggerReply: 'triggerReply' },
    instagramMedia: { id: 'id', pageId: 'pageId', triggerReply: 'triggerReply' },
    comments: { id: 'id', postId: 'postId', replied: 'replied', replyMethod: 'replyMethod' },
    instagramComments: { id: 'id', mediaId: 'mediaId', replied: 'replied', replyMethod: 'replyMethod' },
    messages: { id: 'id', pageId: 'pageId', direction: 'direction', replied: 'replied', replyMethod: 'replyMethod' },
    kbChunks: { pageId: 'pageId', kbVersion: 'kbVersion' },
    kbGaps: { id: 'id', pageId: 'pageId', queryText: 'qt', detectedIntent: 'di', occurrenceCount: 'oc', firstSeenAt: 'fsa', lastSeenAt: 'lsa', resolved: 'resolved' },
    workspaces: { id: 'id', name: 'name', ownerId: 'ownerId', createdAt: 'createdAt' },
    workspaceMembers: { workspaceId: 'workspaceId', userId: 'userId', role: 'role' },
    leads: { id: 'id', pageId: 'pageId', status: 'status', createdAt: 'createdAt' },
    settings: { id: 'id', userId: 'userId', aiModel: 'aiModel' },
    aiUsageLog: { userId: 'userId', pageId: 'pageId', pipeline: 'pipeline', model: 'model', cached: 'cached', tokensIn: 'tokensIn', cachedInputTokens: 'cachedInputTokens', tokensOut: 'tokensOut', costUsd: 'costUsd', createdAt: 'createdAt' },
}));

vi.mock('../../src/services/aiModelResolver', () => ({
    clearAiModelCache: vi.fn(),
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
        // getUserDetail asks the gate whether replies are actually flowing, so the
        // console can stop deriving that from `subscriptions.status`. The verdict's
        // own semantics are covered in subscriptionExpiry / adminHealth tests; here
        // it only has to exist so the route can render.
        checkSubscriptionStatus: vi.fn(() => ({ allowed: true })),
        // getUserDetail resolves the entitlement through the SAME accessor the reply
        // path uses (lazy expiry flip + active-first row ordering), not the raw row it
        // selected — evaluating the raw row reported a healthy account for an expired
        // Stripe subscription whose status had not been flipped yet.
        getUserSubscription: vi.fn().mockResolvedValue({
            id: 'sub-1', userId: 'user-1', status: 'active',
            paymentMethod: null, currentPeriodEnd: null, trialEndsAt: null,
        }),
    },
    resolveEntitlementEnd: vi.fn(() => null),
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

vi.mock('../../src/services/topup', () => ({
    topupService: {
        creditTopup: vi.fn().mockResolvedValue({ purchaseId: 'p1', repliesAdded: 5000, newBalance: 5000 }),
        resolvePendingStripeTopupsForCredit: vi.fn().mockResolvedValue({ blocking: [], cleared: [] }),
    },
    TopupUserNotFoundError: class TopupUserNotFoundError extends Error {},
    UnknownTopupPackError: class UnknownTopupPackError extends Error {},
    DuplicateTopupError: class DuplicateTopupError extends Error {},
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
        (db as any).transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));

        app = fastify();
        app.register(adminRoutes, { prefix: '/admin' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    // ---------------------------------------------------------------
    // POST /admin/topup — double-credit guard (finding 2)
    // ---------------------------------------------------------------
    describe('POST /admin/topup pending-Stripe guard', () => {
        const authHeaders = { authorization: 'Bearer admin-token' };

        it('blocks a manual credit (409) when a genuinely in-flight Stripe top-up remains after self-heal', async () => {
            const { topupService } = await import('../../src/services/topup');
            vi.mocked(topupService.resolvePendingStripeTopupsForCredit).mockResolvedValue({ blocking: ['pi_inflight'], cleared: [] });
            vi.mocked(topupService.creditTopup).mockResolvedValue({ purchaseId: 'p1', repliesAdded: 5000, newBalance: 5000 } as any);

            const response = await app.inject({
                method: 'POST', url: '/admin/topup', headers: authHeaders,
                payload: { userId: TEST_USER_ID, pack: '5k' },
            });

            expect(response.statusCode).toBe(409);
            expect(response.json().error).toBe('PENDING_STRIPE_TOPUP');
            expect(response.json().pendingPaymentIntentIds).toEqual(['pi_inflight']);
            // The whole point: it must NOT credit while a capturable payment exists.
            expect(topupService.creditTopup).not.toHaveBeenCalled();
        });

        it('credits when force=true even with a blocking Stripe top-up (explicit operator override skips the guard)', async () => {
            const { topupService } = await import('../../src/services/topup');
            vi.mocked(topupService.resolvePendingStripeTopupsForCredit).mockResolvedValue({ blocking: ['pi_inflight'], cleared: [] });
            vi.mocked(topupService.creditTopup).mockResolvedValue({ purchaseId: 'p1', repliesAdded: 5000, newBalance: 5000 } as any);

            const response = await app.inject({
                method: 'POST', url: '/admin/topup', headers: authHeaders,
                payload: { userId: TEST_USER_ID, pack: '5k', force: true },
            });

            expect(response.statusCode).toBe(200);
            // force bypasses the guard entirely — it must not even be consulted.
            expect(topupService.resolvePendingStripeTopupsForCredit).not.toHaveBeenCalled();
            expect(topupService.creditTopup).toHaveBeenCalledOnce();
        });

        it('credits normally when the guard self-heals all pending rows (clears abandoned, nothing blocking)', async () => {
            const { topupService } = await import('../../src/services/topup');
            // An abandoned checkout was auto-canceled (cleared) and nothing blocks —
            // the credit proceeds and the cancellation is audit-logged.
            vi.mocked(topupService.resolvePendingStripeTopupsForCredit).mockResolvedValue({ blocking: [], cleared: ['pi_abandoned'] });
            vi.mocked(topupService.creditTopup).mockResolvedValue({ purchaseId: 'p1', repliesAdded: 5000, newBalance: 5000 } as any);
            const { db } = await import('../../src/db');

            const response = await app.inject({
                method: 'POST', url: '/admin/topup', headers: authHeaders,
                payload: { userId: TEST_USER_ID, pack: '5k' },
            });

            expect(response.statusCode).toBe(200);
            expect(topupService.resolvePendingStripeTopupsForCredit).toHaveBeenCalledWith(TEST_USER_ID);
            expect(topupService.creditTopup).toHaveBeenCalledOnce();
            // The cleared cancellation + the credit each write an admin_audit_logs row.
            expect(db.insert).toHaveBeenCalledTimes(2);
        });
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

        it('GET /admin/ai-cost/consumption returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/ai-cost/consumption',
            });

            expect(response.statusCode).toBe(401);
        });

        it('GET /admin/ai-cost/billing returns 401 without authorization header', async () => {
            const response = await app.inject({ method: 'GET', url: '/admin/ai-cost/billing' });
            expect(response.statusCode).toBe(401);
        });

        it('GET /admin/ai-cost/reconciliation returns 401 without authorization header', async () => {
            const response = await app.inject({ method: 'GET', url: '/admin/ai-cost/reconciliation' });
            expect(response.statusCode).toBe(401);
        });

        it('GET /admin/ai-cost/runway returns 401 without authorization header', async () => {
            const response = await app.inject({ method: 'GET', url: '/admin/ai-cost/runway' });
            expect(response.statusCode).toBe(401);
        });

        it('PUT /admin/ai-cost/balance returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/admin/ai-cost/balance',
                headers: { 'content-type': 'application/json' },
                payload: { balanceUsd: 100, anchoredAt: '2026-06-29' },
            });
            expect(response.statusCode).toBe(401);
        });

        it('POST /admin/ai-cost/sync returns 401 without authorization header', async () => {
            const response = await app.inject({ method: 'POST', url: '/admin/ai-cost/sync' });
            expect(response.statusCode).toBe(401);
        });
    });

    describe('PUT /admin/ai-cost/balance validation', () => {
        it('rejects a negative balance with 400 (schema validation)', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/admin/ai-cost/balance',
                headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
                payload: { balanceUsd: -5, anchoredAt: '2026-06-29' },
            });
            expect(response.statusCode).toBe(400);
        });

        it('rejects a missing anchoredAt with 400 (schema validation)', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/admin/ai-cost/balance',
                headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
                payload: { balanceUsd: 100 },
            });
            expect(response.statusCode).toBe(400);
        });
    });

    describe('GET /admin/ai-cost/consumption', () => {
        it('returns a global consumption report for an admin (empty when no usage)', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/ai-cost/consumption?period=7d',
                headers: { authorization: 'Bearer admin-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.success).toBe(true);
            expect(body.data.period).toBe('7d');
            expect(body.data.byPipeline).toEqual([]);
            expect(body.data.byModel).toEqual([]);
            expect(body.data.totals.calls).toBe(0);
        });

        it('defaults to 30d when no period is provided', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/ai-cost/consumption',
                headers: { authorization: 'Bearer admin-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.data.period).toBe('30d');
        });

        it('rejects an out-of-enum period with 400 (schema validation)', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/ai-cost/consumption?period=bogus',
                headers: { authorization: 'Bearer admin-token' },
            });

            expect(response.statusCode).toBe(400);
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

            // SQL filter/paginate flow (post-refactor): the controller fires the
            // paginated SELECT (…orderBy().limit().offset()) and a separate
            // COUNT(*) (…where()) concurrently via Promise.all. Mock both chains
            // in call order — the page rows terminate on .offset(), the total on
            // an awaited .where().
            const pageChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                offset: vi.fn().mockResolvedValue([
                    {
                        id: 'user-1', email: 'user1@test.com', name: 'User 1', phone: null, facebookId: 'fb-1', createdAt: '2025-01-01',
                        subscriptionId: 'sub-1', subscriptionStatus: 'active', planId: 'plan-1',
                        planName: 'Pro', planSlug: 'pro', currentPeriodStart: '2025-01-01',
                        currentPeriodEnd: '2025-02-01', paymentMethod: 'manual',
                    },
                    {
                        id: 'user-2', email: 'user2@test.com', name: 'User 2', phone: null, facebookId: 'fb-2', createdAt: '2025-01-02',
                        subscriptionId: null, subscriptionStatus: null, planId: null,
                        planName: null, planSlug: null, currentPeriodStart: null,
                        currentPeriodEnd: null, paymentMethod: null,
                    },
                ]),
            };
            const countChain = {
                from: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 2 }]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(pageChain as any)
                .mockReturnValueOnce(countChain as any);

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

            // Second select: settings.aiModel lookup
            const settingsChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ aiModel: null }]),
            };

            // Third select: subscription with plan
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

            // Sixth: workspace memberships (joined to workspace + owner). The user owns this
            // workspace, so isOwner is derived true. Member count comes from the grouped query next.
            const membershipChain = {
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockResolvedValue([
                    {
                        workspaceId: 'ws-1', workspaceName: 'Test Workspace', role: 'owner',
                        ownerId: TEST_USER_ID, ownerName: 'Test User', ownerEmail: 'user@test.com',
                    },
                ]),
            };
            // Seventh: member count per workspace (grouped).
            const memberCountChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockResolvedValue([{ workspaceId: 'ws-1', count: 3 }]),
            };
            // Eighth: owned pages (direct + workspace) — drives both post-reply and lead stats.
            const ownedPagesChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ id: 'page-1' }, { id: 'page-2' }]),
            };
            // Ninth–tenth: KB chunk counts (grouped, pinned to active version) + unresolved
            // gaps per displayed page — support-console health inputs.
            const kbChunksChain = {
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockResolvedValue([{ pageId: 'page-1', type: 'offering', count: 5 }]),
            };
            const kbGapsChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockResolvedValue([]),
            };
            // Eleventh–thirteenth: post replies actually SENT (replyMethod='post_reply') across
            // FB comments, IG comments and DMs → 4 + 6 + 2 = 12.
            const fbPostReplyChain = {
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 4 }]),
            };
            const igPostReplyChain = {
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 6 }]),
            };
            const dmPostReplyChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([{ count: 2 }]),
            };
            // Twelfth: leads aggregation over the owned pages.
            const leadsAggChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([
                    { total: 0, today: 0, last7d: 0, last30d: 0, statusNew: 0, statusContacted: 0, statusConverted: 0 },
                ]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userChain as any)
                .mockReturnValueOnce(settingsChain as any)
                .mockReturnValueOnce(subChain as any)
                .mockReturnValueOnce(pagesChain as any)
                .mockReturnValueOnce(usageChain as any)
                .mockReturnValueOnce(membershipChain as any)
                .mockReturnValueOnce(memberCountChain as any)
                .mockReturnValueOnce(ownedPagesChain as any)
                .mockReturnValueOnce(kbChunksChain as any)
                .mockReturnValueOnce(kbGapsChain as any)
                .mockReturnValueOnce(fbPostReplyChain as any)
                .mockReturnValueOnce(igPostReplyChain as any)
                .mockReturnValueOnce(dmPostReplyChain as any)
                .mockReturnValueOnce(leadsAggChain as any);

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
            // Post replies = actual sends (replyMethod='post_reply') across FB + IG + DM.
            expect(body.data.usage.postRepliesCount).toBe(12);
            expect(body.data.usage.limit).toBe(1000);
            // Workspace membership: user owns this workspace.
            expect(body.data.workspaces).toHaveLength(1);
            expect(body.data.workspaces[0].name).toBe('Test Workspace');
            expect(body.data.workspaces[0].role).toBe('owner');
            expect(body.data.workspaces[0].isOwner).toBe(true);
            expect(body.data.workspaces[0].memberCount).toBe(3);
        });

        it('marks a user who only joined someone else\'s workspace as a team member', async () => {
            const { db } = await import('../../src/db');

            const userChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([
                    { id: TEST_USER_ID, email: 'member@test.com', name: 'Team Member', facebookId: null, createdAt: '2025-01-01' },
                ]),
            };
            const settingsChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            // No own subscription / pages — this is the confusing "empty customer" case.
            const subChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            const pagesChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([]),
            };
            const usageChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            // Membership: belongs to a workspace owned by a DIFFERENT user → isOwner false.
            const membershipChain = {
                from: vi.fn().mockReturnThis(),
                innerJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockResolvedValue([
                    {
                        workspaceId: 'ws-2', workspaceName: "Owner's Workspace", role: 'member',
                        ownerId: TEST_PLAN_ID, ownerName: 'Workspace Owner', ownerEmail: 'owner@test.com',
                    },
                ]),
            };
            const memberCountChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockResolvedValue([{ workspaceId: 'ws-2', count: 2 }]),
            };
            const ownedPagesChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockResolvedValue([]),
            };

            vi.mocked(db.select)
                .mockReturnValueOnce(userChain as any)
                .mockReturnValueOnce(settingsChain as any)
                .mockReturnValueOnce(subChain as any)
                .mockReturnValueOnce(pagesChain as any)
                .mockReturnValueOnce(usageChain as any)
                .mockReturnValueOnce(membershipChain as any)
                .mockReturnValueOnce(memberCountChain as any)
                .mockReturnValueOnce(ownedPagesChain as any);

            const response = await app.inject({
                method: 'GET',
                url: `/admin/users/${TEST_USER_ID}`,
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.data.pages).toHaveLength(0);
            expect(body.data.workspaces).toHaveLength(1);
            expect(body.data.workspaces[0].isOwner).toBe(false);
            expect(body.data.workspaces[0].role).toBe('member');
            expect(body.data.workspaces[0].ownerId).toBe(TEST_PLAN_ID);
            expect(body.data.workspaces[0].ownerName).toBe('Workspace Owner');
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

        it('forwards postMessage to generateForPlayground for a dm channel (comment-originated DM parity)', async () => {
            // The production DM pipeline injects the origin post + the merchant's Post Reply
            // as postMessage for comment-originated threads, so the playground/eval must be
            // able to exercise the dm+postMessage combination too (previously dropped).
            const { replyGenerator } = await setupAiPath();

            await app.inject({
                method: 'POST',
                url: '/admin/ai/playground',
                headers: authHeaders,
                payload: { pageId: 'page-1', question: 'Hello', channel: 'dm', postMessage: 'Post + merchant reply context' },
            });

            const callArg = vi.mocked(replyGenerator.generateForPlayground).mock.calls[0][0];
            expect(callArg).toBeDefined();
            expect(callArg.postMessage).toBe('Post + merchant reply context');
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

    // ---------------------------------------------------------------
    // PATCH /admin/users/:userId/ai-model
    // ---------------------------------------------------------------
    describe('PATCH /admin/users/:userId/ai-model', () => {
        const authHeaders = { authorization: 'Bearer valid-token', 'content-type': 'application/json' };

        it('returns 401 without authorization header', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/admin/users/${TEST_USER_ID}/ai-model`,
                headers: { 'content-type': 'application/json' },
                payload: { model: 'gpt-4o-mini' },
            });
            expect(response.statusCode).toBe(401);
        });

        it('returns 403 for non-admin user', async () => {
            const { authenticate } = await import('../../src/middleware/auth');
            vi.mocked(authenticate).mockImplementation(async (req: any) => {
                req.user = { userId: 'regular-user-id', role: 'user' };
            });
            const response = await app.inject({
                method: 'PATCH',
                url: `/admin/users/${TEST_USER_ID}/ai-model`,
                headers: authHeaders,
                payload: { model: 'gpt-4o-mini' },
            });
            expect(response.statusCode).toBe(403);
        });

        it('returns 400 when model is not in allow-list', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: `/admin/users/${TEST_USER_ID}/ai-model`,
                headers: authHeaders,
                payload: { model: 'gpt-pwned' },
            });
            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload).error).toBe('Invalid model');
        });

        it('returns 404 when target user does not exist', async () => {
            const { db } = await import('../../src/db');
            const userChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            vi.mocked(db.select).mockReturnValueOnce(userChain as any);

            const response = await app.inject({
                method: 'PATCH',
                url: `/admin/users/${NONEXISTENT_UUID}/ai-model`,
                headers: authHeaders,
                payload: { model: 'gpt-4o-mini' },
            });
            expect(response.statusCode).toBe(404);
        });

        it('upserts settings, invalidates cache, and audit-logs when no existing override', async () => {
            const { db } = await import('../../src/db');
            const { clearAiModelCache } = await import('../../src/services/aiModelResolver');

            const userChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID }]),
            };
            const existingChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
            };
            vi.mocked(db.select)
                .mockReturnValueOnce(userChain as any)
                .mockReturnValueOnce(existingChain as any);

            const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
            const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate });
            const auditInsertValues = vi.fn().mockResolvedValue([]);
            // First insert call is the settings upsert (returns chainable for onConflictDoUpdate);
            // second is the audit log (terminal — returns a resolved promise).
            vi.mocked(db.insert)
                .mockReturnValueOnce({ values: insertValues } as any)
                .mockReturnValueOnce({ values: auditInsertValues } as any);

            const response = await app.inject({
                method: 'PATCH',
                url: `/admin/users/${TEST_USER_ID}/ai-model`,
                headers: authHeaders,
                payload: { model: 'gpt-4o-mini' },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true, data: { aiModel: 'gpt-4o-mini' } });
            expect(clearAiModelCache).toHaveBeenCalledWith(TEST_USER_ID);
            expect(insertValues).toHaveBeenCalledWith({ userId: TEST_USER_ID, aiModel: 'gpt-4o-mini' });
            expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: { aiModel: 'gpt-4o-mini' } }));
            expect(auditInsertValues).toHaveBeenCalledWith(expect.objectContaining({
                action: 'ai_model_changed',
                previousValue: { aiModel: null },
                newValue: { aiModel: 'gpt-4o-mini' },
            }));
        });

        it('records previous value in audit log when override is changed', async () => {
            const { db } = await import('../../src/db');

            const userChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID }]),
            };
            const existingChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ aiModel: 'gpt-4o-mini' }]),
            };
            vi.mocked(db.select)
                .mockReturnValueOnce(userChain as any)
                .mockReturnValueOnce(existingChain as any);

            const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
            const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate });
            const auditInsertValues = vi.fn().mockResolvedValue([]);
            vi.mocked(db.insert)
                .mockReturnValueOnce({ values: insertValues } as any)
                .mockReturnValueOnce({ values: auditInsertValues } as any);

            const response = await app.inject({
                method: 'PATCH',
                url: `/admin/users/${TEST_USER_ID}/ai-model`,
                headers: authHeaders,
                payload: { model: 'gpt-4.1-mini' },
            });

            expect(response.statusCode).toBe(200);
            expect(auditInsertValues).toHaveBeenCalledWith(expect.objectContaining({
                action: 'ai_model_changed',
                previousValue: { aiModel: 'gpt-4o-mini' },
                newValue: { aiModel: 'gpt-4.1-mini' },
            }));
        });

        it('accepts null to clear override', async () => {
            const { db } = await import('../../src/db');

            const userChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ id: TEST_USER_ID }]),
            };
            const existingChain = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ aiModel: 'gpt-4o-mini' }]),
            };
            vi.mocked(db.select)
                .mockReturnValueOnce(userChain as any)
                .mockReturnValueOnce(existingChain as any);

            const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
            const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate });
            const auditInsertValues = vi.fn().mockResolvedValue([]);
            vi.mocked(db.insert)
                .mockReturnValueOnce({ values: insertValues } as any)
                .mockReturnValueOnce({ values: auditInsertValues } as any);

            const response = await app.inject({
                method: 'PATCH',
                url: `/admin/users/${TEST_USER_ID}/ai-model`,
                headers: authHeaders,
                payload: { model: null },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true, data: { aiModel: null } });
            expect(insertValues).toHaveBeenCalledWith({ userId: TEST_USER_ID, aiModel: null });
            expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: { aiModel: null } }));
        });
    });
});
