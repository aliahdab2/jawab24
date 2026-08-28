import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import adminRoutes from '../../src/routes/admin';

const MOCK_ENTRIES = [
    { id: '1', email: 'alice@example.com', feature: 'early_access', createdAt: '2026-01-15T10:00:00Z' },
    { id: '2', email: 'bob@test.com', feature: 'ecommerce_integrations', createdAt: '2026-01-16T12:00:00Z' },
];

// Mutable per-test overrides — set inside `it` blocks before invoking the route.
const MOCK_OVERRIDES: { users?: { email: string | null }[]; unsubscribes?: { email: string }[] } = {};

// Build a chainable query mock for Drizzle ORM that resolves to different data
// based on which schema table .from() was called with.
function chainable(defaultValue: unknown) {
    const chain: Record<string, unknown> = {};
    let resolved: unknown = defaultValue;
    chain.from = vi.fn((table: { _kind?: string }) => {
        if (table?._kind === 'users' && MOCK_OVERRIDES.users !== undefined) {
            resolved = MOCK_OVERRIDES.users;
        } else if (table?._kind === 'emailUnsubscribes') {
            resolved = MOCK_OVERRIDES.unsubscribes ?? [];
        } else if (table?._kind === 'users') {
            // Default: no registered users with email
            resolved = [];
        }
        return chain;
    });
    for (const m of ['where', 'orderBy', 'limit', 'offset', 'leftJoin', 'groupBy', 'having']) {
        chain[m] = vi.fn().mockReturnValue(chain);
    }
    // Terminal: resolves when awaited
    chain.then = (resolve: (v: unknown) => void) => resolve(resolved);
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
    // The offline (Sham Cash) payment rail's tables. Present here only because
    // this file hand-rolls the schema mock: the admin/payment routes import the
    // offline-payments controller, and a missing export throws at import time.
    offlinePayments: { id: 'id', userId: 'userId', rail: 'rail', planId: 'planId', billingInterval: 'bi', amountCents: 'ac', currency: 'currency', transferReference: 'tr', transferReferenceNormalized: 'trn', senderName: 'sn', note: 'note', status: 'status', reviewNote: 'rn', reviewedByAdminUserId: 'rba', reviewedAt: 'ra', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    offlinePaymentReceipts: { offlinePaymentId: 'opi', mimeType: 'mimeType', byteLength: 'bl', bytes: 'bytes', createdAt: 'createdAt' },
    users: { _kind: 'users', id: 'id', email: 'email' },
    subscriptions: {},
    plans: {},
    adminAuditLogs: {},
    pages: {},
    usage: {},
    kbChunks: {},
    kbGaps: {},
    waitlistEmails: { _kind: 'waitlistEmails', id: 'id', feature: 'feature', email: 'email', createdAt: 'created_at', unsubscribedAt: 'unsubscribed_at' },
    waitlistEmailSends: { _kind: 'waitlistEmailSends' },
    emailUnsubscribes: { _kind: 'emailUnsubscribes', email: 'email' },
    leadDigestSends: { _kind: 'leadDigestSends' },
    emailSends: { _kind: 'emailSends' },
    posts: { _kind: 'posts' },
    instagramMedia: { _kind: 'instagramMedia' },
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
    inArray: vi.fn(),
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
vi.mock('../../src/services/email', () => ({
    emailService: {
        send: vi.fn().mockResolvedValue({ success: true, id: 'mock' }),
        setLogger: vi.fn(),
    },
}));
vi.mock('../../src/utils/emailTemplates', () => ({ waitlistEmailTemplate: vi.fn().mockReturnValue('<html></html>') }));
// generateUnsubscribeToken moved from routes/waitlist.ts → utils/tokens.ts in the
// admin routes → controller → service refactor; the admin send-email path now
// imports it from utils/tokens, so the mock must target the new location.
vi.mock('../../src/utils/tokens', () => ({ generateUnsubscribeToken: vi.fn().mockReturnValue('mock_token') }));

describe('Admin Waitlist Route', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset per-test data overrides
        MOCK_OVERRIDES.users = undefined;
        MOCK_OVERRIDES.unsubscribes = undefined;
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

    describe('POST /admin/waitlist/send-email', () => {
        // A valid UUID we can pass through zod's .uuid() validation
        const UUID_1 = '11111111-1111-4111-a111-111111111111';
        const UUID_2 = '22222222-2222-4222-a222-222222222222';

        it('sends to all waitlist emails by default and returns counts', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: { subject: 'Launch', body: 'We are live.' },
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload.success).toBe(true);
            // MOCK_ENTRIES has 2 unique emails; both should be sent
            expect(payload.sent).toBe(2);
            expect(payload.failed).toBe(0);
            expect(payload.total).toBe(2);
            expect(payload.fromWaitlist).toBe(2);
            expect(payload.fromExtra).toBe(0);
        });

        it('merges extraEmails with waitlist and dedupes', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: {
                    subject: 'Launch',
                    body: 'We are live.',
                    // alice@example.com is already in MOCK_ENTRIES — must be deduped.
                    // extra@test.com is new.
                    extraEmails: ['ALICE@example.com', 'extra@test.com'],
                },
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload.success).toBe(true);
            // 2 waitlist + 1 new extra (alice is deduped) = 3 unique
            expect(payload.total).toBe(3);
            expect(payload.fromWaitlist).toBe(2);
            expect(payload.fromExtra).toBe(2); // 2 valid extras before dedup
        });

        it('accepts explicit emailIds selection', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: {
                    subject: 'Launch',
                    body: 'We are live.',
                    emailIds: [UUID_1, UUID_2],
                },
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload.success).toBe(true);
        });

        it('rejects missing subject', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: { subject: '   ', body: 'hi' },
            });

            expect(response.statusCode).toBe(400);
            const payload = JSON.parse(response.payload);
            expect(payload.success).toBe(false);
        });

        it('rejects missing body', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: { subject: 'hi', body: '   ' },
            });

            expect(response.statusCode).toBe(400);
        });

        it('rejects invalid email addresses in extraEmails', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: {
                    subject: 'Launch',
                    body: 'We are live.',
                    extraEmails: ['not-an-email', 'also@bad'],
                },
            });

            expect(response.statusCode).toBe(400);
            const payload = JSON.parse(response.payload);
            expect(payload.success).toBe(false);
        });

        it('rejects non-UUID emailIds', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: {
                    subject: 'Launch',
                    body: 'We are live.',
                    emailIds: ['not-a-uuid'],
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('rejects more than 500 extraEmails', async () => {
            const tooMany = Array.from({ length: 501 }, (_, i) => `user${i}@example.com`);
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: {
                    subject: 'Launch',
                    body: 'We are live.',
                    extraEmails: tooMany,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('audience=users sends only to registered users (not waitlist)', async () => {
            MOCK_OVERRIDES.users = [{ email: 'user1@app.com' }, { email: 'user2@app.com' }];
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: { subject: 'Launch', body: 'We are live.', audience: 'users' },
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload.success).toBe(true);
            expect(payload.fromWaitlist).toBe(0);
            expect(payload.fromUsers).toBe(2);
            expect(payload.total).toBe(2);
        });

        it('audience=both unions waitlist + users and dedupes overlap', async () => {
            // bob@test.com is in waitlist (MOCK_ENTRIES) AND users — must be deduped to 1
            MOCK_OVERRIDES.users = [{ email: 'BOB@test.com' }, { email: 'newuser@app.com' }];
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: { subject: 'Launch', body: 'We are live.', audience: 'both' },
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            // 2 waitlist (alice, bob) + 1 unique user (newuser; bob deduped) = 3
            expect(payload.total).toBe(3);
            expect(payload.fromWaitlist).toBe(2);
            expect(payload.fromUsers).toBe(2); // count is pre-dedupe
        });

        it('excludes globally suppressed addresses across all audiences', async () => {
            MOCK_OVERRIDES.users = [{ email: 'user1@app.com' }, { email: 'user2@app.com' }];
            MOCK_OVERRIDES.unsubscribes = [{ email: 'alice@example.com' }, { email: 'user1@app.com' }];

            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: {
                    subject: 'Launch',
                    body: 'We are live.',
                    audience: 'both',
                    extraEmails: ['alice@example.com', 'never-suppressed@x.com'],
                },
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            // bob@test.com (waitlist) + user2@app.com (users) + never-suppressed@x.com (extra) = 3
            // alice is suppressed — excluded from both waitlist source and extras.
            // user1 is suppressed — excluded from users source.
            expect(payload.total).toBe(3);
            expect(payload.fromWaitlist).toBe(1);
            expect(payload.fromUsers).toBe(1);
            expect(payload.fromExtra).toBe(1);
        });

        it('audience=users ignores emailIds and feature filters', async () => {
            MOCK_OVERRIDES.users = [{ email: 'user1@app.com' }];
            const response = await app.inject({
                method: 'POST',
                url: '/admin/waitlist/send-email',
                headers: { authorization: 'Bearer test_token', 'content-type': 'application/json' },
                payload: {
                    subject: 'Launch',
                    body: 'We are live.',
                    audience: 'users',
                    feature: 'early_access', // ignored
                    emailIds: [UUID_1],       // ignored
                },
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload.fromWaitlist).toBe(0);
            expect(payload.fromUsers).toBe(1);
        });
    });
});
