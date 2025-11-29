import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import authRoutes from '../../src/routes/auth';

describe('Auth Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        await app.register(authRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('POST /auth/facebook', () => {
        it('should return 400 if code is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {},
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.body);
            expect(body.error).toBe('Authorization code is required');
        });

        it('should accept POST requests with code', async () => {
            // This will fail at Facebook API level, but route should accept the request
            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: { code: 'test-code' },
            });

            // Should not be 404 (route exists)
            expect(response.statusCode).not.toBe(404);
            // Will be 401 because Facebook will reject the fake code
            expect([401, 500]).toContain(response.statusCode);
        });
    });

    describe('GET /auth/me', () => {
        it('should return 401 without authentication', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
            });

            expect(response.statusCode).toBe(401);
        });
    });
});
