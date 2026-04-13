import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { authService } from '../services/auth';
import { sseManager } from '../lib/sseManager';

interface SSEQuerystring {
    token?: string;
}

const sseRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * SSE endpoint for real-time updates.
     *
     * Auth: supports Bearer header, signed cookie, AND ?token= query param.
     * The query-param path is required because the browser EventSource API
     * cannot set custom headers (needed for mobile / Capacitor).
     */
    // SSE is a persistent connection — exempt it from the global rate limit so
    // reconnects after a network blip don't consume the shared request budget.
    fastify.get<{ Querystring: SSEQuerystring }>('/events', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        // --- Authenticate (3 sources) ---
        let jwtToken: string | undefined;

        // 1. Authorization header
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            jwtToken = authHeader.substring(7);
        }
        // 2. Signed cookie
        else if ((request as FastifyRequest & { cookies: Record<string, string> }).cookies?.token) {
            const unsigned = (request as FastifyRequest & { unsignCookie: (val: string) => { valid: boolean; value: string | null } }).unsignCookie(
                (request as FastifyRequest & { cookies: Record<string, string> }).cookies.token,
            );
            if (unsigned.valid && unsigned.value) {
                jwtToken = unsigned.value;
            }
        }
        // 3. Query param (EventSource fallback)
        const query = request.query as SSEQuerystring;
        if (!jwtToken && query.token) {
            jwtToken = query.token;
        }

        if (!jwtToken) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const payload = authService.verifyToken(jwtToken);
        if (!payload) {
            return reply.status(401).send({ error: 'Invalid or expired token' });
        }

        const userId = payload.userId;

        // --- Set SSE headers ---
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',       // Disable Nginx buffering
            'x-no-compression': 'true',       // Bypass @fastify/compress
        });

        // Send initial connected event
        const connected = JSON.stringify({
            type: 'connected',
            timestamp: new Date().toISOString(),
            data: { userId },
        });
        reply.raw.write(`event: connected\ndata: ${connected}\n\n`);

        // Register this connection
        await sseManager.addConnection(userId, reply);

        // Clean up on disconnect
        request.raw.on('close', () => {
            sseManager.removeConnection(userId, reply);
        });

        // Do NOT call reply.send() — the stream stays open
    });
};

export default sseRoutes;
