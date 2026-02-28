import { redis } from './redis';
import { randomUUID } from 'crypto';

/** Lock TTL in seconds — covers replyDelay + OpenAI generation + API send. */
const LOCK_TTL = 60;
const KEY_PREFIX = 'reply_lock:';

/**
 * Acquire a per-conversation lock using Redis SET NX EX.
 * Returns a unique token on success (used for safe release), or null if already held.
 */
export async function acquireReplyLock(pageId: string, senderId: string): Promise<string | null> {
    const token = randomUUID();
    const key = `${KEY_PREFIX}${pageId}:${senderId}`;
    const acquired = await redis.set(key, token, 'EX', LOCK_TTL, 'NX');
    return acquired ? token : null;
}

/**
 * Release lock only if we hold it (compare-and-swap via Lua for atomicity).
 * Prevents releasing a lock that was acquired by a different worker after TTL expiry.
 */
export async function releaseReplyLock(pageId: string, senderId: string, token: string): Promise<void> {
    const key = `${KEY_PREFIX}${pageId}:${senderId}`;
    await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        token,
    );
}
