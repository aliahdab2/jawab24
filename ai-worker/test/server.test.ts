import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies that routes.ts imports
vi.mock('../src/services/openai', () => ({
    openaiService: {
        generateReply: vi.fn(),
        isConfigured: vi.fn().mockReturnValue(true),
    },
}));

vi.mock('../src/lib/sentry', () => ({
    Sentry: { captureException: vi.fn() },
}));

// Mutable so individual tests can toggle the shared secret the auth hook reads at
// request time (the hook references config.workerSecret via the getter below).
const configState = vi.hoisted(() => ({ workerSecret: '' }));

vi.mock('../src/config', () => ({
    config: {
        openai: { model: 'gpt-4.1-mini', maxTokens: 300, temperature: 0.8 },
        get workerSecret() { return configState.workerSecret; },
    },
}));

describe('Server (buildServer)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        configState.workerSecret = ''; // default: auth disabled (dev)
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('should create a Fastify instance', async () => {
        const { buildServer } = await import('../src/server');
        const server = await buildServer({ logger: false });
        expect(server).toBeDefined();
        expect(typeof server.inject).toBe('function');
        await server.close();
    });

    it('should register routes (health endpoint responds)', async () => {
        const { buildServer } = await import('../src/server');
        const server = await buildServer({ logger: false });
        const res = await server.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        await server.close();
    });

    it('should allow all origins in development', async () => {
        process.env.NODE_ENV = 'development';
        const { buildServer } = await import('../src/server');
        const server = await buildServer({ logger: false });
        const res = await server.inject({
            method: 'GET',
            url: '/health',
            headers: { origin: 'http://localhost:3001' },
        });
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
        await server.close();
    });

    it('should register rate limit plugin', async () => {
        const { buildServer } = await import('../src/server');
        const server = await buildServer({ logger: false });
        // Rate limit headers should be present on responses
        const res = await server.inject({ method: 'GET', url: '/health' });
        // Rate limit plugin adds x-ratelimit-limit header
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(Number(res.headers['x-ratelimit-limit'])).toBe(100);
        await server.close();
    });

    it('should set rate limit time window to 1 minute', async () => {
        const { buildServer } = await import('../src/server');
        const server = await buildServer({ logger: false });
        const res = await server.inject({ method: 'GET', url: '/health' });
        // x-ratelimit-reset is in seconds, should be <= 60
        const reset = Number(res.headers['x-ratelimit-reset']);
        expect(reset).toBeLessThanOrEqual(60);
        await server.close();
    });

    it('should suppress logger when logger: false is passed', async () => {
        const { buildServer } = await import('../src/server');
        const server = await buildServer({ logger: false });
        // Server should be created without throwing
        expect(server).toBeDefined();
        await server.close();
    });

    describe('shared-secret auth (X-AI-Worker-Secret)', () => {
        const SECRET = 'test-worker-secret-1234567890';

        it('keeps /health open even when a secret is configured (Docker healthcheck)', async () => {
            configState.workerSecret = SECRET;
            const { buildServer } = await import('../src/server');
            const server = await buildServer({ logger: false });
            const res = await server.inject({ method: 'GET', url: '/health' });
            expect(res.statusCode).toBe(200);
            await server.close();
        });

        it('rejects a protected route with no secret header (401)', async () => {
            configState.workerSecret = SECRET;
            const { buildServer } = await import('../src/server');
            const server = await buildServer({ logger: false });
            const res = await server.inject({ method: 'GET', url: '/status' });
            expect(res.statusCode).toBe(401);
            await server.close();
        });

        it('rejects a protected route with a wrong secret (401)', async () => {
            configState.workerSecret = SECRET;
            const { buildServer } = await import('../src/server');
            const server = await buildServer({ logger: false });
            const res = await server.inject({
                method: 'GET',
                url: '/status',
                headers: { 'x-ai-worker-secret': 'wrong-secret-value-000' },
            });
            expect(res.statusCode).toBe(401);
            await server.close();
        });

        it('allows a protected route with the correct secret', async () => {
            configState.workerSecret = SECRET;
            const { buildServer } = await import('../src/server');
            const server = await buildServer({ logger: false });
            const res = await server.inject({
                method: 'GET',
                url: '/status',
                headers: { 'x-ai-worker-secret': SECRET },
            });
            expect(res.statusCode).toBe(200);
            await server.close();
        });

        it('does not enforce auth when no secret is configured (local dev)', async () => {
            configState.workerSecret = '';
            const { buildServer } = await import('../src/server');
            const server = await buildServer({ logger: false });
            const res = await server.inject({ method: 'GET', url: '/status' });
            expect(res.statusCode).toBe(200);
            await server.close();
        });
    });
});
