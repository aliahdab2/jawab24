import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import authRoutes from '../../src/routes/auth';
import pagesRoutes from '../../src/routes/pages';
import webhookRoutes from '../../src/routes/webhook';

/**
 * API Routes Integration Tests
 * 
 * These tests verify that all API routes are correctly registered
 * and respond to requests (preventing 404 errors in production).
 */
describe('API Routes Registration', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        await app.register(authRoutes);
        await app.register(pagesRoutes);
        await app.register(webhookRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('Auth Routes', () => {
        it('POST /auth/facebook should be registered', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/auth/facebook',
                payload: {},
            });
            // Route exists (not 404)
            expect(response.statusCode).not.toBe(404);
        });

        it('GET /auth/me should be registered', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/auth/me',
            });
            // Route exists (not 404)
            expect(response.statusCode).not.toBe(404);
        });
    });

    describe('Pages Routes', () => {
        it('GET /pages should be registered', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/pages',
            });
            // Route exists (will be 401 without auth, but not 404)
            expect(response.statusCode).not.toBe(404);
        });

        it('POST /pages should be registered', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/pages',
                payload: {},
            });
            expect(response.statusCode).not.toBe(404);
        });

        it('POST /pages/sync should be registered', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/pages/sync',
                payload: {},
            });
            expect(response.statusCode).not.toBe(404);
        });
    });

    describe('Webhook Routes', () => {
        it('GET /webhook should be registered (verification)', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/webhook',
                query: {
                    'hub.mode': 'subscribe',
                    'hub.verify_token': 'test',
                    'hub.challenge': 'test-challenge',
                },
            });
            // Route exists
            expect(response.statusCode).not.toBe(404);
        });

        it('POST /webhook should be registered (events)', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: { object: 'page', entry: [] },
            });
            // Route exists
            expect(response.statusCode).not.toBe(404);
        });
    });
});

describe('Route Method Validation', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = Fastify();
        await app.register(authRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    it('GET /auth/facebook should return 404 (only POST allowed)', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/auth/facebook',
        });
        expect(response.statusCode).toBe(404);
    });

    it('POST /auth/me should return 404 (only GET allowed)', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/auth/me',
            payload: {},
        });
        expect(response.statusCode).toBe(404);
    });
});










