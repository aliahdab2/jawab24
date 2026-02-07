import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '../../src/middleware/validation';

describe('validation middleware', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequest = {
            body: {},
            params: {},
            query: {},
        } as any;
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
    });

    // ─── validateBody ─────────────────────────────────────

    describe('validateBody', () => {
        const schema = z.object({
            name: z.string().min(1),
            age: z.number().int().positive(),
        });

        it('should pass and parse valid body', async () => {
            mockRequest.body = { name: 'Ali', age: 30 };
            const middleware = validateBody(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockRequest.body).toEqual({ name: 'Ali', age: 30 });
            expect(mockReply.status).not.toHaveBeenCalled();
        });

        it('should coerce types when schema allows it', async () => {
            const coercingSchema = z.object({ count: z.coerce.number() });
            mockRequest.body = { count: '42' };

            const middleware = validateBody(coercingSchema);
            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockRequest.body).toEqual({ count: 42 });
        });

        it('should return 400 with details on invalid body', async () => {
            mockRequest.body = { name: '', age: -5 };
            const middleware = validateBody(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: true,
                    code: 'VALIDATION_ERROR',
                    details: expect.arrayContaining([
                        expect.objectContaining({ path: 'name' }),
                        expect.objectContaining({ path: 'age' }),
                    ]),
                }),
            );
        });

        it('should return 400 when body is missing required fields', async () => {
            mockRequest.body = {};
            const middleware = validateBody(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
        });

        it('should re-throw non-Zod errors', async () => {
            const badSchema = {
                parse: () => { throw new Error('unexpected'); },
            } as unknown as z.ZodType;

            const middleware = validateBody(badSchema);

            await expect(
                middleware(mockRequest as FastifyRequest, mockReply as FastifyReply),
            ).rejects.toThrow('unexpected');
        });
    });

    // ─── validateParams ───────────────────────────────────

    describe('validateParams', () => {
        const schema = z.object({
            id: z.string().uuid(),
        });

        it('should pass and parse valid params', async () => {
            const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
            mockRequest.params = { id: uuid };
            const middleware = validateParams(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockRequest.params).toEqual({ id: uuid });
            expect(mockReply.status).not.toHaveBeenCalled();
        });

        it('should return 400 with details on invalid params', async () => {
            mockRequest.params = { id: 'not-a-uuid' };
            const middleware = validateParams(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: true,
                    message: 'Invalid request parameters',
                    code: 'VALIDATION_ERROR',
                    details: expect.arrayContaining([
                        expect.objectContaining({ path: 'id' }),
                    ]),
                }),
            );
        });

        it('should re-throw non-Zod errors', async () => {
            const badSchema = {
                parse: () => { throw new TypeError('oops'); },
            } as unknown as z.ZodType;

            const middleware = validateParams(badSchema);

            await expect(
                middleware(mockRequest as FastifyRequest, mockReply as FastifyReply),
            ).rejects.toThrow('oops');
        });
    });

    // ─── validateQuery ────────────────────────────────────

    describe('validateQuery', () => {
        const schema = z.object({
            page: z.coerce.number().int().positive().default(1),
            limit: z.coerce.number().int().min(1).max(100).default(20),
        });

        it('should pass and parse valid query', async () => {
            mockRequest.query = { page: '2', limit: '50' };
            const middleware = validateQuery(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockRequest.query).toEqual({ page: 2, limit: 50 });
            expect(mockReply.status).not.toHaveBeenCalled();
        });

        it('should apply defaults for missing query params', async () => {
            mockRequest.query = {};
            const middleware = validateQuery(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockRequest.query).toEqual({ page: 1, limit: 20 });
        });

        it('should return 400 for invalid query params', async () => {
            mockRequest.query = { page: '-1', limit: '999' };
            const middleware = validateQuery(schema);

            await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: true,
                    message: 'Invalid query parameters',
                    code: 'VALIDATION_ERROR',
                }),
            );
        });

        it('should re-throw non-Zod errors', async () => {
            const badSchema = {
                parse: () => { throw new RangeError('out of range'); },
            } as unknown as z.ZodType;

            const middleware = validateQuery(badSchema);

            await expect(
                middleware(mockRequest as FastifyRequest, mockReply as FastifyReply),
            ).rejects.toThrow('out of range');
        });
    });
});
