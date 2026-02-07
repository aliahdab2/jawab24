import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { requestIdMiddleware } from '../../src/middleware/requestId';

describe('requestIdMiddleware', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequest = {
            id: 'fastify-generated-id',
            headers: {},
        } as any;
        mockReply = {
            header: vi.fn().mockReturnThis(),
        };
    });

    it('should use x-request-id header when provided', async () => {
        (mockRequest as any).headers = { 'x-request-id': 'client-trace-abc' };

        await requestIdMiddleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.header).toHaveBeenCalledWith('x-request-id', 'client-trace-abc');
    });

    it('should fall back to Fastify request.id when no header', async () => {
        await requestIdMiddleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.header).toHaveBeenCalledWith('x-request-id', 'fastify-generated-id');
    });

    it('should generate a UUID when no header and no request.id', async () => {
        (mockRequest as any).id = undefined;
        (mockRequest as any).headers = {};

        await requestIdMiddleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.header).toHaveBeenCalledWith(
            'x-request-id',
            expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        );
    });

    it('should always set the x-request-id response header', async () => {
        await requestIdMiddleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

        expect(mockReply.header).toHaveBeenCalledTimes(1);
        expect((mockReply.header as any).mock.calls[0][0]).toBe('x-request-id');
    });
});
