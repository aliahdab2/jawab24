import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pageLinkedInstagramCredential } from '../../src/services/instagramCredential';
import crypto from 'crypto';
import fastify, { type FastifyRequest } from 'fastify';
import webhookRoutes from '../../src/routes/webhook';

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
    mockFinalizeEnrichment,
    mockStoreOutgoingMessage,
    mockGetLastIncomingTextFromSender,
    mockSendPrivateMessage,
    mockSendDirectMessage,
    mockRedisSet,
    mockRedisIncr,
    mockGetPost,
    mockOnPostPublished,
    mockSendTypingIndicator,
    mockSendMetaImageAttachment,
    mockAcquireMutex,
} = vi.hoisted(() => ({
    mockEnqueueComment: vi.fn().mockResolvedValue('mock-job-id'),
    mockEnqueueMessage: vi.fn().mockResolvedValue('mock-job-id'),
    mockGetPageByFacebookId: vi.fn().mockResolvedValue({ id: 'internal-page-123', facebookPageId: 'page_123', accessToken: 'token-abc', name: 'Test Page', userId: 'user-1', workspaceId: 'ws-1' }),
    mockGetPageByInstagramId: vi.fn().mockResolvedValue({ id: 'internal-ig-123', facebookPageId: 'page_123', accessToken: 'token-ig', name: 'IG Page', userId: 'user-1', workspaceId: 'ws-1' }),
    mockFindOrCreateFromWebhook: vi.fn().mockResolvedValue({ message: { id: 'msg-1', enrichmentStatus: 'pending' }, isNew: true }),
    mockFinalizeEnrichment: vi.fn().mockResolvedValue(true),
    mockStoreOutgoingMessage: vi.fn().mockResolvedValue({}),
    mockGetLastIncomingTextFromSender: vi.fn().mockResolvedValue(null),
    mockSendPrivateMessage: vi.fn().mockResolvedValue(undefined),
    mockSendDirectMessage: vi.fn().mockResolvedValue('msg-id'),
    mockRedisSet: vi.fn().mockResolvedValue('OK'),
    mockRedisIncr: vi.fn().mockResolvedValue(1),
    mockGetPost: vi.fn().mockResolvedValue({ id: 'post-1', triggerReply: 'a'.repeat(200), triggerImageUrl: 'https://cdn/x.jpg' }),
    mockOnPostPublished: vi.fn().mockResolvedValue({ cleared: false, orphanedPostIds: [], healedPostIds: [], uncheckedPostIds: [] }),
    mockSendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    mockSendMetaImageAttachment: vi.fn().mockResolvedValue('img-mid'),
    mockAcquireMutex: vi.fn().mockResolvedValue('lock-token'),
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
        incr: mockRedisIncr,
        quit: vi.fn(),
    },
}));

vi.mock('../../src/services/posts', () => ({
    postsService: { getPost: mockGetPost, onPostPublished: mockOnPostPublished },
}));

vi.mock('../../src/services/metaMessaging', () => ({
    sendMetaImageAttachment: mockSendMetaImageAttachment,
}));

vi.mock('../../src/lib/redisMutex', () => ({
    acquireMutex: mockAcquireMutex,
    releaseMutex: vi.fn(),
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
vi.mock('../../src/services/pages', async () => ({
    pagesService: {
        getPageByFacebookId: mockGetPageByFacebookId,
        getPageByInstagramId: mockGetPageByInstagramId,
    },
    // The REAL predicate, never a stub (Rule 19.3). This suite's job includes the
    // webhook front door, and a stub here is exactly how PR #772 shipped a gate
    // that dropped every Instagram-direct event while the suite stayed green
    // (review C2): the fixture's `accessToken: ''` never met the real rule.
    isPageDisconnected: (await vi.importActual<typeof import('../../src/services/pages')>('../../src/services/pages')).isPageDisconnected,
    invalidateWorkspaceStatsCache: vi.fn(),
}));

vi.mock('../../src/lib/eventBus', () => ({
    publishSSEEvent: vi.fn(),
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: mockFindOrCreateFromWebhook,
        finalizeEnrichment: mockFinalizeEnrichment,
        setCreatedTime: vi.fn(),
        markAsResolved: vi.fn(),
        storeOutgoingMessage: mockStoreOutgoingMessage,
        getLastIncomingTextFromSender: mockGetLastIncomingTextFromSender,
        getSenderNameBySenderId: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        sendPrivateMessage: mockSendPrivateMessage,
        sendTypingIndicator: mockSendTypingIndicator,
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

// Mock platform adapters used by nonTextHandler for sender name lookup
vi.mock('../../src/services/reply/adapters/facebookAdapter', () => ({
    facebookMessageAdapter: {
        fetchSenderName: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../src/services/reply/adapters/instagramAdapter', () => ({
    instagramMessageAdapter: {
        fetchSenderName: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('Webhook Controller', () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        app = fastify();

        // Capture raw body for webhook signature verification
        app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req: FastifyRequest, body: Buffer, done: (err: Error | null, parsed?: unknown) => void) => {
            (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
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
            // The handler answers Meta before processing, so the assertion has to wait for
            // the async batch — vi.waitFor, never a fixed sleep, which passes or flakes
            // depending on how loaded the machine is.
            await vi.waitFor(() => expect(mockOnPostPublished).toHaveBeenCalledTimes(1));
            // A publish reconciles the scheduled-post arming marker — keyed by the INTERNAL
            // page id, not the Facebook page id — and is handed the page token + workspace
            // so the service can re-check Graph and tell the merchant.
            expect(mockOnPostPublished).toHaveBeenCalledWith(
                'internal-page-123',
                'post_123',
                expect.objectContaining({ accessToken: 'token-abc', workspaceId: 'ws-1', pageName: 'Test Page' }),
            );
        });

        it('enqueues the batch BEFORE reconciling the marker', async () => {
            // Reconciliation makes bounded Graph reads. It is diagnostic work, so it runs
            // after every comment in the batch is enqueued — a customer's reply must never
            // queue behind it, even though both happen after the 200.
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        changes: [
                            { field: 'feed', value: { item: 'post', verb: 'add', post_id: 'post_first' } },
                            {
                                field: 'feed',
                                value: {
                                    item: 'comment', verb: 'add', comment_id: 'comment_second',
                                    post_id: 'post_123', message: 'reply to me',
                                    from: { id: 'user_123', name: 'John Doe' },
                                },
                            },
                        ],
                    },
                ],
            };

            await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            await vi.waitFor(() => expect(mockOnPostPublished).toHaveBeenCalledTimes(1));
            expect(mockEnqueueComment.mock.invocationCallOrder[0])
                .toBeLessThan(mockOnPostPublished.mock.invocationCallOrder[0]);
        });

        it('survives a failing marker reconcile without dropping the webhook', async () => {
            // The marker is diagnostic; losing it must never cost the rest of the batch.
            mockOnPostPublished.mockRejectedValueOnce(new Error('db down'));
            const webhookPayload = {
                object: 'page',
                entry: [
                    {
                        id: 'page_123',
                        time: Date.now(),
                        changes: [
                            { field: 'feed', value: { item: 'post', verb: 'add', post_id: 'post_boom' } },
                            {
                                field: 'feed',
                                value: {
                                    item: 'comment', verb: 'add', comment_id: 'comment_after',
                                    post_id: 'post_123', message: 'still processed',
                                    from: { id: 'user_123', name: 'John Doe' },
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
            await vi.waitFor(() =>
                expect(mockEnqueueComment).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'comment_after' })),
            );
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

        it('«Read more» postback → delivers full text in-chat (image stays in card), no duplicate inbox row', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'psid_9' },
                        recipient: { id: 'page_123' },
                        postback: { title: 'اقرأ المزيد', payload: 'pr_more:facebook:post-1', mid: 'pb_1' },
                    }],
                }],
            };

            const response = await app.inject({
                method: 'POST', url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });
            expect(response.statusCode).toBe(200);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockAcquireMutex).toHaveBeenCalled();
            expect(mockGetPost).toHaveBeenCalledWith('post-1', 'ws-1');
            expect(mockSendPrivateMessage).toHaveBeenCalledWith('token-abc', 'psid_9', 'a'.repeat(200));
            // Text only — the image stays in the card (tap-to-full), never re-sent on «Read more».
            expect(mockSendMetaImageAttachment).not.toHaveBeenCalled();
            // No duplicate inbox row: the comment→DM card send already stored this reply. Storing
            // again on the tap would show the merchant the same reply twice (the bug we fixed).
            expect(mockStoreOutgoingMessage).not.toHaveBeenCalled();
            expect(mockRedisIncr).toHaveBeenCalled();
            // Not a text message → never enqueued as a reply job.
            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        });

        it('duplicate postback tap (mutex not acquired) → no-op', async () => {
            mockAcquireMutex.mockResolvedValueOnce(null); // lock already held
            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123', time: Date.now(),
                    messaging: [{ sender: { id: 'psid_9' }, recipient: { id: 'page_123' }, postback: { payload: 'pr_more:facebook:post-1', mid: 'pb_dup' } }],
                }],
            };
            await app.inject({ method: 'POST', url: '/webhook', headers: { 'x-hub-signature-256': generateSignature(webhookPayload) }, payload: webhookPayload });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(mockSendPrivateMessage).not.toHaveBeenCalled();
        });

        it('foreign postback payload (not ours) → ignored', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123', time: Date.now(),
                    messaging: [{ sender: { id: 'psid_9' }, recipient: { id: 'page_123' }, postback: { payload: 'GET_STARTED', mid: 'pb_x' } }],
                }],
            };
            await app.inject({ method: 'POST', url: '/webhook', headers: { 'x-hub-signature-256': generateSignature(webhookPayload) }, payload: webhookPayload });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(mockAcquireMutex).not.toHaveBeenCalled();
            expect(mockSendPrivateMessage).not.toHaveBeenCalled();
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
            workspaceId: 'ws-id',
            // Page-backed row: the real isPageDisconnected reads the discriminator,
            // so fixtures must carry it or they read as dead pageless cards.
            facebookPageId: 'fb_page_1',
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

            // Pending stub stored immediately (store-then-enrich): placeholder + 'pending'.
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'msg_voice_1', 'user_123', '[رسالة صوتية]', undefined, 'audio', 'facebook', 'pending',
            );
            // Transcription failed → finalized 'failed' (placeholder text stands).
            expect(mockFinalizeEnrichment).toHaveBeenCalledWith('msg-1', 'failed');

            // Nudge reply sent
            expect(mockSendPrivateMessage).toHaveBeenCalledWith(
                mockPage.accessToken, 'user_123', expect.stringContaining('الرسائل النصية'),
            );

            // Outgoing message stored
            expect(mockStoreOutgoingMessage).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'user_123', expect.stringContaining('الرسائل النصية'), 'template',
                // Trailing args end in platformMessageId — undefined here because this
                // is the Facebook nudge path; only WhatsApp returns a wamid.
                undefined, undefined, undefined, undefined, undefined, undefined,
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

            // Pending stub stored FIRST with the placeholder (store-then-enrich).
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'msg_voice_transcribed', 'user_123', '[رسالة صوتية]', undefined, 'audio', 'facebook', 'pending',
            );
            // Then finalized 'done' with the transcript.
            expect(mockFinalizeEnrichment).toHaveBeenCalledWith('msg-1', 'done', 'كم سعر الجاكيت الأسود؟');

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

            // Pending stub stored (placeholder), then finalized 'failed'.
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'msg_voice_fail', 'user_123', '[رسالة صوتية]', undefined, 'audio', 'facebook', 'pending',
            );
            expect(mockFinalizeEnrichment).toHaveBeenCalledWith('msg-1', 'failed');

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

            // English placeholder (terminal stub — no owner/url → not enrichable, status undefined)
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'msg_img_1', 'user_en', '[Image]', undefined, 'image', 'facebook', undefined,
            );

            // English nudge
            expect(mockSendPrivateMessage).toHaveBeenCalledWith(
                mockPage.accessToken, 'user_en', expect.stringContaining('text and voice messages'),
            );
        });

        it('should silently ignore Facebook Like button (👍) without sending a nudge', async () => {
            // Facebook sends the Like button as type="image" with sticker_id in the payload.
            // It should be stored as a sticker and NOT trigger a nudge reply.
            mockGetPageByFacebookId.mockResolvedValue(mockPage);
            mockRedisSet.mockResolvedValueOnce('OK');

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_like_sticker',
                            attachments: [{ type: 'image', payload: { sticker_id: 369239263222822, url: 'https://example.com/like.png' } }],
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

            // Stored as sticker (not image)
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'msg_like_sticker', 'user_123', '[Sticker]', undefined, 'sticker', 'facebook',
            );

            // No nudge sent
            expect(mockSendPrivateMessage).not.toHaveBeenCalled();
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
                            mid: 'msg_voice_1',
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

            // Placeholder stored (video → not enrichable → terminal stub, status undefined)
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'msg_voice_1', 'ig_user_789', '[فيديو]', undefined, 'video', 'instagram', undefined,
            );

            // Nudge sent via Instagram API
            expect(mockSendDirectMessage).toHaveBeenCalledWith(
                'ig_account_123', 'ig_user_789',
                expect.stringContaining('الرسائل النصية'),
                pageLinkedInstagramCredential(mockPage.accessToken),
            );
        });

        // An Instagram LOGIN page keeps `access_token` at the '' sentinel and holds
        // its real credential in `instagram_access_token`. The handler used to guard
        // on `page.accessToken`, which silently dropped every voice note, image and
        // sticker such a page received — the attachment never even reached the inbox.
        // Mutation-checked: restoring `if (!page?.accessToken) return;` fails here.
        it('handles Instagram non-text DMs on an Instagram-DIRECT page (empty page token)', async () => {
            mockGetPageByInstagramId.mockResolvedValue({
                ...mockPage,
                accessToken: '',
                facebookPageId: null,
                instagramAccessToken: 'ig-direct-token',
            });
            mockRedisSet.mockResolvedValueOnce('OK');

            const webhookPayload = {
                object: 'instagram',
                entry: [{
                    id: 'ig_account_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'ig_user_789' },
                        message: { mid: 'msg_voice_2', attachments: [{ type: 'video' }] },
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

            // The attachment reaches the merchant inbox…
            expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
                mockPage.id, mockPage.workspaceId, 'msg_voice_2', 'ig_user_789', '[فيديو]', undefined, 'video', 'instagram', undefined,
            );
            // …and the nudge goes out on the INSTAGRAM credential, not the empty one.
            expect(mockSendDirectMessage).toHaveBeenCalledWith(
                'ig_account_123', 'ig_user_789',
                expect.stringContaining('الرسائل النصية'),
                expect.objectContaining({ accessToken: 'ig-direct-token', direct: true }),
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

    describe('POST /webhook (Shared Post Handling)', () => {
        beforeEach(() => {
            mockGetPageByFacebookId.mockReset().mockResolvedValue({
                id: 'internal-page-id', facebookPageId: 'page_123', accessToken: 'test-token', name: 'Test Page',
                userId: 'user-1', workspaceId: 'ws-1',
            });
            mockGetPageByInstagramId.mockReset().mockResolvedValue({
                id: 'internal-ig-id', facebookPageId: 'page_123', accessToken: 'test-token', name: 'IG Page',
                userId: 'user-1', workspaceId: 'ws-1',
            });
            mockEnqueueMessage.mockReset().mockResolvedValue('mock-job-id');
            mockFindOrCreateFromWebhook.mockReset().mockResolvedValue({ message: { id: 'msg-1' }, isNew: true });
        });

        it('should pass sharedPostUrl and sharedPostId for Facebook text + shared post', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_with_post',
                            text: 'Is this available?',
                            attachments: [{
                                type: 'post' as const,
                                payload: { url: 'https://facebook.com/posts/99999', id: '99999' },
                            }],
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

            expect(mockEnqueueMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'facebook_message',
                    text: 'Is this available?',
                    sharedPostUrl: 'https://facebook.com/posts/99999',
                    sharedPostId: '99999',
                }),
            );
        });

        it('should pass sharedPostUrl and sharedPostId for Instagram text + shared post', async () => {
            const webhookPayload = {
                object: 'instagram',
                entry: [{
                    id: 'ig_account_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'ig_user_789' },
                        message: {
                            mid: 'ig_msg_with_post',
                            text: 'How much is this?',
                            attachments: [{
                                type: 'ig_post' as const,
                                payload: { url: 'https://instagram.com/p/ABC123/', id: '12345678' },
                            }],
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

            expect(mockEnqueueMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    jobType: 'instagram_message',
                    text: 'How much is this?',
                    sharedPostUrl: 'https://instagram.com/p/ABC123/',
                    sharedPostId: '12345678',
                }),
            );
        });

        it('should handle reel attachments same as posts', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: {
                            mid: 'msg_with_reel',
                            text: 'Love this!',
                            attachments: [{
                                type: 'ig_reel' as const,
                                payload: { url: 'https://instagram.com/reel/XYZ789/', id: '55555' },
                            }],
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

            expect(mockEnqueueMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    sharedPostUrl: 'https://instagram.com/reel/XYZ789/',
                    sharedPostId: '55555',
                }),
            );
        });

        it('should enqueue without sharedPostUrl when text has no attachment', async () => {
            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [{
                        sender: { id: 'user_123' },
                        message: { mid: 'msg_plain', text: 'Just a question' },
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

            const call = mockEnqueueMessage.mock.calls[0][0];
            expect(call.sharedPostUrl).toBeUndefined();
            expect(call.sharedPostId).toBeUndefined();
        });
    });

    // ── Concurrency guard ────────────────────────────────────────────────────────
    // Connecting a busy page floods the server with webhook requests. The guard
    // caps concurrent processWebhookAsync calls at MAX_CONCURRENT (10) so the
    // DB connection pool is not exhausted.

    describe('webhook concurrency guard', () => {
        const MAX_CONCURRENT = 10;

        // Resolve fns collected during each test — resolved in afterEach so
        // activeWebhookProcessors decrements back to 0 before the next test runs.
        let resolveFns: Array<(v: null) => void> = [];

        afterEach(async () => {
            for (const fn of resolveFns) fn(null);
            resolveFns = [];
            // Wait for all .finally() callbacks to fire
            await new Promise(r => setTimeout(r, 20));
        });

        it('should return 503 when concurrency limit is reached so Facebook retries', async () => {
            // Make page lookup hang so activeWebhookProcessors is never decremented during the test
            mockGetPageByFacebookId.mockImplementation(
                () => new Promise<null>(r => resolveFns.push(r)),
            );

            const makePayload = (pageId: string) => ({
                object: 'page',
                entry: [{ id: pageId, time: Date.now(), messaging: [] }],
            });

            // Fill up all slots
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                const payload = makePayload(`page_flood_${i}`);
                await app.inject({
                    method: 'POST',
                    url: '/webhook',
                    headers: { 'x-hub-signature-256': generateSignature(payload) },
                    payload,
                });
            }

            // This one exceeds the limit
            const overLimitPayload = makePayload('page_over_limit');
            const response = await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(overLimitPayload) },
                payload: overLimitPayload,
            });

            // 503 tells Facebook to retry with backoff — no permanent message loss
            expect(response.statusCode).toBe(503);
            expect(response.payload).toBe('OVERLOADED');
        });

        it('should not call getPageByFacebookId for dropped requests', async () => {
            mockGetPageByFacebookId.mockImplementation(
                () => new Promise<null>(r => resolveFns.push(r)),
            );

            const makePayload = (pageId: string) => ({
                object: 'page',
                entry: [{ id: pageId, time: Date.now(), messaging: [] }],
            });

            // Fill all slots
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                const payload = makePayload(`page_flood_${i}`);
                await app.inject({
                    method: 'POST',
                    url: '/webhook',
                    headers: { 'x-hub-signature-256': generateSignature(payload) },
                    payload,
                });
            }

            // Give the async processors a chance to call getPageByFacebookId
            await new Promise(resolve => setImmediate(resolve));
            const callsBeforeDrop = mockGetPageByFacebookId.mock.calls.length;

            // Send the over-limit request
            const overLimitPayload = makePayload('page_should_be_dropped');
            await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(overLimitPayload) },
                payload: overLimitPayload,
            });

            await new Promise(resolve => setImmediate(resolve));

            // No additional DB calls from the dropped request
            expect(mockGetPageByFacebookId.mock.calls.length).toBe(callsBeforeDrop);
        });
    });

    // ── Single page lookup per entry ─────────────────────────────────────────────
    // Prevents the double DB hit that occurred when processMessage re-fetched the
    // page that processWebhookAsync had already loaded.

    describe('page lookup efficiency', () => {
        it('should call getPageByFacebookId once per entry even with multiple messages', async () => {
            const mockPage = { id: 'internal-page-1', facebookPageId: 'page_123', accessToken: 'token', name: 'Test Page', userId: 'user-1', workspaceId: 'ws-1' };
            mockGetPageByFacebookId.mockResolvedValue(mockPage);

            const webhookPayload = {
                object: 'page',
                entry: [{
                    id: 'page_123',
                    time: Date.now(),
                    messaging: [
                        { sender: { id: 'user_1' }, message: { mid: 'msg_1', text: 'Hello' } },
                        { sender: { id: 'user_2' }, message: { mid: 'msg_2', text: 'Hi there' } },
                        { sender: { id: 'user_3' }, message: { mid: 'msg_3', text: 'Question?' } },
                    ],
                }],
            };

            await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(webhookPayload) },
                payload: webhookPayload,
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // One entry → one DB lookup, shared across all 3 messages
            expect(mockGetPageByFacebookId).toHaveBeenCalledTimes(1);
            expect(mockGetPageByFacebookId).toHaveBeenCalledWith('page_123');

            // All 3 messages still enqueued
            expect(mockEnqueueMessage).toHaveBeenCalledTimes(3);
        });
    });
});

