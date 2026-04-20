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
    parentId?: string;
    text: string;
    senderId?: string;
    senderName?: string;
    messageTags?: NonNullable<ReplyJobData['messageTags']>;
    requestId?: string;
    replyDelay?: number;
    handoffRetries?: number;
}): Promise<string> {
    const jobData: ReplyJobData = {
        jobType: data.jobType,
        pageId: data.pageId,
        postId: data.postId,
        commentId: data.commentId,
        parentId: data.parentId,
        text: data.text,
        senderId: data.senderId,
        senderName: data.senderName,
        messageTags: data.messageTags,
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
    jobType: 'facebook_message' | 'instagram_message' | 'whatsapp_message';
    pageId: string;
    messageId: string;
    senderId: string;
    text: string;
    sharedPostUrl?: string;
    sharedPostId?: string;
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
        sharedPostUrl: data.sharedPostUrl,
        sharedPostId: data.sharedPostId,
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
 *
 * Uses paginated fetching (100 jobs at a time) to avoid loading the entire
 * delayed queue into memory, which caused OOM crashes on large queues.
 */
export async function promoteDelayedJobs(pageId: string, senderId: string): Promise<number> {
    const BATCH_SIZE = 100;
    let promoted = 0;
    let start = 0;

    while (true) {
        const batch = await replyQueue.getDelayed(start, start + BATCH_SIZE - 1);
        if (batch.length === 0) break;

        for (const job of batch) {
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

        start += BATCH_SIZE;
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
