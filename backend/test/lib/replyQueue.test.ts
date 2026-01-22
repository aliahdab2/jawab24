import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BullMQ before importing the queue module
vi.mock('bullmq', () => {
    const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
        close: vi.fn(),
        getWaitingCount: vi.fn().mockResolvedValue(5),
        getActiveCount: vi.fn().mockResolvedValue(2),
        getCompletedCount: vi.fn().mockResolvedValue(100),
        getFailedCount: vi.fn().mockResolvedValue(3),
        getDelayedCount: vi.fn().mockResolvedValue(1),
    };
    return {
        Queue: vi.fn().mockImplementation(() => mockQueue),
    };
});

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        redis: {
            host: 'localhost',
            port: 6379,
            password: undefined,
        },
    },
}));

describe('Reply Queue', () => {
    let replyQueue: any;
    let enqueueComment: any;
    let enqueueMessage: any;
    let getQueueStats: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Dynamic import to get fresh mocks
        const module = await import('../../src/lib/replyQueue');
        replyQueue = module.replyQueue;
        enqueueComment = module.enqueueComment;
        enqueueMessage = module.enqueueMessage;
        getQueueStats = module.getQueueStats;
    });

    describe('Queue Initialization', () => {
        it('should have a defined queue instance', () => {
            expect(replyQueue).toBeDefined();
        });
    });

    describe('enqueueComment', () => {
        it('should enqueue a Facebook comment job', async () => {
            const jobId = await enqueueComment({
                jobType: 'facebook_comment',
                pageId: 'page_123',
                postId: 'post_456',
                commentId: 'comment_789',
                text: 'Great product!',
                senderId: 'user_111',
                senderName: 'John Doe',
                requestId: 'req_123',
            });

            expect(jobId).toBe('mock-job-id');
            expect(replyQueue.add).toHaveBeenCalledWith(
                'process-comment',
                expect.objectContaining({
                    jobType: 'facebook_comment',
                    pageId: 'page_123',
                    postId: 'post_456',
                    commentId: 'comment_789',
                    text: 'Great product!',
                    senderId: 'user_111',
                    senderName: 'John Doe',
                    requestId: 'req_123',
                    receivedAt: expect.any(String),
                }),
                {}
            );
        });

        it('should enqueue an Instagram comment job', async () => {
            const jobId = await enqueueComment({
                jobType: 'instagram_comment',
                pageId: 'ig_account_123',
                postId: 'media_456',
                commentId: 'ig_comment_789',
                text: 'Nice post!',
                senderId: 'ig_user_111',
                senderName: 'jane_doe',
            });

            expect(jobId).toBe('mock-job-id');
            expect(replyQueue.add).toHaveBeenCalledWith(
                'process-comment',
                expect.objectContaining({
                    jobType: 'instagram_comment',
                    pageId: 'ig_account_123',
                    postId: 'media_456',
                    commentId: 'ig_comment_789',
                }),
                {}
            );
        });

        it('should apply delay when replyDelay is set', async () => {
            await enqueueComment({
                jobType: 'facebook_comment',
                pageId: 'page_123',
                postId: 'post_456',
                commentId: 'comment_789',
                text: 'Test comment',
                replyDelay: 5, // 5 seconds
            });

            expect(replyQueue.add).toHaveBeenCalledWith(
                'process-comment',
                expect.any(Object),
                { delay: 5000 } // 5 seconds in milliseconds
            );
        });
    });

    describe('enqueueMessage', () => {
        it('should enqueue a Facebook message job', async () => {
            const jobId = await enqueueMessage({
                jobType: 'facebook_message',
                pageId: 'page_123',
                messageId: 'msg_456',
                senderId: 'user_789',
                text: 'Hello, I have a question',
                senderName: 'Jane Doe',
                requestId: 'req_456',
            });

            expect(jobId).toBe('mock-job-id');
            expect(replyQueue.add).toHaveBeenCalledWith(
                'process-message',
                expect.objectContaining({
                    jobType: 'facebook_message',
                    pageId: 'page_123',
                    messageId: 'msg_456',
                    senderId: 'user_789',
                    text: 'Hello, I have a question',
                    senderName: 'Jane Doe',
                    requestId: 'req_456',
                    receivedAt: expect.any(String),
                }),
                {}
            );
        });

        it('should enqueue an Instagram message job', async () => {
            const jobId = await enqueueMessage({
                jobType: 'instagram_message',
                pageId: 'ig_account_123',
                messageId: 'ig_msg_456',
                senderId: 'ig_user_789',
                text: 'DM question',
            });

            expect(jobId).toBe('mock-job-id');
            expect(replyQueue.add).toHaveBeenCalledWith(
                'process-message',
                expect.objectContaining({
                    jobType: 'instagram_message',
                    pageId: 'ig_account_123',
                    messageId: 'ig_msg_456',
                    senderId: 'ig_user_789',
                }),
                {}
            );
        });

        it('should apply delay when replyDelay is set', async () => {
            await enqueueMessage({
                jobType: 'facebook_message',
                pageId: 'page_123',
                messageId: 'msg_456',
                senderId: 'user_789',
                text: 'Test message',
                replyDelay: 10, // 10 seconds
            });

            expect(replyQueue.add).toHaveBeenCalledWith(
                'process-message',
                expect.any(Object),
                { delay: 10000 } // 10 seconds in milliseconds
            );
        });
    });

    describe('getQueueStats', () => {
        it('should return queue statistics', async () => {
            const stats = await getQueueStats();

            expect(stats).toEqual({
                waiting: 5,
                active: 2,
                completed: 100,
                failed: 3,
                delayed: 1,
                total: 8, // waiting + active + delayed
            });
        });
    });
});
