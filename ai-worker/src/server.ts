import fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import routes from './routes';

export async function buildServer(opts?: { logger?: boolean }) {
    const server = fastify({
        logger: opts?.logger ?? true,
    });

    const isProduction = process.env.NODE_ENV === 'production';
    await server.register(cors, {
        origin: isProduction
            ? (process.env.CORS_ORIGIN || false)
            : true,
    });

    await server.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please try again later.',
            statusCode: 429,
        }),
    });

    await server.register(routes);

    return server;
}
