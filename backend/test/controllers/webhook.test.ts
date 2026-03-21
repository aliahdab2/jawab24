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
const {
    mockEnqueueComment,
    mockEnqueueMessage,
    mockGetPageByFacebookId,
    mockGetPageByInstagramId,
    mockFindOrCreateFromWebhook,
    mockStoreOutgoingMessage,
    mockGetLastIncomingTextFromSender,
    mockSendPrivateMessage,
    mockSendDirectMessage,
    mockRedisSet,
} = vi.hoisted(() => ({
    mockEnqueueComment: vi.fn().mockResolvedValue('mock-job-id'),
    mockEnqueueMessage: vi.fn().mockResolvedValue('mock-job-id'),
    mockGetPageByFacebookId: vi.fn().mockResolvedValue(null),
    mockGetPageByInstagramId: vi.fn().mockResolvedValue(null),
    mockFindOrCreateFromWebhook: vi.fn().mockResolvedValue({ message: { id: 'msg-1' }, isNew: true }),
    mockStoreOutgoingMessage: vi.fn().mockResolvedValue({}),
    mockGetLastIncomingTextFromSender: vi.fn().mockResolvedValue(null),
    mockSendPrivateMessage: vi.fn().mockResolvedValue(undefined),
    mockSendDirectMessage: vi.fn().mockResolvedValue('msg-id'),
    mockRedisSet: vi.fn().mockResolvedValue('OK'),
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
        set: mockRedisSet,
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

// Mock all services used by webhook controller
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByFacebookId: mockGetPageByFacebookId,
        getPageByInstagramId: mockGetPageByInstagramId,
    },
    isPageDisconnected: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: mockFindOrCreateFromWebhook,
        storeOutgoingMessage: mockStoreOutgoingMessage,
        getLastIncomingTextFromSender: mockGetLastIncomingTextFromSender,
        getSenderNameBySenderId: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        sendPrivateMessage: mockSendPrivateMessage,
    },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        sendDirectMessage: mockSendDirectMessage,
    },
}));

const { mockTranscribeFn } = vi.hoisted(() => ({
    mockTranscribeFn: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/transcription', () => ({
    transcriptionService: {
        transcribe: mockTranscribeFn,
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

    describe('POST /webhook (Non-Text Message Handling)', () => {
        const mockPage = {
            id: 'internal-page-id',
            accessToken: 'test-token',
            instagramAccountId: 'ig_account_123',
        };

        beforeEach(() => {
            // Reset page mocks to default (null) since some tests use mockResolvedValue
            mockGetPageByFacebookId.mockReset().mockResolvedValue(null);
            mockGetPageByInstagramId.mockReset().mockResolvedValue(null);
            mockTranscribeFn.mockReset().mockResolvedValue(null);
            mockFindOrCreateFromWebhook.mockReset().mockResolvedValue({ message: { id: 'msg-1' }, isNew: true });
            mockStoreOutgoingMessage.mockReset().mockResolvedValue({});
            mockGetLastIncomingTextFromSender.mockReset().mockResolvedValue(null);
            mockSendPrivateMessage.mockReset().mockResolvedValue(undefined);
            mockSendDirectMessage.mockReset().mockResolvedValue('msg-id');
            mockRedisSet.mockReset().mockResolvedValue('OK');
        });

        it('should store placeholder and send nudge for Facebook voice message', async () => {
            // Called twice: once for disconnection check, once in processNonTextMessage
            mockGetPageByFacebookId.mockResolvedValue(mockPage);
            mockRedisSet.mockResolvedValueOnce('OK'); // NX succeeded — no cooldown

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_voice_1',
                            attachments: [{ type: 'audio', payload: { url: 'https://example.com/voice.mp4' } }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Placeholder stored in DB
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, 'msg_voice_1', 'user_123', '[رسالة صوتية]',
            );

            // Nudge reply sent
            expect(mockSendPrivateMessage).toHaveBeenCalledWith(
                mockPage.accessToken, 'user_123', expect.stringContaining('الرسائل النصية'),
            );

            // Outgoing message stored
            expect(mockStoreOutgoingMessage).toHaveBeenCalledWith(
                mockPage.id, 'user_123', expect.stringContaining('الرسائل النصية'), 'template',
            );
        });

        it('should transcribe voice message and enqueue for AI reply when Whisper succeeds', async () => {
            mockGetPageByFacebookId.mockResolvedValue(mockPage);
            mockTranscribeFn.mockResolvedValueOnce({ text: 'كم سعر الجاكيت الأسود؟' });

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_voice_transcribed',
                            attachments: [{ type: 'audio', payload: { url: 'https://example.com/voice.mp4' } }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Transcribed text stored in DB (not placeholder)
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, 'msg_voice_transcribed', 'user_123', 'كم سعر الجاكيت الأسود؟',
            );

            // Enqueued for AI reply pipeline (pageId = platform ID, not internal UUID)
            expect(mockEnqueueMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'facebook_message',
                    pageId: 'page_123',
                    senderId: 'user_123',
                    text: 'كم سعر الجاكيت الأسود؟',
                }),
            );

            // No nudge sent — AI pipeline handles the reply
            expect(mockSendPrivateMessage).not.toHaveBeenCalled();
            expect(mockStoreOutgoingMessage).not.toHaveBeenCalled();
        });

        it('should fall back to nudge when transcription fails', async () => {
            mockGetPageByFacebookId.mockResolvedValue(mockPage);
            mockTranscribeFn.mockResolvedValueOnce(null); // Transcription failed
            mockRedisSet.mockResolvedValueOnce('OK');

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_voice_fail',
                            attachments: [{ type: 'audio', payload: { url: 'https://example.com/voice.mp4' } }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Placeholder stored (not transcription)
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, 'msg_voice_fail', 'user_123', '[رسالة صوتية]',
            );

            // Nudge sent as fallback
            expect(mockSendPrivateMessage).toHaveBeenCalled();

            // Not enqueued for AI reply
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it('should NOT send nudge when cooldown is active', async () => {
            mockGetPageByFacebookId.mockResolvedValue(mockPage);
            mockRedisSet.mockResolvedValueOnce(null); // NX failed — cooldown active

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_voice_2',
                            attachments: [{ type: 'audio' }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Placeholder still stored
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalled();

            // But no nudge sent
            expect(mockSendPrivateMessage).not.toHaveBeenCalled();
        });

        it('should use English nudge when sender previously wrote in English', async () => {
            mockGetPageByFacebookId.mockResolvedValue(mockPage);
            mockGetLastIncomingTextFromSender.mockResolvedValueOnce('Hi, I need help with my order');
            mockRedisSet.mockResolvedValueOnce('OK');

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_en' },
                        message: {
                            mid: 'msg_img_1',
                            attachments: [{ type: 'image' }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 50));

            // English placeholder
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, 'msg_img_1', 'user_en', '[Image]',
            );

            // English nudge
            expect(mockSendPrivateMessage).toHaveBeenCalledWith(
                mockPage.accessToken, 'user_en', expect.stringContaining('text messages'),
            );
        });

        it('should do nothing if page is not found', async () => {
            // getPageByFacebookId returns null (default) — both for disconnect check and processNonTextMessage

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'unknown_page',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_voice_3',
                            attachments: [{ type: 'audio' }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Page lookup happens (for disconnection check + processNonTextMessage) but returns null
            expect(mockFindOrCreateFromWebhook).not.toHaveBeenCalled();
            expect(mockSendPrivateMessage).not.toHaveBeenCalled();
        });

        it('should handle Instagram non-text DMs', async () => {
            mockGetPageByInstagramId.mockResolvedValue(mockPage);
            mockRedisSet.mockResolvedValueOnce('OK');

            const webhookPayload = {
                object: 'instagram',
                entry: [{
                    id: 'ig_account_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'ig_user_789' },
                        message: {
                            mid: 'ig_msg_voice_1',
                            attachments: [{ type: 'video' }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Placeholder stored
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, 'ig_msg_voice_1', 'ig_user_789', '[فيديو]',
            );

            // Nudge sent via Instagram API
            expect(mockSendDirectMessage).toHaveBeenCalledWith(
                'ig_account_123', 'ig_user_789',
                expect.stringContaining('الرسائل النصية'),
                mockPage.accessToken,
            );
        });

        it('should not store or reply for non-text messages without sender', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        // No sender field
                        message: {
                            mid: 'msg_nosender',
                            attachments: [{ type: 'file' }],
                        },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 50));

            // processNonTextMessage exits early — no storage or reply
            expect(mockFindOrCreateFromWebhook).not.toHaveBeenCalled();
            expect(mockSendPrivateMessage).not.toHaveBeenCalled();
        });
    });
});

