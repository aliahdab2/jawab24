import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

describe('Swagger / OpenAPI smoke test', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = fastify();

        await app.register(swagger, {
            openapi: {
                info: { title: 'Test API', version: '1.0.0' },
            },
        });

        await app.register(swaggerUi, { routePrefix: '/docs' });

        // Add a sample route with schema tags
        app.get(
            '/test',
            {
                schema: {
                    tags: ['Test'],
                    summary: 'Test route',
                    response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } },
                },
            },
            async () => ({ ok: true }),
        );

        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    it('GET /docs/json returns 200 with valid OpenAPI JSON', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        expect(response.statusCode).toBe(200);

        const spec = JSON.parse(response.payload);

        expect(spec).toHaveProperty('openapi');
        expect(spec).toHaveProperty('info');
        expect(spec).toHaveProperty('paths');
        expect(spec.info.title).toBe('Test API');
        expect(spec.info.version).toBe('1.0.0');
    });

    it('OpenAPI spec includes the sample route tag', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const spec = JSON.parse(response.payload);

        // The /test route should appear in paths
        expect(spec.paths).toHaveProperty('/test');

        // The /test GET operation should carry the "Test" tag
        const getOp = spec.paths['/test'].get;
        expect(getOp).toBeDefined();
        expect(getOp.tags).toContain('Test');
    });
});
