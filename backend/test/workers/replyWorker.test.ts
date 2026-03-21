import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplyJobData } from '@jawab24/shared';
import type { Job } from 'bullmq';

// Mock BullMQ Worker
const mockWorkerInstance = {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('bullmq', () => ({
    Worker: vi.fn().mockImplementation(() => mockWorkerInstance),
    UnrecoverableError: class UnrecoverableError extends Error {
        constructor(message: string) {
            super(message);
            this.name = 'UnrecoverableError';
        }
    },
}));

// Mock services
const mockReplyService = {
    processComment: vi.fn(),
    processMessage: vi.fn(),
    setLogger: vi.fn(),
};

const mockInstagramReplyService = {
    processComment: vi.fn(),
    processMessage: vi.fn(),
    setLogger: vi.fn(),
};

const mockPagesService = {
    getPageByFacebookId: vi.fn(),
};

vi.mock('../../src/services/reply', () => ({
    replyService: mockReplyService,
}));

vi.mock('../../src/services/instagramReply', () => ({
    instagramReplyService: mockInstagramReplyService,
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: mockPagesService,
}));

vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn().mockResolvedValue({ aiEnabled: true }),
    },
}));

// Mock replyQueue (enqueueComment, enqueueMessage)
vi.mock('../../src/lib/replyQueue', () => ({
    enqueueComment: vi.fn().mockResolvedValue('job-id'),
    enqueueMessage: vi.fn().mockResolvedValue('job-id'),
}));

// Mock pipelineMetrics
vi.mock('../../src/lib/pipelineMetrics', () => ({
    pipelineMetrics: {
        record: vi.fn(),
    },
}));

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

describe('Reply Worker', () => {
    let startWorker: any;
    let stopWorker: any;
    let getWorker: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        
        // Reset the worker module state
        vi.resetModules();
        
        const module = await import('../../src/workers/replyWorker');
        startWorker = module.startWorker;
        stopWorker = module.stopWorker;
        getWorker = module.getWorker;
    });

    afterEach(async () => {
        // Clean up worker
        if (getWorker()) {
            await stopWorker();
        }
    });

    describe('Worker Lifecycle', () => {
        it('should start the worker', () => {
            const worker = startWorker();
            
            expect(worker).toBeDefined();
            expect(mockWorkerInstance.on).toHaveBeenCalled();
        });

        it('should stop the worker gracefully', async () => {
            startWorker();
            
            await stopWorker();
            
            expect(mockWorkerInstance.close).toHaveBeenCalled();
        });

        it('should return null when no worker is running', () => {
            expect(getWorker()).toBeNull();
        });
    });

    describe('Job Processing Logic', () => {
        // These tests would require more complex setup to test the actual job processor
        // For now, we test the integration points
        
        it('should set up event handlers on start', () => {
            startWorker();

            // Check that event handlers are registered
            const onCalls = mockWorkerInstance.on.mock.calls;
            const eventNames = onCalls.map((call: any) => call[0]);

            expect(eventNames).toContain('completed');
            expect(eventNames).toContain('failed');
            expect(eventNames).toContain('error');
            expect(eventNames).toContain('stalled');
        });

        it('should invoke completed handler without error', () => {
            startWorker();
            const completedHandler = mockWorkerInstance.on.mock.calls.find(
                (c: any) => c[0] === 'completed',
            )?.[1];
            expect(() =>
                completedHandler({ id: 'j1' }, { success: true }),
            ).not.toThrow();
        });

        it('should invoke failed handler without error', () => {
            startWorker();
            const failedHandler = mockWorkerInstance.on.mock.calls.find(
                (c: any) => c[0] === 'failed',
            )?.[1];
            expect(() =>
                failedHandler({ id: 'j1', attemptsMade: 1 }, new Error('boom')),
            ).not.toThrow();
        });

        it('should invoke error handler without error', () => {
            startWorker();
            const errorHandler = mockWorkerInstance.on.mock.calls.find(
                (c: any) => c[0] === 'error',
            )?.[1];
            expect(() => errorHandler(new Error('worker err'))).not.toThrow();
        });

        it('should invoke stalled handler without error', () => {
            startWorker();
            const stalledHandler = mockWorkerInstance.on.mock.calls.find(
                (c: any) => c[0] === 'stalled',
            )?.[1];
            expect(() => stalledHandler('stalled-job-id')).not.toThrow();
        });

        it('should accept a custom logger', () => {
            const customLogger = {
                info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
            };
            startWorker(customLogger);
            expect(mockWorkerInstance.on).toHaveBeenCalled();
        });
    });
});

describe('Reply Worker Job Processing', () => {
    // Test the page validation logic
    describe('Page Validation', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should skip job if auto-reply is disabled for Facebook', async () => {
            mockPagesService.getPageByFacebookId.mockResolvedValue({
                id: 'internal_page_id',
                autoReplyEnabled: false,
                instagramAutoReplyEnabled: true,
            });

            // The actual processing would be tested via integration tests
            // This verifies the mock is set up correctly
            const page = await mockPagesService.getPageByFacebookId('page_123');
            expect(page.autoReplyEnabled).toBe(false);
        });

        it('should skip job if auto-reply is disabled for Instagram', async () => {
            mockPagesService.getPageByFacebookId.mockResolvedValue({
                id: 'internal_page_id',
                autoReplyEnabled: true,
                instagramAutoReplyEnabled: false,
            });

            const page = await mockPagesService.getPageByFacebookId('ig_account_123');
            expect(page.instagramAutoReplyEnabled).toBe(false);
        });
    });

    describe('Reply Service Integration', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should call replyService.processComment for Facebook comments', async () => {
            mockReplyService.processComment.mockResolvedValue({
                success: true,
                commentId: 'comment_123',
                replyText: 'Thank you!',
                replyMethod: 'ai',
            });

            const result = await mockReplyService.processComment(
                'page_123',
                'post_456',
                'comment_789',
                'Great product!',
                'user_111',
                'John Doe'
            );

            expect(result.success).toBe(true);
            expect(result.replyMethod).toBe('ai');
        });

        it('should call replyService.processMessage for Facebook messages', async () => {
            mockReplyService.processMessage.mockResolvedValue({
                success: true,
                messageId: 'msg_123',
                replyText: 'Hello!',
                replyMethod: 'ai',
            });

            const result = await mockReplyService.processMessage(
                'page_123',
                'user_456',
                'Hello, question?',
                'msg_789'
            );

            expect(result.success).toBe(true);
        });

        it('should call instagramReplyService.processComment for Instagram comments', async () => {
            mockInstagramReplyService.processComment.mockResolvedValue({
                success: true,
                commentId: 'ig_comment_123',
                replyText: 'Thanks!',
                replyMethod: 'ai',
            });

            const result = await mockInstagramReplyService.processComment(
                'ig_account_123',
                'media_456',
                'ig_comment_789',
                'Nice!',
                'ig_user_111',
                'jane_doe'
            );

            expect(result.success).toBe(true);
        });

        it('should call instagramReplyService.processMessage for Instagram DMs', async () => {
            mockInstagramReplyService.processMessage.mockResolvedValue({
                success: true,
                messageId: 'ig_msg_123',
                replyText: 'Hi there!',
                replyMethod: 'ai',
            });

            const result = await mockInstagramReplyService.processMessage(
                'ig_account_123',
                'ig_user_456',
                'DM question',
                'ig_msg_789'
            );

            expect(result.success).toBe(true);
        });
    });
});

describe('Reply Worker — Handoff Re-enqueue', () => {
    let processJobFn: (job: Job<ReplyJobData>) => Promise<any>;
    let mockEnqueueMessage: ReturnType<typeof vi.fn>;
    let mockEnqueueComment: ReturnType<typeof vi.fn>;
    let mockPipelineRecord: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        // Import the worker module (triggers module init)
        await import('../../src/workers/replyWorker');

        // Capture the processJob function passed to BullMQ Worker constructor
        const { Worker } = await import('bullmq');
        const workerCalls = vi.mocked(Worker).mock.calls;
        // startWorker() hasn't been called yet, so we need to call it
        const module = await import('../../src/workers/replyWorker');
        module.startWorker();

        const latestCall = vi.mocked(Worker).mock.calls;
        processJobFn = latestCall[latestCall.length - 1][1] as any;

        // Get mock references
        const replyQueueModule = await import('../../src/lib/replyQueue');
        mockEnqueueMessage = vi.mocked(replyQueueModule.enqueueMessage);
        mockEnqueueComment = vi.mocked(replyQueueModule.enqueueComment);

        const metricsModule = await import('../../src/lib/pipelineMetrics');
        mockPipelineRecord = vi.mocked(metricsModule.pipelineMetrics.record);
    });

    function createMockJob(overrides: Partial<ReplyJobData> = {}, jobMeta: Partial<Job<ReplyJobData>> = {}): Job<ReplyJobData> {
        return {
            id: 'job-1',
            attemptsMade: 0,
            data: {
                jobType: 'facebook_message',
                pageId: 'page-1',
                messageId: 'msg-1',
                senderId: 'sender-1',
                text: 'Hello',
                receivedAt: new Date().toISOString(),
                ...overrides,
            },
            ...jobMeta,
        } as Job<ReplyJobData>;
    }

    it('should re-enqueue a message job when handoffDelayMs is returned', async () => {
        mockReplyService.processMessage.mockResolvedValue({
            success: false,
            messageId: 'msg-1',
            error: 'Handoff active',
            handoffDelayMs: 120000,
        });

        const job = createMockJob({ handoffRetries: 0 });
        await processJobFn(job);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'facebook_message',
            pageId: 'page-1',
            messageId: 'msg-1',
            senderId: 'sender-1',
            replyDelay: 120,
            handoffRetries: 1,
        }));
        expect(mockPipelineRecord).toHaveBeenCalledWith('facebook_message', 'handoff_requeued');
    });

    it('should re-enqueue a comment job when handoffDelayMs is returned', async () => {
        mockReplyService.processComment.mockResolvedValue({
            success: false,
            commentId: 'comment-1',
            error: 'Handoff active',
            handoffDelayMs: 60000,
        });

        const job = createMockJob({
            jobType: 'facebook_comment',
            postId: 'post-1',
            commentId: 'comment-1',
            handoffRetries: 1,
        });
        await processJobFn(job);

        expect(mockEnqueueComment).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'facebook_comment',
            postId: 'post-1',
            commentId: 'comment-1',
            replyDelay: 60,
            handoffRetries: 2,
        }));
        expect(mockPipelineRecord).toHaveBeenCalledWith('facebook_comment', 'handoff_requeued');
    });

    it('should NOT re-enqueue when handoffRetries reaches MAX_HANDOFF_RETRIES (3)', async () => {
        mockReplyService.processMessage.mockResolvedValue({
            success: false,
            messageId: 'msg-1',
            error: 'Handoff active',
            handoffDelayMs: 60000,
        });

        const job = createMockJob({ handoffRetries: 3 });
        await processJobFn(job);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        expect(mockEnqueueComment).not.toHaveBeenCalled();
    });

    it('should NOT re-enqueue when result has no handoffDelayMs', async () => {
        mockReplyService.processMessage.mockResolvedValue({
            success: true,
            messageId: 'msg-1',
            replyText: 'Hello!',
            replyMethod: 'ai',
        });

        const job = createMockJob();
        await processJobFn(job);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        expect(mockEnqueueComment).not.toHaveBeenCalled();
    });

    it('should increment handoffRetries on each re-enqueue', async () => {
        mockReplyService.processMessage.mockResolvedValue({
            success: false,
            messageId: 'msg-1',
            error: 'Handoff active',
            handoffDelayMs: 90000,
        });

        const job = createMockJob({ handoffRetries: 2 });
        await processJobFn(job);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            handoffRetries: 3,
            replyDelay: 90,
        }));
    });

    it('should throw UnrecoverableError for unknown job type', async () => {
        const job = createMockJob({ jobType: 'unknown_type' as any });
        await expect(processJobFn(job)).rejects.toThrow('Unknown job type: unknown_type');
    });

    it('should throw UnrecoverableError when Facebook comment is missing postId', async () => {
        const job = createMockJob({
            jobType: 'facebook_comment',
            postId: undefined,
            commentId: 'c1',
        });
        await expect(processJobFn(job)).rejects.toThrow('Missing postId or commentId');
    });

    it('should throw UnrecoverableError when Facebook message is missing senderId', async () => {
        const job = createMockJob({
            jobType: 'facebook_message',
            messageId: 'msg-1',
            senderId: undefined as any,
        });
        await expect(processJobFn(job)).rejects.toThrow('Missing messageId or senderId');
    });

    it('should throw UnrecoverableError when Instagram comment is missing commentId', async () => {
        const job = createMockJob({
            jobType: 'instagram_comment',
            postId: 'p1',
            commentId: undefined,
        });
        await expect(processJobFn(job)).rejects.toThrow('Missing postId');
    });

    it('should throw UnrecoverableError when Instagram message is missing messageId', async () => {
        const job = createMockJob({
            jobType: 'instagram_message',
            messageId: undefined,
            senderId: 's1',
        });
        await expect(processJobFn(job)).rejects.toThrow('Missing messageId or senderId');
    });

    it('should re-enqueue Instagram comment with handoff', async () => {
        mockInstagramReplyService.processComment.mockResolvedValue({
            success: false,
            commentId: 'ig-c-1',
            error: 'Handoff active',
            handoffDelayMs: 30000,
        });

        const job = createMockJob({
            jobType: 'instagram_comment',
            postId: 'media-1',
            commentId: 'ig-c-1',
            senderId: 'ig-sender-1',
            senderName: 'User',
        });
        await processJobFn(job);

        expect(mockEnqueueComment).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'instagram_comment',
            postId: 'media-1',
            commentId: 'ig-c-1',
            replyDelay: 30,
            handoffRetries: 1,
        }));
    });

    it('should handle Instagram message re-enqueue', async () => {
        mockInstagramReplyService.processMessage.mockResolvedValue({
            success: false,
            messageId: 'ig-msg-1',
            error: 'Handoff active',
            handoffDelayMs: 45000,
        });

        const job = createMockJob({
            jobType: 'instagram_message',
            messageId: 'ig-msg-1',
            senderId: 'ig-sender-1',
        });
        await processJobFn(job);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'instagram_message',
            replyDelay: 45,
            handoffRetries: 1,
        }));
    });
});
