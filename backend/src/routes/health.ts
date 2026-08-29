import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { config } from '../config';
import { runAllCleanupTasks, getAiCacheStats } from '../utils/cleanup';
import { pipelineMetrics } from '../lib/pipelineMetrics';
import { metricsRegistry } from '../lib/metrics';
import { probeDatabase, probeRedis, probeAiWorkerCircuit } from '../utils/healthChecks';
import { createRequestLogger } from '../types';

/** Constant-time token comparison to prevent timing attacks */
function tokensMatch(provided: string | undefined, expected: string): boolean {
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

const startTime = Date.now();

interface HealthStatus {
    status: 'healthy' | 'unhealthy' | 'degraded';
    timestamp: string;
    uptime: number;
    version: string;
    environment: string;
    services: {
        database: { status: string; responseTime?: number; message?: string };
        redis: { status: string; responseTime?: number; message?: string };
        stripe: { status: string; message?: string };
        ai: { status: string; message?: string; circuit?: string };
        shamCash: { status: string; message?: string };
    };
}

const healthRoutes: FastifyPluginAsync = async (fastify, _opts) => {
    /**
     * Comprehensive health check
     * GET /health
     */
    fastify.get('/health', {
        schema: { tags: ['Health'], summary: 'Comprehensive health check with service statuses' },
    }, async (request, reply) => {
        const [dbProbe, redisProbe, circuit] = await Promise.all([
            probeDatabase(),
            probeRedis(),
            probeAiWorkerCircuit(),
        ]);

        const database = { status: dbProbe.status, responseTime: dbProbe.latencyMs, message: dbProbe.message };
        const redisStatus = { status: redisProbe.status, responseTime: redisProbe.latencyMs, message: redisProbe.message };
        const stripe = config.stripe?.secretKey
            ? { status: 'up' as const, message: 'Configured' }
            : { status: 'not_configured' as const, message: 'Stripe keys not set' };
        const ai = config.ai.enabled
            ? { status: 'up' as const, message: 'Enabled', circuit }
            : { status: 'not_configured' as const, message: 'AI service disabled' };
        // The Sham Cash rail is env-switched; without this line the only
        // post-deploy proof that the wallet was set is a Syrian merchant's report.
        // Read from config directly (like `stripe` above) — importing the
        // controller would drag the whole payment service chain into /health.
        const shamCash = config.shamCash?.walletNumber
            ? { status: 'up' as const, message: 'Configured' }
            : { status: 'not_configured' as const, message: 'SHAM_CASH_WALLET_NUMBER not set' };

        const allServicesUp = dbProbe.status === 'up' && redisProbe.status === 'up';
        // Both DB and Redis are critical: DB for data, Redis for rate limiting and caching.
        const anyServiceDown = dbProbe.status === 'down' || redisProbe.status === 'down';

        const health: HealthStatus = {
            status: anyServiceDown ? 'unhealthy' : allServicesUp ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            version: process.env.npm_package_version || '1.0.0',
            environment: config.nodeEnv,
            services: {
                database,
                redis: redisStatus,
                stripe,
                ai,
                shamCash,
            },
        };

        const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
        return reply.status(statusCode).send(health);
    });

    /**
     * Liveness probe for Kubernetes/Docker
     * GET /health/live
     */
    fastify.get('/health/live', {
        schema: { tags: ['Health'], summary: 'Liveness probe for container orchestration' },
    }, async (request, reply) => {
        return reply.send({ status: 'alive' });
    });

    /**
     * Readiness probe for Kubernetes/Docker
     * GET /health/ready
     */
    fastify.get('/health/ready', {
        schema: { tags: ['Health'], summary: 'Readiness probe checking database connectivity' },
    }, async (request, reply) => {
        const dbProbe = await probeDatabase();

        if (dbProbe.status === 'up') {
            return reply.send({ status: 'ready' });
        }

        return reply.status(503).send({ status: 'not_ready', reason: 'Database unavailable' });
    });

    /**
     * Database cleanup endpoint
     * POST /health/cleanup
     * Requires a secret token for security
     */
    fastify.post<{ Headers: { 'x-cleanup-token'?: string } }>('/health/cleanup', {
        schema: { tags: ['Health'], summary: 'Run database cleanup tasks (token-protected)' },
    }, async (request, reply) => {
        // Simple token-based auth for cleanup endpoint
        const cleanupToken = config.cleanupSecretToken;
        const providedToken = request.headers['x-cleanup-token'];

        if (!cleanupToken) {
            return reply.status(503).send({ error: 'Cleanup not configured. Set CLEANUP_SECRET_TOKEN environment variable.' });
        }

        if (!tokensMatch(providedToken, cleanupToken)) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            // Pass Fastify logger for proper structured logging
            const logger = createRequestLogger(request.log);

            const results = await runAllCleanupTasks(undefined, logger);
            const cacheStats = await getAiCacheStats();

            return reply.send({
                success: true,
                timestamp: new Date().toISOString(),
                results,
                cacheStats,
            });
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                error: 'Cleanup failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    /**
     * Get AI cache statistics
     * GET /health/cache-stats
     * Protected by the same cleanup token to prevent info disclosure
     */
    fastify.get<{ Headers: { 'x-cleanup-token'?: string } }>('/health/cache-stats', {
        schema: { tags: ['Health'], summary: 'Get AI cache statistics (token-protected)' },
    }, async (request, reply) => {
        const cleanupToken = config.cleanupSecretToken;
        const providedToken = request.headers['x-cleanup-token'];

        if (!cleanupToken || !tokensMatch(providedToken, cleanupToken)) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const stats = await getAiCacheStats();
            return reply.send(stats);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to get cache stats' });
        }
    });

    /**
     * Pipeline processing metrics
     * GET /health/pipeline-metrics
     * Protected by the same cleanup token to prevent info disclosure
     */
    fastify.get<{ Headers: { 'x-cleanup-token'?: string } }>('/health/pipeline-metrics', {
        schema: { tags: ['Health'], summary: 'Get pipeline processing metrics (token-protected)' },
    }, async (request, reply) => {
        const cleanupToken = config.cleanupSecretToken;
        const providedToken = request.headers['x-cleanup-token'];

        if (!cleanupToken || !tokensMatch(providedToken, cleanupToken)) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        return reply.send(await pipelineMetrics.getMetrics());
    });

    /**
     * Prometheus-compatible metrics endpoint
     * GET /health/metrics
     * Exports all metrics via prom-client registry:
     *   - Default Node.js metrics (CPU, memory, event loop, GC)
     *   - Pipeline outcome counters (jawab24_pipeline_total)
     *   - Redis operation latency histogram (jawab24_redis_operation_duration_seconds)
     *   - External API latency histogram (jawab24_external_api_duration_seconds)
     *   - Uptime gauge (jawab24_uptime_seconds)
     */
    fastify.get<{ Headers: { 'x-cleanup-token'?: string } }>('/health/metrics', {
        schema: { tags: ['Health'], summary: 'Prometheus-compatible metrics export (token-protected)' },
    }, async (request, reply) => {
        const cleanupToken = config.cleanupSecretToken;
        const providedToken = request.headers['x-cleanup-token'];

        if (!cleanupToken || !tokensMatch(providedToken, cleanupToken)) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        reply.header('Content-Type', metricsRegistry.contentType);
        return reply.send(await metricsRegistry.metrics());
    });

    /**
     * Test Sentry error tracking
     * GET /health/sentry-test
     * Only available in non-production environments
     */
    fastify.get('/health/sentry-test', {
        schema: { tags: ['Health'], summary: 'Test Sentry error tracking (non-production only)' },
    }, async (request, reply) => {
        if (config.nodeEnv === 'production') {
            return reply.status(404).send({ error: 'Not found' });
        }
        throw new Error('Sentry Test Error - This is intentional');
    });
};

export default healthRoutes;
