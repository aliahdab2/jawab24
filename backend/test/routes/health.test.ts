import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

// Mock dependencies
vi.mock('../../src/db', () => ({
    db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
    sql: vi.fn(),
}));

vi.mock('../../src/config', () => ({
    config: {
        nodeEnv: 'test',
        stripe: { secretKey: 'sk_test_xxx' },
        ai: { enabled: true },
    },
}));

vi.mock('../../src/utils/cleanup', () => ({
    runAllCleanupTasks: vi.fn(),
    getAiCacheStats: vi.fn(),
}));

vi.mock('../../src/lib/pipelineMetrics', () => ({
    pipelineMetrics: {
        getMetrics: vi.fn(),
        record: vi.fn(),
        reset: vi.fn(),
    },
}));

vi.mock('../../src/types', () => ({
    createRequestLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }),
}));

import healthRoutes from '../../src/routes/health';
import { db } from '../../src/db';
import { config } from '../../src/config';
import { runAllCleanupTasks, getAiCacheStats } from '../../src/utils/cleanup';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';

describe('Health Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = fastify();
        app.register(healthRoutes);
        await app.ready();
        vi.resetAllMocks();
    });

    afterEach(async () => {
        await app.close();
    });

    // -------------------------------------------------------
    // GET /health
    // -------------------------------------------------------
    describe('GET /health', () => {
        it('returns healthy (200) when database is up', async () => {
            vi.mocked(db.execute).mockResolvedValue([] as any);

            const response = await app.inject({
                method: 'GET',
                url: '/health',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.status).toBe('healthy');
            expect(body.services.database.status).toBe('up');
            expect(body.services.stripe.status).toBe('up');
            expect(body.services.ai.status).toBe('up');
            expect(body.timestamp).toBeDefined();
            expect(body.uptime).toBeTypeOf('number');
            expect(body.environment).toBe('test');
        });

        it('returns unhealthy (503) when database is down', async () => {
            vi.mocked(db.execute).mockRejectedValue(new Error('Connection refused'));

            const response = await app.inject({
                method: 'GET',
                url: '/health',
            });

            expect(response.statusCode).toBe(503);
            const body = response.json();
            expect(body.status).toBe('unhealthy');
            expect(body.services.database.status).toBe('down');
            expect(body.services.database.message).toBe('Connection refused');
        });
    });

    // -------------------------------------------------------
    // GET /health/live
    // -------------------------------------------------------
    describe('GET /health/live', () => {
        it('returns { status: "alive" }', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/health/live',
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: 'alive' });
        });
    });

    // -------------------------------------------------------
    // GET /health/ready
    // -------------------------------------------------------
    describe('GET /health/ready', () => {
        it('returns ready when database is up', async () => {
            vi.mocked(db.execute).mockResolvedValue([] as any);

            const response = await app.inject({
                method: 'GET',
                url: '/health/ready',
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ status: 'ready' });
        });

        it('returns 503 when database is down', async () => {
            vi.mocked(db.execute).mockRejectedValue(new Error('Connection refused'));

            const response = await app.inject({
                method: 'GET',
                url: '/health/ready',
            });

            expect(response.statusCode).toBe(503);
            const body = response.json();
            expect(body.status).toBe('not_ready');
            expect(body.reason).toBe('Database unavailable');
        });
    });

    // -------------------------------------------------------
    // POST /health/cleanup
    // -------------------------------------------------------
    describe('POST /health/cleanup', () => {
        it('returns 401 without valid token', async () => {
            process.env.CLEANUP_SECRET_TOKEN = 'test-token';

            const response = await app.inject({
                method: 'POST',
                url: '/health/cleanup',
                headers: { 'x-cleanup-token': 'wrong-token' },
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Unauthorized' });

            delete process.env.CLEANUP_SECRET_TOKEN;
        });

        it('returns 503 when CLEANUP_SECRET_TOKEN is not set', async () => {
            delete process.env.CLEANUP_SECRET_TOKEN;

            const response = await app.inject({
                method: 'POST',
                url: '/health/cleanup',
                headers: { 'x-cleanup-token': 'some-token' },
            });

            expect(response.statusCode).toBe(503);
            const body = response.json();
            expect(body.error).toContain('Cleanup not configured');
        });

        it('succeeds with valid token', async () => {
            process.env.CLEANUP_SECRET_TOKEN = 'test-token';

            const mockResults = { deletedSessions: 5, cleanedCache: 10 };
            const mockCacheStats = { totalEntries: 100, sizeBytes: 2048 };

            vi.mocked(runAllCleanupTasks).mockResolvedValue(mockResults as any);
            vi.mocked(getAiCacheStats).mockResolvedValue(mockCacheStats as any);

            const response = await app.inject({
                method: 'POST',
                url: '/health/cleanup',
                headers: { 'x-cleanup-token': 'test-token' },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.success).toBe(true);
            expect(body.results).toEqual(mockResults);
            expect(body.cacheStats).toEqual(mockCacheStats);
            expect(body.timestamp).toBeDefined();

            delete process.env.CLEANUP_SECRET_TOKEN;
        });
    });

    // -------------------------------------------------------
    // GET /health/cache-stats
    // -------------------------------------------------------
    describe('GET /health/cache-stats', () => {
        it('returns 401 without valid token', async () => {
            process.env.CLEANUP_SECRET_TOKEN = 'test-token';

            const response = await app.inject({
                method: 'GET',
                url: '/health/cache-stats',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Unauthorized' });

            delete process.env.CLEANUP_SECRET_TOKEN;
        });
    });

    // -------------------------------------------------------
    // GET /health/pipeline-metrics
    // -------------------------------------------------------
    describe('GET /health/pipeline-metrics', () => {
        it('returns 401 without valid token', async () => {
            process.env.CLEANUP_SECRET_TOKEN = 'test-token';

            const response = await app.inject({
                method: 'GET',
                url: '/health/pipeline-metrics',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ error: 'Unauthorized' });

            delete process.env.CLEANUP_SECRET_TOKEN;
        });

        it('returns metrics with valid token', async () => {
            process.env.CLEANUP_SECRET_TOKEN = 'test-token';

            const mockMetrics = {
                since: '2026-02-08T00:00:00.000Z',
                counters: { 'facebook_message.success': 5 },
            };
            vi.mocked(pipelineMetrics.getMetrics).mockReturnValue(mockMetrics);

            const response = await app.inject({
                method: 'GET',
                url: '/health/pipeline-metrics',
                headers: { 'x-cleanup-token': 'test-token' },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual(mockMetrics);

            delete process.env.CLEANUP_SECRET_TOKEN;
        });
    });

    // -------------------------------------------------------
    // GET /health/sentry-test
    // -------------------------------------------------------
    describe('GET /health/sentry-test', () => {
        it('returns 404 in production', async () => {
            // Temporarily override nodeEnv to production
            const originalNodeEnv = config.nodeEnv;
            (config as any).nodeEnv = 'production';

            const response = await app.inject({
                method: 'GET',
                url: '/health/sentry-test',
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ error: 'Not found' });

            // Restore
            (config as any).nodeEnv = originalNodeEnv;
        });
    });
});
