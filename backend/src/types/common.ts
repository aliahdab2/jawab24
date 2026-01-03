/**
 * Common Interfaces
 * 
 * Shared types used across multiple services and controllers.
 * Import from here to avoid duplication.
 */

import { FastifyRequest } from 'fastify';

// ==================== Request Types ====================

/** Authenticated request with user info attached by auth middleware */
export interface AuthenticatedRequest extends FastifyRequest {
    user: {
        id: string;
        email?: string;
        facebookId?: string;
    };
}

// ==================== Result Types ====================

/** Standard result for reply operations */
export interface ReplyResult {
    success: boolean;
    commentId: string;
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual';
    error?: string;
}

/** Standard result for message operations */
export interface MessageResult {
    success: boolean;
    messageId: string;
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual';
    error?: string;
}

/** Result of cleanup operations */
export interface CleanupResult {
    table: string;
    deletedCount: number;
    error?: string;
}

// ==================== Retry Options ====================

/** Options for retry with exponential backoff */
export interface RetryOptions {
    /** Maximum number of retry attempts (default: 3) */
    maxAttempts?: number;
    /** Base delay in milliseconds (default: 1000) */
    baseDelayMs?: number;
    /** Maximum delay in milliseconds (default: 10000) */
    maxDelayMs?: number;
    /** Function to determine if an error should trigger a retry */
    retryableErrors?: (error: unknown) => boolean;
    /** Callback called before each retry attempt */
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
    /** AbortSignal to cancel retries */
    signal?: AbortSignal;
}
