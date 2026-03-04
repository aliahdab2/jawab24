import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import compress from '@fastify/compress';

describe('Compression Middleware', () => {
    let server: FastifyInstance;

    beforeAll(async () => {
        server = fastify();

        // Register compression middleware with same config as production
        await server.register(compress, {
            global: true,
            threshold: 1024,
            encodings: ['br', 'gzip', 'deflate'],
        });

        // Add test routes
        server.get('/small', async () => {
            return { message: 'Small response' }; // < 1KB, should not be compressed
        });

        server.get('/large', async () => {
            // Generate a large response > 1KB
            const largeData = {
                message: 'Large response',
                data: Array(100).fill({
                    id: 1,
                    name: 'Test User',
                    email: 'test@example.com',
                    description: 'This is a test description that adds more data to the response',
                }),
            };
            return largeData;
        });

        await server.ready();
    });

    afterAll(async () => {
        await server.close();
    });

    it('should not compress responses smaller than threshold', async () => {
        const response = await server.inject({
            method: 'GET',
            url: '/small',
            headers: {
                'accept-encoding': 'gzip, deflate, br',
            },
        });

        expect(response.statusCode).toBe(200);
        // Small responses should not have content-encoding header
        expect(response.headers['content-encoding']).toBeUndefined();
    });

    it('should compress large responses with gzip', async () => {
        const response = await server.inject({
            method: 'GET',
            url: '/large',
            headers: {
                'accept-encoding': 'gzip',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-encoding']).toBe('gzip');

        // Verify the response is actually compressed by comparing with uncompressed
        const uncompressedResponse = await server.inject({
            method: 'GET',
            url: '/large',
        });

        const compressedSize = response.rawPayload.length;
        const uncompressedSize = uncompressedResponse.rawPayload.length;
        expect(compressedSize).toBeLessThan(uncompressedSize);
    });

    it('should prefer brotli over gzip when both are accepted', async () => {
        const response = await server.inject({
            method: 'GET',
            url: '/large',
            headers: {
                'accept-encoding': 'gzip, br',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-encoding']).toBe('br');
    });

    it('should handle requests without accept-encoding header', async () => {
        const response = await server.inject({
            method: 'GET',
            url: '/large',
        });

        expect(response.statusCode).toBe(200);
        // Without accept-encoding, response should not be compressed
        expect(response.headers['content-encoding']).toBeUndefined();
    });

    it('should achieve significant compression ratio', async () => {
        const response = await server.inject({
            method: 'GET',
            url: '/large',
            headers: {
                'accept-encoding': 'br',
            },
        });

        expect(response.statusCode).toBe(200);

        // Get uncompressed version for comparison
        const uncompressedResponse = await server.inject({
            method: 'GET',
            url: '/large',
        });

        const compressedSize = response.rawPayload.length;
        const uncompressedSize = uncompressedResponse.rawPayload.length;

        // Expect at least 50% compression for this type of data
        const compressionRatio = (1 - compressedSize / uncompressedSize) * 100;
        expect(compressionRatio).toBeGreaterThan(50);
    });
});
