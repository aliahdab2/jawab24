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
}
