import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import healthRoutes from '../../src/routes/health';

// Import setup to ensure DATABASE_URL points at the test DB
// and the schema is pushed before tests run.
import './setup';

describe('Health Routes — Integration (real Postgres)', () => {
    let app: FastifyInstance;

    let savedCleanupToken: string | undefined;

    beforeEach(async () => {
        savedCleanupToken = process.env.CLEANUP_SECRET_TOKEN;
        app = fastify();
        app.register(healthRoutes);
        await app.ready();
    });

    afterEach(async () => {
        // Restore env to prevent leaks between tests
        if (savedCleanupToken === undefined) {
            delete process.env.CLEANUP_SECRET_TOKEN;
        } else {
            process.env.CLEANUP_SECRET_TOKEN = savedCleanupToken;
        }
        await app.close();
    });

    // =========================================================
    // 1. Healthy state: DB is connected → 200
    // =========================================================
    it('GET /health returns 200 with status=healthy when DB is up', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.status).toBe('healthy');
        expect(body.services.database.status).toBe('up');
        expect(body.services.database.responseTime).toBeGreaterThanOrEqual(0);
        expect(body.timestamp).toBeDefined();
        expect(body.uptime).toBeGreaterThanOrEqual(0);
    });

    // =========================================================
    // 2. Liveness probe → always 200
    // =========================================================
    it('GET /health/live returns 200 with status=alive', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health/live',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: 'alive' });
    });

    // =========================================================
    // 3. Readiness probe → 200 when DB is reachable
    // =========================================================
    it('GET /health/ready returns 200 with status=ready when DB is up', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health/ready',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: 'ready' });
    });

    // =========================================================
    // 4. Pipeline metrics endpoint (token-protected)
    // =========================================================
    it('GET /health/pipeline-metrics returns 401 without token', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health/pipeline-metrics',
        });

        expect(response.statusCode).toBe(401);
    });

    it('GET /health/pipeline-metrics returns metrics with valid token', async () => {
        const TOKEN = 'test-cleanup-token';
        process.env.CLEANUP_SECRET_TOKEN = TOKEN;

        const response = await app.inject({
            method: 'GET',
            url: '/health/pipeline-metrics',
            headers: { 'x-cleanup-token': TOKEN },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body).toHaveProperty('since');
        expect(body).toHaveProperty('counters');
    });
});
