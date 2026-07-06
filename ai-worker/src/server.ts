import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual } from 'crypto';
import routes from './routes';
import { config } from './config';

/** Constant-time string compare that tolerates unequal lengths without throwing. */
function secretMatches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

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

    // Shared-secret gate. The worker proxies to paid OpenAI/Anthropic APIs and is only
    // meant to be called by our backend over the internal network. Require the secret
    // on every route except the /health liveness probe (hit by the Docker healthcheck).
    // CORS does NOT protect this — it only constrains browsers, not server/curl callers.
    // In production the secret is mandatory (config.validateConfig fails fast); in dev,
    // an unset secret disables enforcement so local runs keep working.
    server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.url.split('?')[0] === '/health') return;
        if (!config.workerSecret) return; // dev-only: no secret configured

        const provided = request.headers['x-ai-worker-secret'];
        if (typeof provided !== 'string' || !secretMatches(provided, config.workerSecret)) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
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
