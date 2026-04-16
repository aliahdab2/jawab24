import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import adminRoutes from '../../src/routes/admin';

const MOCK_ENTRIES = [
    { id: '1', email: 'alice@example.com', feature: 'early_access', createdAt: '2026-01-15T10:00:00Z' },
    { id: '2', email: 'bob@test.com', feature: 'ecommerce_integrations', createdAt: '2026-01-16T12:00:00Z' },
];

// Build a chainable query mock for Drizzle ORM
function chainable(resolvedValue: unknown) {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'groupBy', 'having']) {
        chain[m] = vi.fn().mockReturnValue(chain);
    }
    // Terminal: resolves when awaited
    chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
    return chain;
}

// Mock auth — let all requests through as admin
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async (request) => {
        request.user = { userId: 'admin_1', facebookId: 'fb_admin' };
    }),
    requireAdmin: vi.fn(async () => { /* pass */ }),
    AuthenticatedRequest: {},
}));

// Mock DB
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockImplementation(() => chainable(MOCK_ENTRIES)),
        selectDistinct: vi.fn().mockImplementation(() =>
            chainable([{ feature: 'early_access' }, { feature: 'ecommerce_integrations' }])
        ),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    },
}));

// Mock all schema tables referenced by admin routes
vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', email: 'email' },
    subscriptions: {},
    plans: {},
    adminAuditLogs: {},
    pages: {},
    usage: {},
    kbChunks: {},
    kbGaps: {},
    waitlistEmails: { feature: 'feature', email: 'email', createdAt: 'created_at', unsubscribedAt: 'unsubscribed_at' },
    waitlistEmailSends: {},
}));

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    ilike: vi.fn(),
    desc: vi.fn(),
    and: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    sql: vi.fn(),
    isNotNull: vi.fn(),
    isNull: vi.fn(),
}));

// Mock config
vi.mock('../../src/config', () => ({
    config: { ADMIN_EMAILS: ['admin@test.com'], redis: { host: 'localhost', port: 6379, password: '' } },
}));

// Mock redis (workspaceSettings imports it at module level)
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), pipeline: vi.fn() },
    redisScanDelete: vi.fn(),
}));

// Mock services used by other admin routes (they get imported at module level)
vi.mock('../../src/services/ai', () => ({ aiService: {} }));

vi.mock('../../src/services/kb/retrieval', () => ({ RetrievalService: vi.fn() }));
vi.mock('../../src/services/kb/embedding', () => ({ OpenAIEmbeddingProvider: vi.fn() }));
vi.mock('../../src/services/kb/gap-detector', () => ({ gapDetectorService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/services/pages', () => ({ getIngestionService: vi.fn() }));
vi.mock('../../src/services/ecommerce', () => ({ getEnrichedKnowledgeBase: vi.fn(), getStoreContextForAI: vi.fn() }));
vi.mock('../../src/services/reply/generator', () => ({ shouldSkipReply: vi.fn(), shouldUseFallback: vi.fn(), PRICE_FALLBACK: 'price_fallback' }));
vi.mock('@jawab24/shared', async (importOriginal) => ({ ...await importOriginal() as object, normalizeAiIntent: vi.fn() }));
vi.mock('../../src/utils/language', () => ({ detectLanguageCode: vi.fn() }));
vi.mock('../../src/utils/swagger', () => ({ auth: [] }));
vi.mock('../../src/services/email', () => ({ emailService: { send: vi.fn(), setLogger: vi.fn() } }));
vi.mock('../../src/utils/emailTemplates', () => ({ waitlistEmailTemplate: vi.fn().mockReturnValue('<html></html>') }));
vi.mock('../../src/routes/waitlist', () => ({ generateUnsubscribeToken: vi.fn().mockReturnValue('mock_token') }));

describe('Admin Waitlist Route', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = Fastify();
        await app.register(adminRoutes, { prefix: '/admin' });
        await app.ready();
    });

    describe('GET /admin/waitlist', () => {
        it('should return waitlist entries with pagination', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/waitlist',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.data).toBeInstanceOf(Array);
            expect(body.features).toBeInstanceOf(Array);
            expect(body.pagination).toBeDefined();
            expect(body.pagination.page).toBe(1);
            expect(body.pagination.limit).toBe(20);
        });

        it('should accept page and limit query params', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/waitlist?page=2&limit=10',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.pagination.page).toBe(2);
            expect(body.pagination.limit).toBe(10);
        });

        it('should accept feature filter', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/waitlist?feature=early_access',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
        });

        it('should accept search filter', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/waitlist?search=alice',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
        });

        it('should clamp limit to max 100', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/admin/waitlist?limit=500',
                headers: { authorization: 'Bearer test_token' },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.pagination.limit).toBe(100);
        });
    });
});
