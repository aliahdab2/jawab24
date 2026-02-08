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

vi.mock('../src/config', () => ({
    config: {
        openai: { model: 'gpt-4o-mini', maxTokens: 300, temperature: 0.8 },
    },
}));

describe('Server (buildServer)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
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
});
