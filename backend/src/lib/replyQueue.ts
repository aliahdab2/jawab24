import { Queue } from 'bullmq';
import { config } from '../config';
import { ReplyJobData, REPLY_QUEUE_NAME } from '@jawab24/shared';

export { REPLY_QUEUE_NAME };

// Reuse the Redis config from our config file
const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

/**
 * Reply Processing Queue
 * 
 * Handles all incoming comments and messages from Facebook/Instagram webhooks.
 * Jobs are processed by the replyWorker which handles:
 * - Validation (page exists, auto-reply enabled)
 * - Rate limiting
 * - Reply generation (template or AI)
 * - Sending reply to Facebook/Instagram
 * - Database updates
 */
export const replyQueue = new Queue<ReplyJobData>(REPLY_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000, // 2s, 4s, 8s between retries
        },
        removeOnComplete: 100, // Keep last 100 completed for debugging
        removeOnFail: 500, // Keep last 500 failures for analysis
    },
});

/**
 * Add a comment processing job to the queue
 */
export async function enqueueComment(data: {
    jobType: 'facebook_comment' | 'instagram_comment';
    pageId: string;
    postId: string;
    commentId: string;
    text: string;
    senderId?: string;
    senderName?: string;
    requestId?: string;
    replyDelay?: number;
    handoffRetries?: number;
}): Promise<string> {
    const jobData: ReplyJobData = {
        jobType: data.jobType,
        pageId: data.pageId,
        postId: data.postId,
        commentId: data.commentId,
        text: data.text,
        senderId: data.senderId,
        senderName: data.senderName,
        requestId: data.requestId,
        receivedAt: new Date().toISOString(),
        handoffRetries: data.handoffRetries,
    };

    // Use delay option if replyDelay is set (in milliseconds)
    const options = data.replyDelay ? { delay: data.replyDelay * 1000 } : {};

    const job = await replyQueue.add('process-comment', jobData, options);
    return job.id || 'unknown';
}

/**
 * Add a message processing job to the queue
 */
export async function enqueueMessage(data: {
    jobType: 'facebook_message' | 'instagram_message';
    pageId: string;
    messageId: string;
    senderId: string;
    text: string;
    senderName?: string;
    requestId?: string;
    replyDelay?: number;
    handoffRetries?: number;
}): Promise<string> {
    const jobData: ReplyJobData = {
        jobType: data.jobType,
        pageId: data.pageId,
        messageId: data.messageId,
        senderId: data.senderId,
        text: data.text,
        senderName: data.senderName,
        requestId: data.requestId,
        receivedAt: new Date().toISOString(),
        handoffRetries: data.handoffRetries,
    };

    // Use delay option if replyDelay is set (in milliseconds)
    const options = data.replyDelay ? { delay: data.replyDelay * 1000 } : {};

    const job = await replyQueue.add('process-message', jobData, options);
    return job.id || 'unknown';
}

/**
 * Promote all delayed handoff jobs for a specific page + sender.
 * Called when the user clicks "Resume Smart Reply" so messages
 * are processed immediately instead of waiting for the timer.
 */
export async function promoteDelayedJobs(pageId: string, senderId: string): Promise<number> {
    const delayed = await replyQueue.getDelayed();
    let promoted = 0;

    for (const job of delayed) {
        if (
            job.data.pageId === pageId &&
            job.data.senderId === senderId &&
            job.data.handoffRetries !== undefined &&
            job.data.handoffRetries > 0
        ) {
            try {
                await job.promote();
                promoted++;
            } catch {
                // Job may have already been processed or removed — skip it
            }
        }
    }

    return promoted;
}

/**
 * Get queue statistics for monitoring
 */
export async function getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        replyQueue.getWaitingCount(),
        replyQueue.getActiveCount(),
        replyQueue.getCompletedCount(),
        replyQueue.getFailedCount(),
        replyQueue.getDelayedCount(),
    ]);

    return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + delayed,
    };
}
