import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import fastify from 'fastify';
import webhookRoutes from '../../src/routes/webhook';
import { enqueueComment, enqueueMessage } from '../../src/lib/replyQueue';

/** Generate a valid X-Hub-Signature-256 header for a given payload */
function generateSignature(payload: object): string {
    const body = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', 'test_app_secret')
        .update(body)
        .digest('hex');
    return `sha256=${signature}`;
}

// Mock the reply queue - use vi.hoisted to create mock functions before hoisting
const { mockEnqueueComment, mockEnqueueMessage } = vi.hoisted(() => ({
    mockEnqueueComment: vi.fn().mockResolvedValue('mock-job-id'),
    mockEnqueueMessage: vi.fn().mockResolvedValue('mock-job-id'),
}));

vi.mock('../../src/lib/replyQueue', () => ({
    enqueueComment: mockEnqueueComment,
    enqueueMessage: mockEnqueueMessage,
    REPLY_QUEUE_NAME: 'reply-processing-queue',
}));

// Mock Redis
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
        quit: vi.fn(),
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        facebook: {
            webhookVerifyToken: 'test_verify_token',
            appSecret: 'test_app_secret',
            graphApiVersion: 'v18.0',
        },
    },
}));

describe('Webhook Controller', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();

        // Capture raw body for webhook signature verification
        app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req: any, body: Buffer, done: any) => {
            req.rawBody = body;
            try {
                done(null, JSON.parse(body.toString()));
            } catch (err) {
                done(err, undefined);
            }
        });

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

    describe('POST /webhook (Signature Verification)', () => {
        it('should reject requests without a signature header', async () => {
            const webhookPayload = { object: 'page', entry: [] };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(403);
        });

        it('should reject requests with an invalid signature', async () => {
            const webhookPayload = { object: 'page', entry: [] };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
                payload: webhookPayload,
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
        });

        it('should handle messaging events and enqueue message', async () => {
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
                                message: { mid: 'msg_123', text: 'Hello!' },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            
            // Give async processing time to complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(mockEnqueueMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'facebook_message',
                    pageId: 'page_123',
                    messageId: 'msg_123',
                    senderId: 'user_123',
                    text: 'Hello!',
                })
            );
        });

        it('should enqueue comment jobs for new comments', async () => {
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            
            // Give async processing time to complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(mockEnqueueComment).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'facebook_comment',
                    pageId: 'page_123',
                    postId: 'post_123',
                    commentId: 'comment_123',
                    text: 'Great product!',
                    senderId: 'user_123',
                    senderName: 'John Doe',
                })
            );
        });

        it('should NOT enqueue comment jobs for page own comments', async () => {
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
                                    message: 'Reply from page',
                                    from: {
                                        id: 'page_123', // Same as page ID
                                        name: 'My Page',
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            
            // Give async processing time to complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Should NOT be called for page's own comments
            expect(mockEnqueueComment).not.toHaveBeenCalled();
        });

        it('should NOT enqueue Facebook echo messages (bot own messages reflected back)', async () => {
            // Facebook reflects the bot's own outgoing messages back as webhook events
            // with is_echo=true. Without filtering, these would create infinite reply loops.
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        messaging: [
                            {
                                sender: { id: 'page_123' },
                                recipient: { id: 'user_123' },
                                message: {
                                    mid: 'echo_msg_123',
                                    text: 'This is the bot reply',
                                    is_echo: true,
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);

            // Give async processing time to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            // Echo messages must NOT be enqueued — they are our own outgoing messages
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it('should enqueue non-echo Facebook messages normally', async () => {
            // Normal user message (is_echo is absent/false) should be enqueued
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
                                message: {
                                    mid: 'msg_normal',
                                    text: 'Hello!',
                                    // no is_echo field — this is a real user message
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockEnqueueMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'facebook_message',
                    messageId: 'msg_normal',
                    text: 'Hello!',
                })
            );
        });

        it('should NOT enqueue for comment edits', async () => {
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
                                    verb: 'edit', // Edit, not add
                                    comment_id: 'comment_123',
                                    post_id: 'post_123',
                                    message: 'Edited comment',
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            
            // Give async processing time to complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(mockEnqueueComment).not.toHaveBeenCalled();
        });
    });

    describe('POST /webhook (Instagram Events)', () => {
        it('should accept Instagram events and return 200', async () => {
            const webhookPayload = {
                object: 'instagram',
                entry: [
                    {
                        id: 'ig_account_123',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'comments',
                                value: {
                                    id: 'ig_comment_123',
                                    text: 'Nice post!',
                                    media: { id: 'media_456' },
                                    from: {
                                        id: 'ig_user_789',
                                        username: 'johndoe',
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            expect(response.payload).toBe('EVENT_RECEIVED');
        });

        it('should enqueue Instagram comment jobs', async () => {
            const webhookPayload = {
                object: 'instagram',
                entry: [
                    {
                        id: 'ig_account_123',
                        time: Date.now(),
                        changes: [
                            {
                                field: 'comments',
                                value: {
                                    id: 'ig_comment_123',
                                    text: 'Nice post!',
                                    media: { id: 'media_456' },
                                    from: {
                                        id: 'ig_user_789',
                                        username: 'johndoe',
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
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            
            // Give async processing time to complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(mockEnqueueComment).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'instagram_comment',
                    pageId: 'ig_account_123',
                    postId: 'media_456',
                    commentId: 'ig_comment_123',
                    text: 'Nice post!',
                    senderId: 'ig_user_789',
                    senderName: 'johndoe',
                })
            );
        });

        it('should NOT enqueue Instagram echo messages (bot own DMs reflected back)', async () => {
            const webhookPayload = {
                object: 'instagram',
                entry: [
                    {
                        id: 'ig_account_123',
                        time: Date.now(),
                        messaging: [
                            {
                                sender: { id: 'ig_account_123' },
                                message: {
                                    mid: 'ig_echo_msg',
                                    text: 'Bot auto-reply',
                                    is_echo: true,
                                },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);

            await new Promise(resolve => setTimeout(resolve, 50));

            // Echo messages must NOT be enqueued
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it('should enqueue Instagram message jobs', async () => {
            const webhookPayload = {
                object: 'instagram',
                entry: [
                    {
                        id: 'ig_account_123',
                        time: Date.now(),
                        messaging: [
                            {
                                sender: { id: 'ig_user_789' },
                                message: { mid: 'ig_msg_123', text: 'Hello via DM!' },
                            },
                        ],
                    },
                ],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            
            // Give async processing time to complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(mockEnqueueMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'instagram_message',
                    pageId: 'ig_account_123',
                    messageId: 'ig_msg_123',
                    senderId: 'ig_user_789',
                    text: 'Hello via DM!',
                })
            );
        });
    });
});

