import { FastifyPluginAsync } from 'fastify';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { config } from '../config';

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

const healthRoutes: FastifyPluginAsync = async (fastify, opts) => {
    /**
     * Comprehensive health check
     * GET /health
     */
    fastify.get('/health', async (request, reply) => {
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
    fastify.get('/health/live', async (request, reply) => {
        return reply.send({ status: 'alive' });
    });

    /**
     * Readiness probe for Kubernetes/Docker
     * GET /health/ready
     */
    fastify.get('/health/ready', async (request, reply) => {
        const database = await checkDatabase();
        
        if (database.status === 'up') {
            return reply.send({ status: 'ready' });
        }
        
        return reply.status(503).send({ status: 'not_ready', reason: 'Database unavailable' });
    });
};

export default healthRoutes;
