/**
 * Protection Services
 * Contains all protection-related logic for preventing abuse
 */

export { rateLimiter, RateLimiter, RATE_LIMIT_CONFIG } from './rate-limiter';
export type { RateLimitType, RateLimitResult } from './rate-limiter';
export { commentDebounce, CommentDebounce } from './comment-debounce';
