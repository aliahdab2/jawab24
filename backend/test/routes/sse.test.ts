import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

// Mock dependencies
vi.mock('../../src/services/auth', () => ({
    authService: {
        verifyToken: vi.fn(),
    },
}));

vi.mock('../../src/lib/sseManager', () => ({
    sseManager: {
        addConnection: vi.fn(),
        removeConnection: vi.fn().mockResolvedValue(undefined),
    },
}));

import sseRoutes from '../../src/routes/sse';
import { authService } from '../../src/services/auth';
import { sseManager } from '../../src/lib/sseManager';

describe('SSE Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Make addConnection end the raw response so inject() doesn't hang.
        // In production the stream stays open, but in tests we need it to complete.
        (sseManager.addConnection as ReturnType<typeof vi.fn>).mockImplementation(
            async (_userId: string, reply: any) => {
                // Give a tick for the initial "connected" event to be written first
                await new Promise((r) => setTimeout(r, 5));
                try { reply.raw.end(); } catch { /* already closed */ }
            },
        );

        app = fastify();
        await app.register(sseRoutes, { prefix: '/sse' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    describe('GET /sse/events', () => {
        it('should return 401 when no token provided', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/sse/events',
            });

            expect(res.statusCode).toBe(401);
            expect(res.json()).toEqual({ error: 'Unauthorized' });
        });

        it('should return 401 when token is invalid', async () => {
            (authService.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue(null);

            const res = await app.inject({
                method: 'GET',
                url: '/sse/events',
                headers: { authorization: 'Bearer invalid-token' },
            });

            expect(res.statusCode).toBe(401);
            expect(res.json()).toEqual({ error: 'Invalid or expired token' });
        });

        it('should accept token from Authorization header', async () => {
            (authService.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'u1' });

            const res = await app.inject({
                method: 'GET',
                url: '/sse/events',
                headers: { authorization: 'Bearer valid-token' },
            });

            expect(authService.verifyToken).toHaveBeenCalledWith('valid-token');
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toBe('text/event-stream');
        });

        it('should accept token from query parameter', async () => {
            (authService.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'u2' });

            const res = await app.inject({
                method: 'GET',
                url: '/sse/events?token=query-token',
            });

            expect(authService.verifyToken).toHaveBeenCalledWith('query-token');
            expect(res.statusCode).toBe(200);
        });

        it('should register connection with sseManager on success', async () => {
            (authService.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'u3' });

            await app.inject({
                method: 'GET',
                url: '/sse/events',
                headers: { authorization: 'Bearer tok' },
            });

            expect(sseManager.addConnection).toHaveBeenCalledWith('u3', expect.anything());
        });

        it('should send initial connected event', async () => {
            (authService.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'u4' });

            const res = await app.inject({
                method: 'GET',
                url: '/sse/events',
                headers: { authorization: 'Bearer tok' },
            });

            expect(res.body).toContain('event: connected');
            expect(res.body).toContain('"userId":"u4"');
        });

        it('should set correct SSE headers', async () => {
            (authService.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'u5' });

            const res = await app.inject({
                method: 'GET',
                url: '/sse/events',
                headers: { authorization: 'Bearer tok' },
            });

            expect(res.headers['cache-control']).toBe('no-cache, no-transform');
            expect(res.headers['connection']).toBe('keep-alive');
            expect(res.headers['x-accel-buffering']).toBe('no');
        });

        it('should prefer Authorization header over query param', async () => {
            (authService.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'u6' });

            await app.inject({
                method: 'GET',
                url: '/sse/events?token=query-tok',
                headers: { authorization: 'Bearer header-tok' },
            });

            expect(authService.verifyToken).toHaveBeenCalledWith('header-tok');
        });
    });
});
