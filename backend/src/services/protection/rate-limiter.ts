import { redis } from '../../lib/redis';
import { Logger, noopLogger } from '../../types';

/**
 * Rate limiting configuration
 * Controls how many requests a user can make per time window
 */
export const RATE_LIMIT_CONFIG = {
    // Comments: 5 per minute per user per page
    COMMENTS_MAX: 5,
    COMMENTS_WINDOW_SECONDS: 60,
    // Messages: 10 per minute per user per page (DMs are usually more conversational)
    MESSAGES_MAX: 10,
    MESSAGES_WINDOW_SECONDS: 60,
} as const;

export type RateLimitType = 'comment' | 'message';

export interface RateLimitResult {
    allowed: boolean;
    count: number;
}

/**
 * Rate Limiter Service
 * Protects against spam by limiting requests per user per page
 * Uses Redis with sliding window counters
 */
export class RateLimiter {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Check rate limit for a user on a page
     * @param pageId - The Facebook page ID
     * @param userId - The user/sender ID
     * @param type - The type of rate limit ('comment' or 'message')
     * @returns Object with allowed (boolean) and count (number)
     */
    async check(
        pageId: string,
        userId: string,
        type: RateLimitType
    ): Promise<RateLimitResult> {
        const config = type === 'comment'
            ? { max: RATE_LIMIT_CONFIG.COMMENTS_MAX, window: RATE_LIMIT_CONFIG.COMMENTS_WINDOW_SECONDS }
            : { max: RATE_LIMIT_CONFIG.MESSAGES_MAX, window: RATE_LIMIT_CONFIG.MESSAGES_WINDOW_SECONDS };

        const key = `rate:${type}:${pageId}:${userId}`;

        try {
            const count = await redis.incr(key);

            // Set TTL on first increment
            if (count === 1) {
                await redis.expire(key, config.window);
            }

            if (count > config.max) {
                this.logger.warn(`[RateLimit] ${type} limit exceeded`, {
                    pageId,
                    userId,
                    count,
                    max: config.max
                });
                return { allowed: false, count };
            }

            return { allowed: true, count };
        } catch (error) {
            // If Redis fails, allow the request (fail-open)
            // This ensures service availability even when Redis is down
            this.logger.error('[RateLimit] Redis error, allowing request', { error });
            return { allowed: true, count: 0 };
        }
    }

    /**
     * Get remaining requests for a user
     * Useful for showing users how many requests they have left
     */
    async getRemaining(
        pageId: string,
        userId: string,
        type: RateLimitType
    ): Promise<number> {
        const config = type === 'comment'
            ? { max: RATE_LIMIT_CONFIG.COMMENTS_MAX }
            : { max: RATE_LIMIT_CONFIG.MESSAGES_MAX };

        const key = `rate:${type}:${pageId}:${userId}`;

        try {
            const countStr = await redis.get(key);
            const count = countStr ? parseInt(countStr, 10) : 0;
            return Math.max(0, config.max - count);
        } catch {
            return config.max; // Assume full quota on error
        }
    }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
