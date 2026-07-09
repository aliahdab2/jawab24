import { Worker, Job, UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { ReplyJobData, ReplyJobResult, REPLY_QUEUE_NAME } from '@jawab24/shared';
import { replyService } from '../services/reply';
import { instagramReplyService } from '../services/instagramReply';
import { whatsappReplyService } from '../services/whatsappReply';
import { enqueueComment, enqueueMessage } from '../lib/replyQueue';
import { pipelineMetrics, Pipeline } from '../lib/pipelineMetrics';
import { computeQueueWaitMs, recordQueueWaitSample } from '../services/replyQueueHealth';
import { Logger, noopLogger } from '../types';
import { commentsService } from '../services/comments';
import { messagesService } from '../services/messages';
import { notificationService } from '../services/notifications';
import { db } from '../db';
import { messages } from '../db/schema';
import { AiQuotaExhaustedError } from '../utils/fbGraphErrors';

const MAX_HANDOFF_RETRIES = 3;

/**
 * When the AI is temporarily unavailable for a recoverable reason, decide how
 * long to park (re-enqueue with delay) before retrying — instead of burning
 * BullMQ's fast retries (2s/4s/8s) and flagging the row needs_attention.
 *
 *   - OpenAI insufficient_quota → recovers only when billing is topped up, never
 *     in seconds. Park long (config.ai.quotaParkSeconds, default 15 min).
 *   - ai-worker circuit open → usually a short blip; ai.ts already tried provider
 *     failover and it didn't save the call. Park briefly past the circuit's open
 *     window (config.ai.circuitParkSeconds, default 60s) so a routine restart
 *     doesn't get a 15-min penalty, while a sustained quota outage still trickles
 *     into the long-park path on the next attempt.
 *
 * Returns null for anything that should keep its normal retry/flag behavior.
 */
function planAiPark(error: unknown): { kind: 'quota' | 'circuit'; delaySeconds: number } | null {
    if (error instanceof AiQuotaExhaustedError) {
        return { kind: 'quota', delaySeconds: config.ai.quotaParkSeconds };
    }
    // Match CircuitOpenError by name (not instanceof) so the worker need not import
    // circuitBreaker (which pulls in redis); robust to module-boundary class identity.
    if (error instanceof Error && error.name === 'CircuitOpenError') {
        return { kind: 'circuit', delaySeconds: config.ai.circuitParkSeconds };
    }
    return null;
}

/**
 * Re-enqueue the current job with a delay — the single re-enqueue path for ALL three
 * "park and retry later" reasons (handoff pause, AI-unavailable, attachment-enriching).
 * Each reason bumps its OWN counter and every other counter is preserved from the
 * current job, so the three park kinds never clobber each other's budgets (and the
 * shared-post context always survives the hop). Returns false when the job lacks the
 * ids needed to re-enqueue.
 */
async function reEnqueueParked(
    job: Job<ReplyJobData>,
    opts: { delaySeconds: number; handoffRetries?: number; aiRetryCount?: number; attachmentRetries?: number },
): Promise<boolean> {
    const { jobType } = job.data;
    const isComment = jobType.includes('comment');
    // Only the counter(s) the caller bumps are carried; the rest are intentionally
    // dropped. This is load-bearing for `handoffRetries`: an AI-park or
    // attachment-park must NEVER inherit a prior handoffRetries>0, or the resumed
    // job would be treated as handoff backlog and stale-suppressed (dropped). Each
    // park kind advances only its own budget.
    // Include a counter key ONLY when this park bumps it — an omitted key means
    // "don't carry it forward" (see the handoffRetries note above).
    const counters = {
        ...(opts.handoffRetries !== undefined ? { handoffRetries: opts.handoffRetries } : {}),
        ...(opts.aiRetryCount !== undefined ? { aiRetryCount: opts.aiRetryCount } : {}),
        ...(opts.attachmentRetries !== undefined ? { attachmentRetries: opts.attachmentRetries } : {}),
    };

    if (isComment && job.data.postId && job.data.commentId) {
        await enqueueComment({
            jobType: jobType as 'facebook_comment' | 'instagram_comment',
            pageId: job.data.pageId,
            postId: job.data.postId,
            commentId: job.data.commentId,
            parentId: job.data.parentId,
            text: job.data.text,
            senderId: job.data.senderId,
            senderName: job.data.senderName,
            messageTags: job.data.messageTags,
            requestId: job.data.requestId,
            replyDelay: opts.delaySeconds,
            ...counters, // attachmentRetries is ignored by enqueueComment (DM-only)
        });
        return true;
    }
    if (!isComment && job.data.messageId && job.data.senderId) {
        await enqueueMessage({
            jobType: jobType as 'facebook_message' | 'instagram_message' | 'whatsapp_message',
            pageId: job.data.pageId,
            messageId: job.data.messageId,
            senderId: job.data.senderId,
            text: job.data.text,
            sharedPostUrl: job.data.sharedPostUrl,
            sharedPostId: job.data.sharedPostId,
            senderName: job.data.senderName,
            requestId: job.data.requestId,
            replyDelay: opts.delaySeconds,
            ...counters,
        });
        return true;
    }
    return false;
}

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
    service: { processMessage: (pageId: string, senderId: string, text: string, messageId: string, sharedPostUrl?: string, sharedPostId?: string, wasHandoffPaused?: boolean, attachmentRetries?: number, senderName?: string) => Promise<import('../interfaces').MessageResult> },
): Promise<ReplyJobResult> {
    const { pageId, messageId, senderId, text, sharedPostUrl, sharedPostId, requestId, handoffRetries, attachmentRetries, senderName } = job.data;

    logger.info(`[ReplyWorker] Processing ${label} message`, {
        jobId: job.id,
        requestId,
        messageId,
        pageId,
    });

    if (!messageId || !senderId) {
        throw new UnrecoverableError(`Missing messageId or senderId for ${label} message`);
    }

    // A job that has been re-enqueued at least once was held by a handoff
    // pause; messageProcessor uses this to gate stale-backlog suppression.
    const wasHandoffPaused = (handoffRetries ?? 0) > 0;
    // senderName: webhook-captured display name (WhatsApp contacts[].profile.name —
    // that channel's only name source; undefined for FB/IG whose webhooks carry none).
    const result = await service.processMessage(pageId, senderId, text, messageId, sharedPostUrl, sharedPostId, wasHandoffPaused, attachmentRetries ?? 0, senderName);

    return {
        success: result.success,
        replyText: result.replyText,
        replyMethod: result.replyMethod as 'template' | 'ai' | 'post_reply' | undefined,
        error: result.error,
        handoffDelayMs: result.handoffDelayMs,
        attachmentPendingDelayMs: result.attachmentPendingDelayMs,
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

    // Queue-wait sample: first attempt only — a retry's wait is backoff, not backlog.
    let queueWaitMs: number | undefined;
    if (job.attemptsStarted <= 1) {
        queueWaitMs = computeQueueWaitMs(job, startTime);
        recordQueueWaitSample(queueWaitMs, startTime);
    }

    logger.info('[ReplyWorker] Starting job processing', {
        jobId: job.id,
        jobType,
        requestId,
        attemptNumber: job.attemptsMade + 1,
        queueWaitMs,
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
                await reEnqueueParked(job, {
                    delaySeconds: Math.ceil(result.handoffDelayMs / 1000),
                    handoffRetries: retries + 1,
                });
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

        // Re-enqueue if a sibling attachment is still being enriched (store-then-enrich).
        // Mutually exclusive with the handoff block above: handoffDelayMs is returned at
        // steps 4b/6, attachmentPendingDelayMs only at step 11, so a result never carries
        // both. The retry cap is enforced in messageProcessor (it falls through to a real
        // reply once exhausted), so there is deliberately no cap check here — a returned
        // delay always means "park again". reEnqueueParked routes DM-only.
        if (result.attachmentPendingDelayMs && result.attachmentPendingDelayMs > 0) {
            const pipeline = jobType as Pipeline;
            await reEnqueueParked(job, {
                delaySeconds: Math.ceil(result.attachmentPendingDelayMs / 1000),
                attachmentRetries: (job.data.attachmentRetries ?? 0) + 1,
            });
            pipelineMetrics.record(pipeline, 'attachment_park_requeued');
            logger.info('[ReplyWorker] Job parked waiting for attachment enrichment', {
                jobId: job.id,
                jobType,
                requestId,
                delayMs: result.attachmentPendingDelayMs,
                attachmentRetries: (job.data.attachmentRetries ?? 0) + 1,
            });
        }

        const duration = Date.now() - startTime;
        logger.info('[ReplyWorker] Job completed', {
            jobId: job.id,
            jobType,
            requestId,
            success: result.success,
            skipReason: result.success ? undefined : result.error,
            duration,
            queueWaitMs,
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

        // AI temporarily unavailable (OpenAI insufficient_quota / circuit open):
        // PARK the job instead of fast-retrying and flagging. Re-enqueue with a
        // delay and an incremented aiRetryCount so the message auto-replies once
        // the AI recovers (e.g. billing topped up). Bounded by parkMaxRetries so a
        // genuinely dead account doesn't park forever — once the budget is spent
        // we fall through to the normal rethrow → retry-exhaustion → flag path.
        const parkPlan = planAiPark(error);
        if (parkPlan) {
            const aiRetryCount = job.data.aiRetryCount ?? 0;
            const pipeline = jobType as Pipeline;
            if (aiRetryCount < config.ai.parkMaxRetries) {
                const reEnqueued = await reEnqueueParked(job, { delaySeconds: parkPlan.delaySeconds, aiRetryCount: aiRetryCount + 1 });
                if (reEnqueued) {
                    pipelineMetrics.record(pipeline, 'ai_parked');
                    logger.warn('[ReplyWorker] AI unavailable — job parked for retry', {
                        jobId: job.id,
                        jobType,
                        requestId,
                        kind: parkPlan.kind,
                        delaySeconds: parkPlan.delaySeconds,
                        aiRetryCount: aiRetryCount + 1,
                        parkMaxRetries: config.ai.parkMaxRetries,
                    });
                    // Resolve (not throw): BullMQ marks this attempt completed and does
                    // NOT fire 'failed', so flagStuckJobOnFinalFailure won't flag the row.
                    // The delayed copy carries the retry forward.
                    return { success: false, error: `AI unavailable (${parkPlan.kind}) — parked for retry` };
                }
                // Missing ids to re-enqueue — fall through to normal retry/flag.
            } else {
                // Park budget exhausted. Let it flag so the merchant can act (and so
                // a permanently-dead account doesn't leave messages parked forever).
                pipelineMetrics.record(pipeline, 'ai_park_exhausted');
                logger.error('[ReplyWorker] AI park budget exhausted — letting job flag', {
                    jobId: job.id,
                    jobType,
                    requestId,
                    kind: parkPlan.kind,
                    aiRetryCount,
                });
            }
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
 * marker. Today this is dead code in normal operation — the idempotency guard
 * `!existing.needsAttention` already excludes the rows the deploy-time backfill
 * SQL targets. Kept as a forward-looking opt-out for future bulk backfills that
 * may pre-mark rows where `needsAttention=false`, and as a safety net if the
 * idempotency guard is ever loosened.
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
