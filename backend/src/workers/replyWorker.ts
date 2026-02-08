import { Worker, Job, UnrecoverableError } from 'bullmq';
import { config } from '../config';
import { ReplyJobData, ReplyJobResult, REPLY_QUEUE_NAME } from '@jawab24/shared';
import { replyService } from '../services/reply';
import { instagramReplyService } from '../services/instagramReply';
import { Logger, noopLogger } from '../types';

// Connection configuration for BullMQ
const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

// Worker concurrency - how many jobs to process simultaneously
const WORKER_CONCURRENCY = parseInt(process.env.REPLY_WORKER_CONCURRENCY || '5');

let logger: Logger = noopLogger;

/**
 * Set the logger for the worker
 */
export function setWorkerLogger(newLogger: Logger): void {
    logger = newLogger;
}

/**
 * Process a Facebook comment job
 */
async function processFacebookComment(job: Job<ReplyJobData>): Promise<ReplyJobResult> {
    const { pageId, postId, commentId, text, senderId, senderName, requestId } = job.data;

    logger.info('[ReplyWorker] Processing Facebook comment', {
        jobId: job.id,
        requestId,
        commentId,
        pageId,
    });

    if (!postId || !commentId) {
        throw new UnrecoverableError('Missing postId or commentId for Facebook comment');
    }

    const result = await replyService.processComment(
        pageId,
        postId,
        commentId,
        text,
        senderId,
        senderName
    );

    return {
        success: result.success,
        replyText: result.replyText,
        replyMethod: result.replyMethod as 'template' | 'ai' | undefined,
        error: result.error,
    };
}

/**
 * Process a Facebook message job
 */
async function processFacebookMessage(job: Job<ReplyJobData>): Promise<ReplyJobResult> {
    const { pageId, messageId, senderId, text, requestId } = job.data;

    logger.info('[ReplyWorker] Processing Facebook message', {
        jobId: job.id,
        requestId,
        messageId,
        pageId,
    });

    if (!messageId || !senderId) {
        throw new UnrecoverableError('Missing messageId or senderId for Facebook message');
    }

    const result = await replyService.processMessage(
        pageId,
        senderId,
        text,
        messageId
    );

    return {
        success: result.success,
        replyText: result.replyText,
        replyMethod: result.replyMethod as 'template' | 'ai' | undefined,
        error: result.error,
    };
}

/**
 * Process an Instagram comment job
 */
async function processInstagramComment(job: Job<ReplyJobData>): Promise<ReplyJobResult> {
    const { pageId, postId, commentId, text, senderId, senderName, requestId } = job.data;

    logger.info('[ReplyWorker] Processing Instagram comment', {
        jobId: job.id,
        requestId,
        commentId,
        pageId,
    });

    if (!postId || !commentId) {
        throw new UnrecoverableError('Missing postId (mediaId) or commentId for Instagram comment');
    }

    const result = await instagramReplyService.processComment(
        pageId, // This is the Instagram account ID
        postId, // This is the media ID
        commentId,
        text,
        senderId,
        senderName
    );

    return {
        success: result.success,
        replyText: result.replyText,
        replyMethod: result.replyMethod as 'template' | 'ai' | undefined,
        error: result.error,
    };
}

/**
 * Process an Instagram message job
 */
async function processInstagramMessage(job: Job<ReplyJobData>): Promise<ReplyJobResult> {
    const { pageId, messageId, senderId, text, requestId } = job.data;

    logger.info('[ReplyWorker] Processing Instagram message', {
        jobId: job.id,
        requestId,
        messageId,
        pageId,
    });

    if (!messageId || !senderId) {
        throw new UnrecoverableError('Missing messageId or senderId for Instagram message');
    }

    const result = await instagramReplyService.processMessage(
        pageId, // This is the Instagram account ID
        senderId,
        text,
        messageId
    );

    return {
        success: result.success,
        replyText: result.replyText,
        replyMethod: result.replyMethod as 'template' | 'ai' | undefined,
        error: result.error,
    };
}

/**
 * Main job processor
 * Routes jobs to the appropriate handler based on jobType
 */
async function processJob(job: Job<ReplyJobData>): Promise<ReplyJobResult> {
    const { jobType, requestId } = job.data;
    const startTime = Date.now();

    logger.info('[ReplyWorker] Starting job processing', {
        jobId: job.id,
        jobType,
        requestId,
        attemptNumber: job.attemptsMade + 1,
    });

    try {
        // Route to appropriate handler
        // Page validation and auto-reply checks are handled by each service's adapter
        let result: ReplyJobResult;

        switch (jobType) {
            case 'facebook_comment':
                result = await processFacebookComment(job);
                break;
            case 'facebook_message':
                result = await processFacebookMessage(job);
                break;
            case 'instagram_comment':
                result = await processInstagramComment(job);
                break;
            case 'instagram_message':
                result = await processInstagramMessage(job);
                break;
            default:
                throw new UnrecoverableError(`Unknown job type: ${jobType}`);
        }

        const duration = Date.now() - startTime;
        logger.info('[ReplyWorker] Job completed', {
            jobId: job.id,
            jobType,
            requestId,
            success: result.success,
            duration,
            replyMethod: result.replyMethod,
        });

        return result;

    } catch (error) {
        const duration = Date.now() - startTime;
        
        // Check if this is an unrecoverable error (no retries)
        if (error instanceof UnrecoverableError) {
            logger.warn('[ReplyWorker] Job failed permanently', {
                jobId: job.id,
                jobType,
                requestId,
                duration,
                error: error.message,
            });
            throw error; // BullMQ will not retry
        }

        // For other errors, log and let BullMQ retry
        logger.error('[ReplyWorker] Job failed, will retry', {
            jobId: job.id,
            jobType,
            requestId,
            duration,
            attemptsMade: job.attemptsMade + 1,
            error: error instanceof Error ? error.message : String(error),
        });

        throw error; // BullMQ will retry based on backoff strategy
    }
}

// Worker instance (will be initialized when startWorker is called)
let worker: Worker<ReplyJobData, ReplyJobResult> | null = null;

/**
 * Start the reply worker
 */
export function startWorker(workerLogger?: Logger): Worker<ReplyJobData, ReplyJobResult> {
    if (workerLogger) {
        logger = workerLogger;
        // Propagate logger to services so their internal logging (lap timing, etc.) works
        replyService.setLogger(workerLogger);
        instagramReplyService.setLogger(workerLogger);
    }

    worker = new Worker<ReplyJobData, ReplyJobResult>(
        REPLY_QUEUE_NAME,
        processJob,
        {
            connection,
            concurrency: WORKER_CONCURRENCY,
        }
    );

    // Event handlers for monitoring
    worker.on('completed', (job, result) => {
        logger.debug('[ReplyWorker] Job completed event', {
            jobId: job.id,
            success: result.success,
        });
    });

    worker.on('failed', (job, err) => {
        logger.error('[ReplyWorker] Job failed event', {
            jobId: job?.id,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        });
    });

    worker.on('error', (err) => {
        logger.error('[ReplyWorker] Worker error', { error: err.message });
    });

    worker.on('stalled', (jobId) => {
        logger.warn('[ReplyWorker] Job stalled', { jobId });
    });

    logger.info('[ReplyWorker] Worker started', {
        queueName: REPLY_QUEUE_NAME,
        concurrency: WORKER_CONCURRENCY,
    });

    return worker;
}

/**
 * Stop the reply worker gracefully
 */
export async function stopWorker(): Promise<void> {
    if (worker) {
        logger.info('[ReplyWorker] Stopping worker...');
        await worker.close();
        worker = null;
        logger.info('[ReplyWorker] Worker stopped');
    }
}

/**
 * Get the current worker instance
 */
export function getWorker(): Worker<ReplyJobData, ReplyJobResult> | null {
    return worker;
}

export { worker };
