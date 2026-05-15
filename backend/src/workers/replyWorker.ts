import { Worker, Job, UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { ReplyJobData, ReplyJobResult, REPLY_QUEUE_NAME } from '@jawab24/shared';
import { replyService } from '../services/reply';
import { instagramReplyService } from '../services/instagramReply';
import { whatsappReplyService } from '../services/whatsappReply';
import { enqueueComment, enqueueMessage } from '../lib/replyQueue';
import { pipelineMetrics, Pipeline } from '../lib/pipelineMetrics';
import { Logger, noopLogger } from '../types';
import { commentsService } from '../services/comments';
import { messagesService } from '../services/messages';
import { notificationService } from '../services/notifications';
import { db } from '../db';
import { messages } from '../db/schema';

const MAX_HANDOFF_RETRIES = 3;

// Connection configuration for BullMQ
const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

// Worker concurrency - how many jobs to process simultaneously
const WORKER_CONCURRENCY = parseInt(process.env.REPLY_WORKER_CONCURRENCY || '8');

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
    const { pageId, postId, commentId, parentId, text, senderId, senderName, messageTags, requestId } = job.data;

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
        senderName,
        parentId,
        messageTags,
    );

    return {
        success: result.success,
        replyText: result.replyText,
        replyMethod: result.replyMethod as 'template' | 'ai' | 'post_reply' | undefined,
        error: result.error,
        handoffDelayMs: result.handoffDelayMs,
    };
}

/**
 * Shared message job handler — used by Facebook, Instagram, and WhatsApp.
 * All three follow the same flow: validate → delegate to service → map result.
 */
async function processMessageJob(
    job: Job<ReplyJobData>,
    label: string,
    service: { processMessage: (pageId: string, senderId: string, text: string, messageId: string, sharedPostUrl?: string, sharedPostId?: string) => Promise<import('../interfaces').MessageResult> },
): Promise<ReplyJobResult> {
    const { pageId, messageId, senderId, text, sharedPostUrl, sharedPostId, requestId } = job.data;

    logger.info(`[ReplyWorker] Processing ${label} message`, {
        jobId: job.id,
        requestId,
        messageId,
        pageId,
    });

    if (!messageId || !senderId) {
        throw new UnrecoverableError(`Missing messageId or senderId for ${label} message`);
    }

    const result = await service.processMessage(pageId, senderId, text, messageId, sharedPostUrl, sharedPostId);

    return {
        success: result.success,
        replyText: result.replyText,
        replyMethod: result.replyMethod as 'template' | 'ai' | 'post_reply' | undefined,
        error: result.error,
        handoffDelayMs: result.handoffDelayMs,
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
        replyMethod: result.replyMethod as 'template' | 'ai' | 'post_reply' | undefined,
        error: result.error,
        handoffDelayMs: result.handoffDelayMs,
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
                result = await processMessageJob(job, 'Facebook', replyService);
                break;
            case 'instagram_comment':
                result = await processInstagramComment(job);
                break;
            case 'instagram_message':
                result = await processMessageJob(job, 'Instagram', instagramReplyService);
                break;
            case 'whatsapp_message':
                result = await processMessageJob(job, 'WhatsApp', whatsappReplyService);
                break;
            default:
                throw new UnrecoverableError(`Unknown job type: ${jobType}`);
        }

        // Re-enqueue if handoff pause is active and retries not exhausted
        if (result.handoffDelayMs && result.handoffDelayMs > 0) {
            const retries = job.data.handoffRetries || 0;
            if (retries < MAX_HANDOFF_RETRIES) {
                const pipeline = jobType as Pipeline;
                const isComment = jobType.includes('comment');

                if (isComment && job.data.postId && job.data.commentId) {
                    await enqueueComment({
                        jobType: jobType as 'facebook_comment' | 'instagram_comment',
                        pageId: job.data.pageId,
                        postId: job.data.postId,
                        commentId: job.data.commentId,
                        text: job.data.text,
                        senderId: job.data.senderId,
                        senderName: job.data.senderName,
                        requestId: job.data.requestId,
                        replyDelay: Math.ceil(result.handoffDelayMs / 1000),
                        handoffRetries: retries + 1,
                    });
                } else if (!isComment && job.data.messageId && job.data.senderId) {
                    await enqueueMessage({
                        jobType: jobType as 'facebook_message' | 'instagram_message' | 'whatsapp_message',
                        pageId: job.data.pageId,
                        messageId: job.data.messageId,
                        senderId: job.data.senderId,
                        text: job.data.text,
                        senderName: job.data.senderName,
                        requestId: job.data.requestId,
                        replyDelay: Math.ceil(result.handoffDelayMs / 1000),
                        handoffRetries: retries + 1,
                    });
                }

                pipelineMetrics.record(pipeline, 'handoff_requeued');
                logger.info('[ReplyWorker] Job re-enqueued after handoff pause', {
                    jobId: job.id,
                    jobType,
                    requestId,
                    delayMs: result.handoffDelayMs,
                    retryNumber: retries + 1,
                });
            } else {
                logger.warn('[ReplyWorker] Handoff retries exhausted, dropping job', {
                    jobId: job.id,
                    jobType,
                    requestId,
                    retries,
                });
            }
        }

        const duration = Date.now() - startTime;
        logger.info('[ReplyWorker] Job completed', {
            jobId: job.id,
            jobType,
            requestId,
            success: result.success,
            skipReason: result.success ? undefined : result.error,
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
 * Returns true when a row's existing flag_meta carries the `backfill_no_notify`
 * marker — set by the one-off backfill SQL that runs before this notification
 * trigger ships, so pre-existing stuck rows don't blast pushes the moment the
 * new code goes live. Kept as a permanent skip-flag so future bulk backfills
 * can opt out of notification too.
 */
function existingFlagMetaHasBackfillSkip(flagMeta: unknown): boolean {
    if (!flagMeta || typeof flagMeta !== 'object') return false;
    return (flagMeta as Record<string, unknown>).backfill_no_notify === true;
}

/**
 * Fire-and-forget notification when a row is flagged stuck. Reuses the existing
 * `flagged_reply` template (5-min cooldown handles burst dedupe). Never throws.
 *
 * Failure modes intentionally swallowed: the row is already flagged at this point;
 * a missing push is recoverable (merchant still sees the dashboard tile), but a
 * thrown error from the worker's failed-event handler would destabilise BullMQ.
 */
function notifyStuckRow(
    workspaceId: string | null | undefined,
    senderName: string | null | undefined,
    target: { type: 'comment' | 'message'; id: string; backfillNoNotify: boolean },
): void {
    if (!workspaceId) {
        logger.warn('[ReplyWorker] Skipping stuck-row notification: missing workspaceId', { target });
        return;
    }
    if (target.backfillNoNotify) {
        logger.info('[ReplyWorker] Skipping stuck-row notification: backfill_no_notify set', { target });
        return;
    }
    notificationService.sendTemplateNotificationToWorkspace(
        workspaceId,
        'flagged_reply',
        { senderName: senderName || 'a customer', reason: 'send_failed_retries_exhausted' },
        {
            [target.type === 'comment' ? 'commentId' : 'messageId']: target.id,
            type: target.type,
            deepLink: target.type === 'comment' ? '/comments?filter=flagged' : '/messages?filter=flagged',
        },
    ).catch(err => {
        logger.error('[ReplyWorker] Stuck-row notification fire-and-forget threw', {
            error: err instanceof Error ? err.message : String(err),
            target,
        });
    });
}

/**
 * After BullMQ exhausts all retries for a reply job, flag the underlying
 * comment/message row as needs_attention so the merchant sees it in the inbox.
 * Without this, transient FB errors that don't recover (or any other thrown
 * failure during processing) leave the row as replied=false /
 * needs_attention=false / flag_reason=null — invisible to the merchant forever.
 *
 * Idempotent: only writes when the row exists, isn't already replied, and
 * isn't already flagged.
 *
 * Defensive: all errors are caught — failures here must NEVER crash the worker.
 * BullMQ fires 'failed' on every attempt; we act only on the final one.
 *
 * Scope: facebook_comment, facebook_message, instagram_message today.
 * instagram_comment (separate table) and whatsapp_message can be added the same way.
 */
export async function flagStuckJobOnFinalFailure(
    job: Job<ReplyJobData> | undefined,
    err: Error,
): Promise<void> {
    if (!job) return;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    try {
        const { jobType, commentId, messageId } = job.data;
        const errorSummary = (err?.message ?? 'Unknown error').slice(0, 300);
        const flagMeta = { send_failed_retries_exhausted: { error: errorSummary } };

        if (jobType === 'facebook_comment' && commentId) {
            const existing = await commentsService.getCommentByFacebookId(commentId);
            if (existing && !existing.replied && !existing.needsAttention) {
                await commentsService.updateComment(existing.id, {
                    needsAttention: true,
                    flagReason: 'send_failed_retries_exhausted',
                    flagMeta,
                });
                logger.info('[ReplyWorker] Stuck comment flagged after retry exhaustion', {
                    jobId: job.id,
                    commentId: existing.id,
                    platformCommentId: commentId,
                });
                notifyStuckRow(existing.workspaceId, existing.fromName, {
                    type: 'comment',
                    id: existing.id,
                    backfillNoNotify: existingFlagMetaHasBackfillSkip(existing.flagMeta),
                });
            }
            return;
        }

        if ((jobType === 'facebook_message' || jobType === 'instagram_message') && messageId) {
            const row = await db.query.messages.findFirst({
                where: eq(messages.platformMessageId, messageId),
            });
            if (row && !row.replied && !row.needsAttention) {
                await messagesService.flagMessage(row.id, 'send_failed_retries_exhausted', undefined, flagMeta);
                logger.info('[ReplyWorker] Stuck message flagged after retry exhaustion', {
                    jobId: job.id,
                    messageId: row.id,
                    platformMessageId: messageId,
                });
                notifyStuckRow(row.workspaceId, row.senderName, {
                    type: 'message',
                    id: row.id,
                    backfillNoNotify: existingFlagMetaHasBackfillSkip(row.flagMeta),
                });
            }
            return;
        }

        // instagram_comment / whatsapp_message: not covered yet — follow-up.
    } catch (handlerErr) {
        // Never throw from the failed-event handler — would destabilize the worker.
        logger.error('[ReplyWorker] flagStuckJobOnFinalFailure threw — swallowed to keep worker alive', {
            jobId: job?.id,
            handlerError: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
        });
    }
}

/**
 * Start the reply worker
 */
export function startWorker(workerLogger?: Logger): Worker<ReplyJobData, ReplyJobResult> {
    if (workerLogger) {
        logger = workerLogger;
        // Propagate logger to services so their internal logging (lap timing, etc.) works
        replyService.setLogger(workerLogger);
        instagramReplyService.setLogger(workerLogger);
        whatsappReplyService.setLogger(workerLogger);
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

    worker.on('failed', async (job, err) => {
        logger.error('[ReplyWorker] Job failed event', {
            jobId: job?.id,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        });
        await flagStuckJobOnFinalFailure(job, err);
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
