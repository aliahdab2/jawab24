import { redis } from './redis';
import { randomUUID } from 'crypto';

/**
 * Minimal Redis mutex primitive: tokened `SET NX EX` acquire + Lua
 * compare-and-delete release. Shared by the per-conversation/per-comment
 * idempotency lock (replyLock.ts) and the per-(page, post, sender) comment
 * debounce (comment-debounce.ts), which previously each hand-rolled the same
 * `SET NX` + CAS-Lua pair.
 *
 * Intentionally low-level: callers own key namespacing, TTL choice, and error
 * policy (fail-open vs. propagate). No try/catch, no logging here.
 */

/**
 * Acquire a mutex via `SET key <token> NX EX ttl`. Returns a unique token on
 * success — pass it to {@link releaseMutex} for a safe release — or `null` when
 * the key is already held.
 */
export async function acquireMutex(key: string, ttlSeconds: number): Promise<string | null> {
    const token = randomUUID();
    const acquired = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
    return acquired ? token : null;
}

/**
 * Release a mutex only if we still hold it — compare-and-delete via Lua so a key
 * re-acquired by another worker after TTL expiry is never released by us.
 * Returns true when the key was deleted.
 */
export async function releaseMutex(key: string, token: string): Promise<boolean> {
    const result = await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        token,
    );
    return result === 1;
}
