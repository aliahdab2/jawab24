import fastify, { type FastifyRequest } from 'fastify';
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
        // Rate-limit per workspace (via X-Workspace-Id header from backend).
        // Falls back to IP if header is missing (e.g. direct calls, playground).
        keyGenerator: (request: FastifyRequest) => {
            const workspaceId = request.headers['x-workspace-id'];
            if (typeof workspaceId === 'string' && workspaceId.length > 0) {
                return `ws:${workspaceId}`;
            }
            return request.ip || 'unknown';
        },
        errorResponseBuilder: () => ({
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please try again later.',
            statusCode: 429,
        }),
    });

    await server.register(routes);

    return server;
}
