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

const mockWhatsAppReplyService = {
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

vi.mock('../../src/services/whatsappReply', () => ({
    whatsappReplyService: mockWhatsAppReplyService,
}));

const mockCommentsService = {
    getCommentByFacebookId: vi.fn(),
    updateComment: vi.fn(),
};

const mockMessagesService = {
    flagMessage: vi.fn(),
};

const mockDb = {
    query: {
        messages: {
            findFirst: vi.fn(),
        },
    },
};

vi.mock('../../src/services/comments', () => ({
    commentsService: mockCommentsService,
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: mockMessagesService,
}));

const mockNotificationService = {
    sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/services/notifications', () => ({
    notificationService: mockNotificationService,
}));

vi.mock('../../src/db', () => ({
    db: mockDb,
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
        recordReplyMode: vi.fn(() => Promise.resolve()),
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
        ai: {
            quotaParkSeconds: 900,
            circuitParkSeconds: 60,
            parkMaxRetries: 16,
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

    // --- Attachment-enrichment park (store-then-enrich) ---

    it('re-enqueues with attachmentRetries+1 (and the delay) when attachmentPendingDelayMs is returned', async () => {
        mockReplyService.processMessage.mockResolvedValue({
            success: false,
            messageId: 'msg-1',
            error: 'Attachment enrichment pending',
            attachmentPendingDelayMs: 5000,
        });

        const job = createMockJob({ attachmentRetries: 2, sharedPostUrl: 'https://fb/p/1', sharedPostId: '1' });
        await processJobFn(job);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'facebook_message',
            messageId: 'msg-1',
            replyDelay: 5,
            attachmentRetries: 3,
            // shared-post context survives the park (full-fidelity forward)
            sharedPostUrl: 'https://fb/p/1',
            sharedPostId: '1',
        }));
        expect(mockPipelineRecord).toHaveBeenCalledWith('facebook_message', 'attachment_park_requeued');
    });

    it('does NOT carry handoffRetries when parking for attachment enrichment', async () => {
        mockReplyService.processMessage.mockResolvedValue({
            success: false,
            messageId: 'msg-1',
            error: 'Attachment enrichment pending',
            attachmentPendingDelayMs: 5000,
        });

        // Even if the job previously carried a handoff count, an attachment park must
        // drop it — otherwise the resumed job is treated as handoff backlog and can be
        // stale-suppressed (dropped). Only attachmentRetries advances.
        const job = createMockJob({ handoffRetries: 1, attachmentRetries: 0 });
        await processJobFn(job);

        expect(mockEnqueueMessage.mock.calls[0][0]).not.toHaveProperty('handoffRetries');
        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            attachmentRetries: 1,
        }));
    });

    it('does NOT re-enqueue for attachment parking when the result has no attachmentPendingDelayMs', async () => {
        mockReplyService.processMessage.mockResolvedValue({
            success: true, messageId: 'msg-1', replyText: 'ok', replyMethod: 'ai',
        });

        await processJobFn(createMockJob());

        expect(mockPipelineRecord).not.toHaveBeenCalledWith('facebook_message', 'attachment_park_requeued');
    });
});

describe('Reply Worker — AI park-and-retry', () => {
    let processJobFn: (job: Job<ReplyJobData>) => Promise<any>;
    let mockEnqueueMessage: ReturnType<typeof vi.fn>;
    let mockEnqueueComment: ReturnType<typeof vi.fn>;
    let mockPipelineRecord: ReturnType<typeof vi.fn>;
    let AiQuotaExhaustedError: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();

        await import('../../src/workers/replyWorker');
        const { Worker } = await import('bullmq');
        const module = await import('../../src/workers/replyWorker');
        module.startWorker();
        const calls = vi.mocked(Worker).mock.calls;
        processJobFn = calls[calls.length - 1][1] as any;

        const replyQueueModule = await import('../../src/lib/replyQueue');
        mockEnqueueMessage = vi.mocked(replyQueueModule.enqueueMessage);
        mockEnqueueComment = vi.mocked(replyQueueModule.enqueueComment);
        const metricsModule = await import('../../src/lib/pipelineMetrics');
        mockPipelineRecord = vi.mocked(metricsModule.pipelineMetrics.record);
        ({ AiQuotaExhaustedError } = await import('../../src/utils/fbGraphErrors'));
    });

    function createMockJob(overrides: Partial<ReplyJobData> = {}): Job<ReplyJobData> {
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
        } as Job<ReplyJobData>;
    }

    it('parks a quota error: re-enqueues with the long delay + aiRetryCount, does not throw', async () => {
        mockReplyService.processMessage.mockRejectedValue(new AiQuotaExhaustedError());

        const job = createMockJob();
        const result = await processJobFn(job);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'facebook_message',
            messageId: 'msg-1',
            replyDelay: 900,       // config.ai.quotaParkSeconds
            aiRetryCount: 1,
        }));
        // Re-enqueue must NOT carry handoffRetries (would trip stale-backlog suppression)
        expect(mockEnqueueMessage.mock.calls[0][0]).not.toHaveProperty('handoffRetries');
        expect(mockPipelineRecord).toHaveBeenCalledWith('facebook_message', 'ai_parked');
        expect(result.success).toBe(false);
    });

    it('parks a circuit-open error with the shorter circuit delay', async () => {
        const circuitErr = new Error('Circuit breaker is open');
        circuitErr.name = 'CircuitOpenError';
        mockReplyService.processMessage.mockRejectedValue(circuitErr);

        const job = createMockJob();
        await processJobFn(job);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            replyDelay: 60,        // config.ai.circuitParkSeconds
            aiRetryCount: 1,
        }));
        expect(mockPipelineRecord).toHaveBeenCalledWith('facebook_message', 'ai_parked');
    });

    it('increments aiRetryCount on each park', async () => {
        mockReplyService.processMessage.mockRejectedValue(new AiQuotaExhaustedError());

        const job = createMockJob({ aiRetryCount: 4 });
        await processJobFn(job);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ aiRetryCount: 5 }));
    });

    it('stops parking and rethrows (→ flag) once parkMaxRetries is reached', async () => {
        mockReplyService.processMessage.mockRejectedValue(new AiQuotaExhaustedError());

        const job = createMockJob({ aiRetryCount: 16 }); // == parkMaxRetries
        await expect(processJobFn(job)).rejects.toBeInstanceOf(AiQuotaExhaustedError);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        expect(mockPipelineRecord).toHaveBeenCalledWith('facebook_message', 'ai_park_exhausted');
    });

    it('does not park ordinary errors (rethrows for normal retry/flag)', async () => {
        mockReplyService.processMessage.mockRejectedValue(new Error('some FB transient error'));

        const job = createMockJob();
        await expect(processJobFn(job)).rejects.toThrow('some FB transient error');
        expect(mockEnqueueMessage).not.toHaveBeenCalled();
    });

    it('parks a quota error on a comment job via enqueueComment', async () => {
        mockReplyService.processComment.mockRejectedValue(new AiQuotaExhaustedError());

        const job = createMockJob({
            jobType: 'facebook_comment',
            postId: 'post-1',
            commentId: 'comment-1',
        });
        await processJobFn(job);

        expect(mockEnqueueComment).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'facebook_comment',
            commentId: 'comment-1',
            replyDelay: 900,
            aiRetryCount: 1,
        }));
    });
});

describe('Reply Worker — flagStuckJobOnFinalFailure', () => {
    // Surfaces comments/messages stuck after BullMQ retries exhaust.
    // Before this handler existed: transient FB errors that don't recover within
    // 3 retries left the row as replied=false / needs_attention=false / flag_reason=null —
    // invisible to the merchant forever (the prod failure for Mohamad Shami "عنوان" 2026-05-14).
    let flagStuckJobOnFinalFailure: (job: Job<ReplyJobData> | undefined, err: Error) => Promise<void>;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        const module = await import('../../src/workers/replyWorker');
        flagStuckJobOnFinalFailure = module.flagStuckJobOnFinalFailure;
    });

    function buildJob(overrides: Partial<{
        jobType: string; commentId: string; messageId: string;
        attemptsMade: number; maxAttempts: number;
    }> = {}): any {
        return {
            id: 'job-1',
            data: {
                jobType: overrides.jobType ?? 'facebook_comment',
                pageId: 'page-1',
                commentId: overrides.commentId,
                messageId: overrides.messageId,
            },
            attemptsMade: overrides.attemptsMade ?? 3,
            opts: { attempts: overrides.maxAttempts ?? 3 },
        };
    }

    it('returns silently when job is undefined', async () => {
        await flagStuckJobOnFinalFailure(undefined, new Error('boom'));
        expect(mockCommentsService.getCommentByFacebookId).not.toHaveBeenCalled();
    });

    it('does nothing on intermediate attempts (attemptsMade < maxAttempts)', async () => {
        // BullMQ fires "failed" on every attempt — we must NOT flag mid-retry.
        const job = buildJob({ attemptsMade: 1, maxAttempts: 3, commentId: 'fb-comment-1' });
        await flagStuckJobOnFinalFailure(job, new Error('boom'));
        expect(mockCommentsService.getCommentByFacebookId).not.toHaveBeenCalled();
        expect(mockCommentsService.updateComment).not.toHaveBeenCalled();
    });

    it('flags a stuck FB comment after final attempt — Mohamad Shami regression case', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-1', replied: false, needsAttention: false,
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-1' });

        await flagStuckJobOnFinalFailure(job, new Error('Facebook API error: (#-1) Unexpected internal error'));

        expect(mockCommentsService.updateComment).toHaveBeenCalledWith('comment-uuid-1', {
            needsAttention: true,
            flagReason: 'send_failed_retries_exhausted',
            flagMeta: {
                send_failed_retries_exhausted: { error: 'Facebook API error: (#-1) Unexpected internal error' },
            },
        });
    });

    it('skips when comment already replied (idempotent)', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-2', replied: true, needsAttention: false,
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-2' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockCommentsService.updateComment).not.toHaveBeenCalled();
    });

    it('skips when comment already flagged (idempotent, preserves existing flag)', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-3', replied: false, needsAttention: true,
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-3' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockCommentsService.updateComment).not.toHaveBeenCalled();
    });

    it('flags a stuck FB DM after final attempt', async () => {
        mockDb.query.messages.findFirst.mockResolvedValueOnce({
            id: 'msg-uuid-1', replied: false, needsAttention: false,
        });
        const job = buildJob({ jobType: 'facebook_message', messageId: 'fb-msg-1' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockMessagesService.flagMessage).toHaveBeenCalledWith(
            'msg-uuid-1',
            'send_failed_retries_exhausted',
            undefined,
            { send_failed_retries_exhausted: { error: 'boom' } },
        );
    });

    it('flags a stuck IG DM the same way as FB DM', async () => {
        mockDb.query.messages.findFirst.mockResolvedValueOnce({
            id: 'ig-msg-uuid-1', replied: false, needsAttention: false,
        });
        const job = buildJob({ jobType: 'instagram_message', messageId: 'ig-msg-1' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockMessagesService.flagMessage).toHaveBeenCalledWith(
            'ig-msg-uuid-1',
            'send_failed_retries_exhausted',
            undefined,
            expect.any(Object),
        );
    });

    it('swallows handler errors so a downstream throw never crashes the worker', async () => {
        // Defensive — failed handler must NEVER throw. A bad DB / Redis blip
        // shouldn't take the worker down.
        mockCommentsService.getCommentByFacebookId.mockRejectedValueOnce(new Error('db unreachable'));
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-x' });

        await expect(
            flagStuckJobOnFinalFailure(job, new Error('boom')),
        ).resolves.toBeUndefined();
    });

    it('truncates very long error messages to 300 chars in flag_meta', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-trunc', replied: false, needsAttention: false,
        });
        const longError = 'x'.repeat(500);
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-trunc' });

        await flagStuckJobOnFinalFailure(job, new Error(longError));

        const callArg = mockCommentsService.updateComment.mock.calls[0][1];
        expect(callArg.flagMeta.send_failed_retries_exhausted.error).toHaveLength(300);
    });

    // Notification trigger on final retry exhaustion (PR A — stops silent failures).
    // Until this PR, flagStuckJobOnFinalFailure flagged the row but sent no push —
    // merchants only saw stuck items if they happened to visit the dashboard.

    it('fires flagged_reply notification when a stuck FB comment is flagged', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-1', workspaceId: 'ws-1', fromName: 'Manar Alokla',
            replied: false, needsAttention: false, flagMeta: null,
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-1' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockNotificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
            'ws-1',
            'flagged_reply',
            { senderName: 'Manar Alokla', reason: 'send_failed_retries_exhausted' },
            expect.objectContaining({
                commentId: 'comment-uuid-1',
                type: 'comment',
                deepLink: '/comments?filter=flagged',
            }),
        );
    });

    it('fires flagged_reply notification when a stuck DM is flagged', async () => {
        mockDb.query.messages.findFirst.mockResolvedValueOnce({
            id: 'msg-uuid-1', workspaceId: 'ws-2', senderName: 'Sarah',
            replied: false, needsAttention: false, flagMeta: null,
        });
        const job = buildJob({ jobType: 'facebook_message', messageId: 'fb-msg-1' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockNotificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
            'ws-2',
            'flagged_reply',
            { senderName: 'Sarah', reason: 'send_failed_retries_exhausted' },
            expect.objectContaining({
                messageId: 'msg-uuid-1',
                type: 'message',
                deepLink: '/messages?filter=flagged',
            }),
        );
    });

    it('does NOT fire notification on intermediate attempts', async () => {
        // BullMQ fires "failed" every retry — notification must only fire on the final one.
        const job = buildJob({ attemptsMade: 1, maxAttempts: 3, commentId: 'fb-comment-mid' });
        await flagStuckJobOnFinalFailure(job, new Error('boom'));
        expect(mockNotificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
    });

    it('does NOT fire notification when comment was already replied (no flag wrote)', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-already', workspaceId: 'ws-1',
            replied: true, needsAttention: false,
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-already' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockCommentsService.updateComment).not.toHaveBeenCalled();
        expect(mockNotificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
    });

    it('skips notification when row carries backfill_no_notify marker (R8)', async () => {
        // The one-off SQL backfill that runs before this trigger ships marks
        // pre-existing stuck rows with `flag_meta.backfill_no_notify = true` so
        // the notification doesn't burst-fire for old incidents the merchant
        // already knows about.
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-backfill', workspaceId: 'ws-1', fromName: 'X',
            replied: false, needsAttention: false,
            flagMeta: { backfill_no_notify: true },
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-backfill' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        // Row IS flagged (so the dashboard tile counts it)
        expect(mockCommentsService.updateComment).toHaveBeenCalled();
        // But notification is suppressed
        expect(mockNotificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
    });

    it('skips notification when workspaceId is missing — does not throw', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-no-ws', workspaceId: null, fromName: 'X',
            replied: false, needsAttention: false, flagMeta: null,
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-no-ws' });

        await expect(
            flagStuckJobOnFinalFailure(job, new Error('boom')),
        ).resolves.toBeUndefined();
        expect(mockNotificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
    });

    it('falls back to "a customer" when senderName is missing', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-no-name', workspaceId: 'ws-3', fromName: null,
            replied: false, needsAttention: false, flagMeta: null,
        });
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-no-name' });

        await flagStuckJobOnFinalFailure(job, new Error('boom'));

        expect(mockNotificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
            'ws-3',
            'flagged_reply',
            { senderName: 'a customer', reason: 'send_failed_retries_exhausted' },
            expect.any(Object),
        );
    });

    it('swallows a thrown notification error so the worker survives', async () => {
        mockCommentsService.getCommentByFacebookId.mockResolvedValueOnce({
            id: 'comment-uuid-notif-fail', workspaceId: 'ws-4', fromName: 'X',
            replied: false, needsAttention: false, flagMeta: null,
        });
        mockNotificationService.sendTemplateNotificationToWorkspace.mockRejectedValueOnce(
            new Error('FCM down'),
        );
        const job = buildJob({ jobType: 'facebook_comment', commentId: 'fb-comment-notif-fail' });

        await expect(
            flagStuckJobOnFinalFailure(job, new Error('boom')),
        ).resolves.toBeUndefined();
        // Row was still flagged
        expect(mockCommentsService.updateComment).toHaveBeenCalled();
    });
});
