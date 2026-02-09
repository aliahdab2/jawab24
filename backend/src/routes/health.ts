import { FastifyPluginAsync } from 'fastify';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { config } from '../config';
import { runAllCleanupTasks, getAiCacheStats } from '../utils/cleanup';
import { pipelineMetrics } from '../lib/pipelineMetrics';
import { createRequestLogger } from '../types';

const startTime = Date.now();

interface HealthStatus {
    status: 'healthy' | 'unhealthy' | 'degraded';
    timestamp: string;
    uptime: number;
    version: string;
    environment: string;
    services: {
        database: ServiceStatus;
        stripe: ServiceStatus;
        ai: ServiceStatus;
    };
}

interface ServiceStatus {
    status: 'up' | 'down' | 'not_configured';
    message?: string;
    responseTime?: number;
}

async function checkDatabase(): Promise<ServiceStatus> {
    try {
        const start = Date.now();
        await db.execute(sql`SELECT 1`);
        const responseTime = Date.now() - start;
        return { status: 'up', responseTime };
    } catch (error) {
        return {
            status: 'down',
            message: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

function checkStripe(): ServiceStatus {
    if (config.stripe?.secretKey) {
        return { status: 'up', message: 'Configured' };
    }
    return { status: 'not_configured', message: 'Stripe keys not set' };
}

function checkAI(): ServiceStatus {
    if (config.ai.enabled) {
        return { status: 'up', message: 'Enabled' };
    }
    return { status: 'not_configured', message: 'AI service disabled' };
}

const healthRoutes: FastifyPluginAsync = async (fastify, _opts) => {
    /**
     * Comprehensive health check
     * GET /health
     */
    fastify.get('/health', {
        schema: { tags: ['Health'], summary: 'Comprehensive health check with service statuses' },
    }, async (request, reply) => {
        const database = await checkDatabase();
        const stripe = checkStripe();
        const ai = checkAI();

        const allServicesUp = database.status === 'up';
        const anyServiceDown = database.status === 'down';

        const health: HealthStatus = {
            status: anyServiceDown ? 'unhealthy' : allServicesUp ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            version: process.env.npm_package_version || '1.0.0',
            environment: config.nodeEnv,
            services: {
                database,
                stripe,
                ai,
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
        const database = await checkDatabase();

        if (database.status === 'up') {
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

        if (providedToken !== cleanupToken) {
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

        if (!cleanupToken || providedToken !== cleanupToken) {
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

        if (!cleanupToken || providedToken !== cleanupToken) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        return reply.send(pipelineMetrics.getMetrics());
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
