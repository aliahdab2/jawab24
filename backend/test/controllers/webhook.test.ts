import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import webhookRoutes from '../../src/routes/webhook';

// Mock reply service before importing
vi.mock('../../src/services/reply', () => ({
    replyService: {
        processComment: vi.fn().mockResolvedValue({
            success: true,
            commentId: 'comment_123',
            replyText: 'Thank you!',
            replyMethod: 'ai',
        }),
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        facebook: {
            webhookVerifyToken: 'test_verify_token',
        },
    },
}));

describe('Webhook Controller', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(webhookRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /webhook (Verification)', () => {
        it('should verify webhook with correct token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/webhook',
                query: {
                    'hub.mode': 'subscribe',
                    'hub.verify_token': 'test_verify_token',
                    'hub.challenge': 'challenge_code_123',
                },
            });

            expect(response.statusCode).toBe(200);
            expect(response.payload).toBe('challenge_code_123');
        });

        it('should reject webhook with incorrect token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/webhook',
                query: {
                    'hub.mode': 'subscribe',
                    'hub.verify_token': 'wrong_token',
                    'hub.challenge': 'challenge_code_123',
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return 400 if parameters are missing', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/webhook',
                query: {},
            });

            expect(response.statusCode).toBe(400);
        });

        it('should reject non-subscribe mode', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/webhook',
                query: {
                    'hub.mode': 'unsubscribe',
                    'hub.verify_token': 'test_verify_token',
                    'hub.challenge': 'challenge_code_123',
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('POST /webhook (Event Handling)', () => {
        it('should accept page events and return 200', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'feed',
                                value: {
                                    item: 'comment',
                                    verb: 'add',
                                    comment_id: 'comment_123',
                                    post_id: 'post_123',
                                    message: 'Great product!',
                                    from: {
                                        id: 'user_123',
                                        name: 'John Doe',
                                    },
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            expect(response.payload).toBe('EVENT_RECEIVED');
        });

        it('should return 404 for non-page objects', async () => {
            const webhookPayload = {
                object: 'user',
                entry: [],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(404);
        });

        it('should handle multiple entries', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'feed',
                                value: {
                                    item: 'comment',
                                    verb: 'add',
                                    comment_id: 'comment_1',
                                    post_id: 'post_1',
                                    message: 'Comment 1',
                                },
                            },
                        ],
                    },
                    {
                        id: 'page_456',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'feed',
                                value: {
                                    item: 'comment',
                                    verb: 'add',
                                    comment_id: 'comment_2',
                                    post_id: 'post_2',
                                    message: 'Comment 2',
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
        });

        it('should handle post creation events', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'feed',
                                value: {
                                    item: 'post',
                                    verb: 'add',
                                    post_id: 'post_123',
                                    message: 'New post!',
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
        });

        it('should ignore comment edit events', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'feed',
                                value: {
                                    item: 'comment',
                                    verb: 'edit',
                                    comment_id: 'comment_123',
                                    post_id: 'post_123',
                                    message: 'Edited comment',
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            // replyService.processComment should NOT be called for edits
        });

        it('should ignore comment delete events', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'feed',
                                value: {
                                    item: 'comment',
                                    verb: 'remove',
                                    comment_id: 'comment_123',
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
        });

        it('should handle messaging events (not processed)', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        messaging: [
                            {
                                sender: { id: 'user_123' },
                                recipient: { id: 'page_123' },
                                message: { text: 'Hello!' },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
        });
    });
});

