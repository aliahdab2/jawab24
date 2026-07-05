/**
 * Message Processing Types
 *
 * Shared result types for message operations across all platforms.
 */

/** Standard result for message reply operations (all platforms) */
export interface MessageResult {
    success: boolean;
    messageId: string;
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual' | 'post_reply';
    error?: string;
    /** When set, the worker should re-enqueue this job with the given delay (ms) */
    handoffDelayMs?: number;
    /** When set, a sibling attachment from the same sender is still being enriched;
     *  the worker re-enqueues this DM job with the given delay (ms) and
     *  attachmentRetries+1, so the reply consolidates the real content. */
    attachmentPendingDelayMs?: number;
}
