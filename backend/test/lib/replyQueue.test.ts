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
        getDelayed: vi.fn().mockResolvedValue([]),
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
    let promoteDelayedJobs: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Dynamic import to get fresh mocks
        const module = await import('../../src/lib/replyQueue');
        replyQueue = module.replyQueue;
        enqueueComment = module.enqueueComment;
        enqueueMessage = module.enqueueMessage;
        getQueueStats = module.getQueueStats;
        promoteDelayedJobs = module.promoteDelayedJobs;
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

    describe('promoteDelayedJobs', () => {
        // Helper: build a fake delayed job
        function makeJob(pageId: string, senderId: string, handoffRetries: number, promote = vi.fn().mockResolvedValue(undefined)) {
            return { data: { pageId, senderId, handoffRetries }, promote };
        }

        it('should promote delayed handoff jobs matching page + sender', async () => {
            const promote = vi.fn().mockResolvedValue(undefined);
            replyQueue.getDelayed
                .mockResolvedValueOnce([makeJob('page-1', 'sender-1', 1, promote), makeJob('page-1', 'sender-1', 2, promote)])
                .mockResolvedValue([]); // terminal empty batch

            const count = await promoteDelayedJobs('page-1', 'sender-1');

            expect(count).toBe(2);
            expect(promote).toHaveBeenCalledTimes(2);
        });

        it('should NOT promote jobs for a different sender', async () => {
            const promote = vi.fn();
            replyQueue.getDelayed
                .mockResolvedValueOnce([makeJob('page-1', 'sender-other', 1, promote)])
                .mockResolvedValue([]);

            const count = await promoteDelayedJobs('page-1', 'sender-1');

            expect(count).toBe(0);
            expect(promote).not.toHaveBeenCalled();
        });

        it('should NOT promote non-handoff delayed jobs (handoffRetries=0 or missing)', async () => {
            const promote = vi.fn();
            replyQueue.getDelayed
                .mockResolvedValueOnce([
                    makeJob('page-1', 'sender-1', 0, promote),
                    { data: { pageId: 'page-1', senderId: 'sender-1' }, promote }, // no handoffRetries field
                ])
                .mockResolvedValue([]);

            const count = await promoteDelayedJobs('page-1', 'sender-1');

            expect(count).toBe(0);
            expect(promote).not.toHaveBeenCalled();
        });

        it('should return 0 when no delayed jobs exist', async () => {
            replyQueue.getDelayed.mockResolvedValue([]);

            const count = await promoteDelayedJobs('page-1', 'sender-1');

            expect(count).toBe(0);
        });

        it('should skip jobs where promote() throws and continue with remaining', async () => {
            const failingPromote = vi.fn().mockRejectedValue(new Error('Job already processed'));
            const successPromote = vi.fn().mockResolvedValue(undefined);
            replyQueue.getDelayed
                .mockResolvedValueOnce([makeJob('page-1', 'sender-1', 1, failingPromote), makeJob('page-1', 'sender-1', 2, successPromote)])
                .mockResolvedValue([]);

            const count = await promoteDelayedJobs('page-1', 'sender-1');

            expect(count).toBe(1);
            expect(failingPromote).toHaveBeenCalledTimes(1);
            expect(successPromote).toHaveBeenCalledTimes(1);
        });

        // ── pagination regression tests (fix: getDelayed now uses start/end) ────────

        it('should call getDelayed with (0, 99) for the first batch', async () => {
            replyQueue.getDelayed.mockResolvedValue([]);

            await promoteDelayedJobs('page-1', 'sender-1');

            expect(replyQueue.getDelayed).toHaveBeenCalledWith(0, 99);
        });

        it('should paginate across multiple batches until an empty batch is returned', async () => {
            const promote = vi.fn().mockResolvedValue(undefined);
            // Simulate 150 matching jobs: first batch 100, second batch 50, then empty
            replyQueue.getDelayed.mockImplementation(async (start: number) => {
                const all = Array.from({ length: 150 }, () =>
                    makeJob('page-1', 'sender-1', 1, promote)
                );
                const batch = all.slice(start, start + 100);
                return batch;
            });

            const count = await promoteDelayedJobs('page-1', 'sender-1');

            expect(count).toBe(150);
            // getDelayed called with (0,99), (100,199), (200,299 → empty)
            expect(replyQueue.getDelayed).toHaveBeenCalledTimes(3);
            expect(replyQueue.getDelayed).toHaveBeenNthCalledWith(1, 0, 99);
            expect(replyQueue.getDelayed).toHaveBeenNthCalledWith(2, 100, 199);
            expect(replyQueue.getDelayed).toHaveBeenNthCalledWith(3, 200, 299);
        });

        it('should not cause OOM by never loading the full queue at once', async () => {
            // getDelayed must always be called with explicit start/end bounds (never 0 args)
            replyQueue.getDelayed.mockResolvedValue([]);

            await promoteDelayedJobs('page-1', 'sender-1');

            for (const call of replyQueue.getDelayed.mock.calls) {
                expect(call.length).toBe(2); // always called with (start, end)
                expect(typeof call[0]).toBe('number');
                expect(typeof call[1]).toBe('number');
            }
        });
    });
});
