import { acquireMutex, releaseMutex } from './redisMutex';

/** Lock TTL in seconds — covers replyDelay + OpenAI generation + API send. */
const LOCK_TTL = 60;
const KEY_PREFIX = 'reply_lock:';

/**
 * Acquire a per-conversation lock (Redis SET NX EX).
 * Returns a unique token on success (used for safe release), or null if already held.
 */
export async function acquireReplyLock(pageId: string, senderId: string): Promise<string | null> {
    return acquireMutex(`${KEY_PREFIX}${pageId}:${senderId}`, LOCK_TTL);
}

/**
 * Release the lock only if we still hold it (compare-and-delete for atomicity).
 * Prevents releasing a lock re-acquired by a different worker after TTL expiry.
 */
export async function releaseReplyLock(pageId: string, senderId: string, token: string): Promise<void> {
    await releaseMutex(`${KEY_PREFIX}${pageId}:${senderId}`, token);
}
