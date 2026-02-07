import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import instagramRoutes from '../../src/routes/instagram';

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(),
}));

vi.mock('../../src/controllers/instagram', () => ({
    instagramController: {
        getMedia: vi.fn(async (_req: any, reply: any) => reply.send({ success: true, data: [] })),
        getComments: vi.fn(async (_req: any, reply: any) => reply.send({ success: true, data: [] })),
        replyToComment: vi.fn(async (_req: any, reply: any) => reply.send({ success: true })),
        toggleAutoReply: vi.fn(async (_req: any, reply: any) => reply.send({ success: true })),
        syncMedia: vi.fn(async (_req: any, reply: any) => reply.send({ success: true })),
    },
}));

vi.mock('../../src/utils/swagger', () => ({
    auth: [{ bearerAuth: [] }],
}));

describe('Instagram Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.resetAllMocks();

        const { authenticate } = await import('../../src/middleware/auth');
        vi.mocked(authenticate).mockImplementation(async (req: any) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                const err: any = new Error('Unauthorized');
                err.statusCode = 401;
                throw err;
            }
            req.user = { userId: 'user-123' };
        });

        const { instagramController } = await import('../../src/controllers/instagram');
        vi.mocked(instagramController.getMedia).mockImplementation(async (_req: any, reply: any) => reply.send({ success: true, data: [] }));
        vi.mocked(instagramController.getComments).mockImplementation(async (_req: any, reply: any) => reply.send({ success: true, data: [] }));
        vi.mocked(instagramController.replyToComment).mockImplementation(async (_req: any, reply: any) => reply.send({ success: true }));
        vi.mocked(instagramController.toggleAutoReply).mockImplementation(async (_req: any, reply: any) => reply.send({ success: true }));
        vi.mocked(instagramController.syncMedia).mockImplementation(async (_req: any, reply: any) => reply.send({ success: true }));

        app = fastify();
        app.register(instagramRoutes);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    describe('401 Unauthorized - all routes without auth header', () => {
        it('GET /instagram/:pageId/media returns 401 without authorization', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/instagram/page-1/media',
            });

            expect(response.statusCode).toBe(401);
        });

        it('GET /instagram/media/:mediaId/comments returns 401 without authorization', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/instagram/media/media-1/comments',
            });

            expect(response.statusCode).toBe(401);
        });

        it('POST /instagram/comments/:commentId/reply returns 401 without authorization', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/instagram/comments/comment-1/reply',
                payload: { message: 'Thanks!' },
            });

            expect(response.statusCode).toBe(401);
        });

        it('PATCH /pages/:id/instagram-auto-reply returns 401 without authorization', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page-1/instagram-auto-reply',
                payload: { enabled: true },
            });

            expect(response.statusCode).toBe(401);
        });

        it('POST /instagram/:pageId/sync returns 401 without authorization', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/instagram/page-1/sync',
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('GET /instagram/:pageId/media (authenticated)', () => {
        it('returns media data when authenticated', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/instagram/page-1/media',
                headers: {
                    authorization: 'Bearer valid-token',
                },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true, data: [] });
        });
    });

    describe('POST /instagram/comments/:commentId/reply (authenticated)', () => {
        it('returns success when replying to a comment', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/instagram/comments/comment-1/reply',
                headers: {
                    authorization: 'Bearer valid-token',
                },
                payload: { message: 'Thanks for your comment!' },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true });
        });
    });

    describe('PATCH /pages/:id/instagram-auto-reply (authenticated)', () => {
        it('returns success when toggling auto-reply', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page-1/instagram-auto-reply',
                headers: {
                    authorization: 'Bearer valid-token',
                },
                payload: { enabled: true },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({ success: true });
        });
    });
});
